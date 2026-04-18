import type { App, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import { logError, logExecution, logWarning } from "../monitoring/workflowLogs";
import { runPdfScript, runWechatScript } from "../localScripts/rawExtractors";
import type { OpenClawClient } from "../openclaw/OpenClawClient";
import {
  resolveCaseByDomainWorkflow,
  resolveCaseWorkflow,
  resolveDebugWorkflow,
  resolveDocWorkflow,
  resolveFixFrontmatterWorkflow,
  resolveInsightWorkflow,
  resolveMethodWorkflow,
  resolveRawSkillWorkflow,
  resolveRewriteWorkflow,
  resolveSystemWorkflow,
  resolveTheoryByDomainWorkflow,
  resolveTheoryWorkflow,
  type CaseTopic,
  type InsightDomain,
  type MethodTopic,
  type TheoryTopic
} from "../registry/insightRegistry";
import type { OpenClawSettings } from "../settings";
import { resolveOutputPath, resolveRawOutputPath, sanitizeFilenamePart } from "../utils/notePaths";
import { validateInput, validateNote } from "../validation";

export type RunnableWorkflowName =
  | "raw_to_insight"
  | "note_to_theory"
  | "note_to_case"
  | "note_to_method"
  | "note_to_doc"
  | "note_to_debug"
  | "note_to_system"
  | "note_to_case_by_domain"
  | "rewrite_current_note"
  | "fix_frontmatter";

export type WorkflowRunContext = {
  title: string;
  path: string;
  topic?: string;
  domain?: string;
  action?: string;
};

export type RegistryConvertKind = "insight" | "theory" | "case" | "method" | "doc" | "debug" | "system" | "case_by_domain";

type WorkflowExecutorOptions = {
  app: App;
  getSettings: () => OpenClawSettings;
  writeFile: (path: string, content: string, inferredType?: string) => Promise<TFile>;
  replaceFile: (file: TFile, content: string) => Promise<TFile>;
  getClient: () => OpenClawClient | null;
  waitForMarkdownReply: () => Promise<string>;
  cancelPendingReply: () => void;
  onSystemTurn: (content: string) => void;
  currentModelName: () => string;
};

function normalizeMarkdownArtifact(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced?.[1] ?? trimmed).trim() + "\n";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function markWorkflowErrorLogged(error: unknown): void {
  if (error instanceof Error) {
    (error as Error & { __openclawWorkflowLogged?: boolean }).__openclawWorkflowLogged = true;
  }
}

export function wasWorkflowErrorLogged(error: unknown): boolean {
  return error instanceof Error && Boolean((error as Error & { __openclawWorkflowLogged?: boolean }).__openclawWorkflowLogged);
}

export function frontmatterString(markdown: string, key: string): string {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return "";
  try {
    const parsed = parseYaml(match[1]) as Record<string, unknown> | null;
    const value = parsed?.[key];
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
    return value == null ? "" : String(value);
  } catch {
    return "";
  }
}

function upsertFrontmatterString(markdown: string, key: string, value: string): string {
  const blockMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  const line = `${key}: ${value}`;
  if (!blockMatch) {
    return `---\n${line}\n---\n\n${markdown}`;
  }

  const block = blockMatch[1];
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*.*$`, "m");
  const nextBlock = keyPattern.test(block) ? block.replace(keyPattern, line) : `${block}\n${line}`;
  return markdown.replace(blockMatch[0], `---\n${nextBlock}\n---\n`);
}

function hasExactMarkdownSection(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "im").test(markdown);
}

function buildRawNoteMarkdown(title: string, domain: string, content: string): string {
  const now = new Date();
  const dateStr = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
  return `---\ntitle: ${title}\ndomain: ${domain}\ntype: raw\ndate: ${dateStr}\ncreated: ${dateStr}\nstatus: draft\nsource: manual\nworkflow: ${domain}_to_raw\ntags: [raw, ${domain}]\n---\n\n# ${title}\n\n## Source\n\nManual input\n\n## Original Content\n\n${content}\n`;
}

function todayISO(): string {
  const now = new Date();
  return now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
}

function ensureGeneratedRegistryFrontmatter(markdown: string, workflowName: RunnableWorkflowName, context: WorkflowRunContext): string {
  if (workflowName !== "note_to_method" && workflowName !== "raw_to_insight") return markdown;

  const domain = context.domain?.trim() || "biotech";
  const type = workflowName === "note_to_method" ? "method" : "insight";
  const topic = context.topic?.trim() || (workflowName === "note_to_method" ? "Uncategorized" : "");
  const date = frontmatterString(markdown, "date") || todayISO();
  let next = markdown;
  const defaults: Record<string, string> = {
    type,
    status: "draft",
    date,
    created: frontmatterString(markdown, "created") || date,
    source: frontmatterString(markdown, "source") || context.path,
    domain,
    workflow: workflowName,
    tags: frontmatterString(markdown, "tags") || `[${type}, ${domain}]`
  };
  if (workflowName === "note_to_method") {
    defaults.topic = topic;
    defaults.method_family = frontmatterString(markdown, "method_family") || topic;
    defaults.tags = frontmatterString(markdown, "tags") || `[method, biotech, ${topic}]`;
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!frontmatterString(next, key)) {
      next = upsertFrontmatterString(next, key, value);
    }
  }
  return next;
}

function resolveRawDomainTargetDir(domain: string): string {
  switch (domain) {
    case "openclaw":
      return "PARA/03Resources/01Raw/OpenClaw";
    case "ai":
      return "PARA/03Resources/01Raw/AI";
    case "general":
      return "PARA/03Resources/01Raw/General";
    default:
      return "PARA/03Resources/01Raw/WeChat";
  }
}

export class WorkflowExecutor {
  constructor(private readonly options: WorkflowExecutorOptions) {}

  static conversionLabel(kind: RegistryConvertKind): string {
    return kind === "theory"
      ? "Theory"
      : kind === "case"
        ? "Case"
        : kind === "method"
          ? "Method"
          : kind === "doc"
            ? "Doc"
            : kind === "debug"
              ? "Debug"
              : kind === "system"
                ? "System"
                : kind === "case_by_domain"
                  ? "Case"
                  : "Insight";
  }

  static workflowNameForKind(kind: RegistryConvertKind): RunnableWorkflowName {
    return kind === "theory"
      ? "note_to_theory"
      : kind === "case"
        ? "note_to_case"
        : kind === "method"
          ? "note_to_method"
          : kind === "doc"
            ? "note_to_doc"
            : kind === "debug"
              ? "note_to_debug"
              : kind === "system"
                ? "note_to_system"
                : kind === "case_by_domain"
                  ? "note_to_case_by_domain"
                  : "raw_to_insight";
  }

  async executeRegistryConversion(params: {
    kind: RegistryConvertKind;
    activeFile: TFile;
    topic?: string;
    domain?: string;
    startedAt?: number;
  }): Promise<{ created: TFile; markdown: string; workflowName: RunnableWorkflowName; label: string }> {
    const { kind, activeFile, topic, domain } = params;
    const startedAt = params.startedAt ?? Date.now();
    const label = WorkflowExecutor.conversionLabel(kind);
    const action = `convert_to_${kind}`;
    const workflowName = WorkflowExecutor.workflowNameForKind(kind);
    const title = activeFile.basename;
    let step = "read_note";

    try {
      const content = await this.options.app.vault.cachedRead(activeFile);
      if (!content.trim()) throw new Error("Current note content is empty.");

      step = "run_workflow";
      const context: WorkflowRunContext = {
        title,
        path: activeFile.path,
        topic,
        domain,
        action
      };
      const markdown = await this.runWorkflow(workflowName, content, context);

      step = "resolve_output_path";
      const input = { title, path: activeFile.path, content, topic, domain };
      const resolved = kind === "theory" && topic
        ? await resolveTheoryWorkflow(this.options.app, input, topic as TheoryTopic)
        : kind === "theory" && domain && !topic
          ? await resolveTheoryByDomainWorkflow(this.options.app, input, domain as "openclaw" | "ai")
          : kind === "case" && topic
            ? await resolveCaseWorkflow(this.options.app, input, topic as CaseTopic)
            : kind === "doc" && domain
              ? await resolveDocWorkflow(this.options.app, input, domain as "openclaw" | "ai")
              : kind === "method" && topic
                ? await resolveMethodWorkflow(this.options.app, input, topic as MethodTopic)
                : kind === "debug" && domain
                  ? await resolveDebugWorkflow(this.options.app, input, domain as "openclaw" | "ai")
                  : kind === "system" && domain
                    ? await resolveSystemWorkflow(this.options.app, input, domain as "openclaw" | "ai")
                    : kind === "case_by_domain" && domain
                      ? await resolveCaseByDomainWorkflow(this.options.app, input, domain as "openclaw" | "ai")
                      : await resolveInsightWorkflow(this.options.app, input, (domain ?? "biotech") as InsightDomain);
      const targetPath = resolveOutputPath(this.options.app, resolved.targetDir, markdown, title, label, resolved.workflow.filenameStrategy);

      step = "write_target_note";
      const created = await this.options.writeFile(targetPath, markdown, topic ? `${kind}:${topic}` : kind);
      await logExecution(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: activeFile.path,
        targetNote: created.path,
        domain: frontmatterString(markdown, "domain") || "biotech",
        topic: topic ?? frontmatterString(markdown, "topic"),
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel: "PASS"
      });

      return { created, markdown, workflowName, label };
    } catch (error) {
      this.options.cancelPendingReply();
      if (!wasWorkflowErrorLogged(error)) {
        await logError(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: activeFile.path,
          step,
          errorType: errorType(error),
          message: errorMessage(error),
          durationMs: Date.now() - startedAt
        });
      }
      throw error;
    }
  }

  async executeWechatRaw(params: { url: string; startedAt?: number }): Promise<{ created: TFile; markdown: string }> {
    const action = "convert_to_raw";
    const workflowName = "wechat_to_raw";
    const startedAt = params.startedAt ?? Date.now();
    const url = params.url.trim();
    let step = "fetch_wechat";

    try {
      const resolved = await resolveRawSkillWorkflow(this.options.app);
      const markdown = await runWechatScript(this.options.getSettings(), url);

      this.options.onSystemTurn("WeChat article fetched. Validating…");

      let patchedMarkdown = markdown;
      patchedMarkdown = patchedMarkdown.replace(/^status: .+$/m, "status: draft");
      if (!/^domain:\s/m.test(patchedMarkdown)) {
        patchedMarkdown = patchedMarkdown.replace(/^status: .+$/m, "status: draft\ndomain: biotech");
      } else {
        patchedMarkdown = patchedMarkdown
          .replace(/^domain:[\s]*$/m, "domain: biotech")
          .replace(/^domain: .+$/m, "domain: biotech");
      }
      if (!/^workflow:\s/m.test(patchedMarkdown)) {
        patchedMarkdown = patchedMarkdown.replace(/^domain: .+$/m, "domain: biotech\nworkflow: wechat_to_raw");
      }
      patchedMarkdown = patchedMarkdown
        .replace(/^## 📌 原文$/gm, "## Original Content")
        .replace(/^## ⚙️ 提取记录$/gm, "## Source")
        .replace(/^## 🧠 AI摘要（自动生成）$/gm, "## Notes")
        .replace(/\n## 🔗 可转化方向[\s\S]*$/, "")
        .trimEnd();

      step = "postValidation";
      const noteResult = validateNote(patchedMarkdown);
      if (noteResult.level === "FAIL") {
        throw new Error(`Generated note failed validation: ${noteResult.message}`);
      }
      if (noteResult.level === "WARNING") {
        await logWarning(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: url,
          targetNote: "",
          domain: frontmatterString(patchedMarkdown, "domain"),
          message: noteResult.message,
          missingFields: noteResult.missingFields,
          missingSections: noteResult.missingSections,
          durationMs: Date.now() - startedAt
        });
      }

      step = "write_target_note";
      const targetPath = resolveRawOutputPath(this.options.app, resolved.targetDir, patchedMarkdown, url, resolved.workflow.filenameStrategy);
      const created = await this.options.writeFile(targetPath, patchedMarkdown, "raw");
      await logExecution(this.options.app, {
        action,
        workflow: resolved.workflow.name || workflowName,
        sourceNote: url,
        targetNote: created.path,
        domain: frontmatterString(patchedMarkdown, "domain"),
        topic: frontmatterString(patchedMarkdown, "topic"),
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel: noteResult.level
      });

      return { created, markdown: patchedMarkdown };
    } catch (error) {
      await logError(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: url,
        step,
        errorType: errorType(error),
        message: errorMessage(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  async executePdfRaw(params: { pdfPath: string; startedAt?: number }): Promise<{ created: TFile; markdown: string }> {
    const action = "convert_to_raw";
    const workflowName = "pdf_to_raw";
    const startedAt = params.startedAt ?? Date.now();
    const { pdfPath } = params;
    let step = "fetch_pdf";

    try {
      const markdown = await runPdfScript(this.options.app, this.options.getSettings(), pdfPath);
      this.options.onSystemTurn("PDF extracted. Validating…");

      let patchedMarkdown = markdown;
      patchedMarkdown = upsertFrontmatterString(patchedMarkdown, "status", "draft");
      patchedMarkdown = upsertFrontmatterString(patchedMarkdown, "domain", "biotech");
      patchedMarkdown = upsertFrontmatterString(patchedMarkdown, "workflow", workflowName);

      if (!hasExactMarkdownSection(patchedMarkdown, "source")) {
        patchedMarkdown += "\n\n## Source\n\n- PDF: " + pdfPath + "\n";
      }
      if (!hasExactMarkdownSection(patchedMarkdown, "original content")) {
        patchedMarkdown += "\n\n## Original Content\n\n[Content extracted from PDF]\n";
      }

      step = "postValidation";
      const noteResult = validateNote(patchedMarkdown);
      if (noteResult.level === "FAIL") {
        throw new Error(`Generated note failed validation: ${noteResult.message}`);
      }
      if (noteResult.level === "WARNING") {
        await logWarning(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: pdfPath,
          targetNote: "",
          domain: "biotech",
          message: noteResult.message,
          missingFields: noteResult.missingFields,
          missingSections: noteResult.missingSections,
          durationMs: Date.now() - startedAt
        });
      }

      step = "write_target_note";
      const targetDir = "PARA/03Resources/01Raw/PDF";
      const targetPath = resolveRawOutputPath(this.options.app, targetDir, patchedMarkdown, pdfPath, undefined);
      const created = await this.options.writeFile(targetPath, patchedMarkdown, "raw");
      await logExecution(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: pdfPath,
        targetNote: created.path,
        domain: "biotech",
        topic: "",
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel: noteResult.level
      });

      return { created, markdown: patchedMarkdown };
    } catch (error) {
      await logError(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: pdfPath,
        step,
        errorType: errorType(error),
        message: errorMessage(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  async executeGenericRaw(params: {
    domain: "biotech" | "openclaw" | "ai" | "general";
    content: string;
    startedAt?: number;
  }): Promise<{ created: TFile; markdown: string }> {
    const action = "convert_to_raw";
    const workflowName = `${params.domain}_to_raw`;
    const startedAt = params.startedAt ?? Date.now();
    let step = "generate_raw_note";

    try {
      const content = params.content.trim();
      const title = sanitizeFilenamePart(content.split("\n")[0]?.slice(0, 50) || "Raw Note");
      const markdown = buildRawNoteMarkdown(title, params.domain, content);

      step = "postValidation";
      const noteResult = validateNote(markdown);
      if (noteResult.level === "FAIL") {
        throw new Error(`Generated note failed validation: ${noteResult.message}`);
      }
      if (noteResult.level === "WARNING") {
        await logWarning(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: "",
          targetNote: "",
          domain: params.domain,
          message: noteResult.message,
          missingFields: noteResult.missingFields,
          missingSections: noteResult.missingSections,
          durationMs: Date.now() - startedAt
        });
      }

      step = "resolve_target_dir";
      const targetDir = resolveRawDomainTargetDir(params.domain);
      const targetPath = resolveRawOutputPath(this.options.app, targetDir, markdown, title, "raw");
      const created = await this.options.writeFile(targetPath, markdown, "raw");

      await logExecution(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: "",
        targetNote: created.path,
        domain: params.domain,
        topic: "",
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel: noteResult.level
      });

      return { created, markdown };
    } catch (error) {
      await logError(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: "",
        step,
        errorType: errorType(error),
        message: errorMessage(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  async executeRewriteCurrentNote(params: {
    activeFile: TFile;
    shouldFixAfterRewrite: boolean;
    startedAt?: number;
  }): Promise<TFile> {
    const action = "rewrite_current_note";
    const workflowName = "rewrite_current_note";
    const startedAt = params.startedAt ?? Date.now();
    const { activeFile } = params;
    const title = activeFile.basename || activeFile.name.replace(/\.md$/i, "");
    const context: WorkflowRunContext = { title, path: activeFile.path };
    let step = "read_note";

    try {
      const content = await this.options.app.vault.cachedRead(activeFile);
      if (!content.trim()) throw new Error("Current note content is empty.");

      step = "run_rewrite_workflow";
      const rewrittenMarkdown = await this.runWorkflow("rewrite_current_note", content, context);
      this.options.onSystemTurn("Rewrite finished. Waiting for Fix Schema choice…");

      let finalMarkdown = rewrittenMarkdown;
      if (params.shouldFixAfterRewrite) {
        step = "run_fix_frontmatter_workflow";
        this.options.onSystemTurn("Fix Schema started after Rewrite. Sending strict schema repair prompt…");
        finalMarkdown = await this.runWorkflow("fix_frontmatter", rewrittenMarkdown, context);
      } else {
        this.options.onSystemTurn("Fix Schema skipped. Writing rewritten note…");
      }

      step = "write_current_note";
      return await this.options.replaceFile(activeFile, finalMarkdown);
    } catch (error) {
      this.options.cancelPendingReply();
      if (!wasWorkflowErrorLogged(error)) {
        await logError(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: activeFile.path,
          step,
          errorType: errorType(error),
          message: errorMessage(error),
          durationMs: Date.now() - startedAt
        });
      }
      throw error;
    }
  }

  async executeFixCurrentSchema(params: { activeFile: TFile; startedAt?: number }): Promise<TFile> {
    const action = "fix_frontmatter";
    const workflowName = "fix_frontmatter";
    const startedAt = params.startedAt ?? Date.now();
    const { activeFile } = params;
    const title = activeFile.basename || activeFile.name.replace(/\.md$/i, "");
    let step = "read_note";

    try {
      const content = await this.options.app.vault.cachedRead(activeFile);
      if (!content.trim()) throw new Error("Current note content is empty.");

      step = "run_fix_frontmatter_workflow";
      const markdown = await this.runWorkflow("fix_frontmatter", content, {
        title,
        path: activeFile.path
      });

      step = "write_current_note";
      return await this.options.replaceFile(activeFile, markdown);
    } catch (error) {
      this.options.cancelPendingReply();
      if (!wasWorkflowErrorLogged(error)) {
        await logError(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: activeFile.path,
          step,
          errorType: errorType(error),
          message: errorMessage(error),
          durationMs: Date.now() - startedAt
        });
      }
      throw error;
    }
  }

  async runWorkflow(workflowName: RunnableWorkflowName, inputMarkdown: string, context: WorkflowRunContext): Promise<string> {
    const startedAt = Date.now();
    const action = context.action ?? workflowName;
    let step = "validate_input";

    try {
      if (!inputMarkdown.trim()) throw new Error("Current note content is empty.");

      step = "preValidation";
      const inputResult = validateInput({
        workflowName,
        currentNoteContent: inputMarkdown,
        topic: context.topic,
        domain: context.domain
      });
      if (inputResult.level === "FAIL") {
        throw new Error(inputResult.reason);
      }

      step = "resolve_registry";
      const input = {
        title: context.title,
        path: context.path,
        content: inputMarkdown,
        topic: context.topic,
        domain: context.domain
      };
      let prompt: string;
      if (workflowName === "rewrite_current_note") {
        prompt = (await resolveRewriteWorkflow(this.options.app, input)).prompt;
      } else if (workflowName === "fix_frontmatter") {
        prompt = (await resolveFixFrontmatterWorkflow(this.options.app, input)).prompt;
      } else if (workflowName === "raw_to_insight") {
        prompt = (await resolveInsightWorkflow(this.options.app, input, (context.domain || "biotech") as InsightDomain)).prompt;
      } else if (workflowName === "note_to_theory") {
        if (context.domain && context.domain !== "biotech") {
          prompt = (await resolveTheoryByDomainWorkflow(this.options.app, input, context.domain as "openclaw" | "ai")).prompt;
        } else {
          if (!context.topic) throw new Error("Missing topic for note_to_theory.");
          prompt = (await resolveTheoryWorkflow(this.options.app, input, context.topic as TheoryTopic)).prompt;
        }
      } else if (workflowName === "note_to_case") {
        if (!context.topic) throw new Error("Missing topic for note_to_case.");
        prompt = (await resolveCaseWorkflow(this.options.app, input, context.topic as CaseTopic)).prompt;
      } else if (workflowName === "note_to_method") {
        if (!context.topic) throw new Error("Missing topic for note_to_method.");
        prompt = (await resolveMethodWorkflow(this.options.app, input, context.topic as MethodTopic)).prompt;
      } else if (workflowName === "note_to_doc") {
        if (!context.domain) throw new Error("Missing domain for note_to_doc.");
        prompt = (await resolveDocWorkflow(this.options.app, input, context.domain as "openclaw" | "ai")).prompt;
      } else if (workflowName === "note_to_debug") {
        if (!context.domain) throw new Error("Missing domain for note_to_debug.");
        prompt = (await resolveDebugWorkflow(this.options.app, input, context.domain as "openclaw" | "ai")).prompt;
      } else if (workflowName === "note_to_system") {
        if (!context.domain) throw new Error("Missing domain for note_to_system.");
        prompt = (await resolveSystemWorkflow(this.options.app, input, context.domain as "openclaw" | "ai")).prompt;
      } else if (workflowName === "note_to_case_by_domain") {
        if (!context.domain) throw new Error("Missing domain for note_to_case_by_domain.");
        prompt = (await resolveCaseByDomainWorkflow(this.options.app, input, context.domain as "openclaw" | "ai")).prompt;
      } else {
        throw new Error(`Unsupported workflow: ${workflowName}`);
      }

      this.options.onSystemTurn(`Workflow ${workflowName} resolved. Sending prompt to OpenClaw…`);

      const replyPromise = this.options.waitForMarkdownReply();
      step = "send_openclaw";
      const res = await this.options.getClient()?.generateMarkdown({
        action: "generate_markdown",
        prompt,
        title: context.title,
        path: context.path,
        content: inputMarkdown
      });

      if (!res) throw new Error("OpenClaw client is not ready.");
      if (!res.ok) {
        this.options.cancelPendingReply();
        throw new Error(res.error?.message ?? `${workflowName} request rejected`);
      }

      this.options.onSystemTurn(`OpenClaw accepted ${workflowName}. Waiting for markdown reply…`);

      step = "wait_for_reply";
      const markdown = ensureGeneratedRegistryFrontmatter(normalizeMarkdownArtifact(await replyPromise), workflowName, context);
      if (!markdown.trim()) throw new Error("OpenClaw returned empty markdown.");

      step = "postValidation";
      const skipPostValidation =
        workflowName === "fix_frontmatter" ||
        workflowName === "rewrite_current_note" ||
        workflowName === "note_to_case_by_domain" ||
        (workflowName === "note_to_theory" && context.domain && context.domain !== "biotech");
      let validationLevel: "PASS" | "WARNING" = "PASS";
      if (!skipPostValidation) {
        const noteResult = validateNote(markdown);
        if (noteResult.level === "FAIL") {
          throw new Error(`Generated note failed validation: ${noteResult.message}`);
        }
        validationLevel = noteResult.level;
        if (noteResult.level === "WARNING") {
          await logWarning(this.options.app, {
            action,
            workflow: workflowName,
            sourceNote: context.path,
            targetNote: context.path,
            domain: frontmatterString(markdown, "domain"),
            topic: context.topic ?? frontmatterString(markdown, "topic"),
            message: noteResult.message,
            missingFields: noteResult.missingFields,
            missingSections: noteResult.missingSections,
            durationMs: Date.now() - startedAt
          });
        }
      }

      await logExecution(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: context.path,
        targetNote: context.path,
        domain: frontmatterString(markdown, "domain"),
        topic: context.topic ?? frontmatterString(markdown, "topic"),
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel
      });
      return markdown;
    } catch (error) {
      await logError(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: context.path,
        step,
        errorType: errorType(error),
        message: errorMessage(error),
        durationMs: Date.now() - startedAt
      });
      markWorkflowErrorLogged(error);
      throw error;
    }
  }
}
