import type { App, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import { logError, logExecution, logWarning } from "../monitoring/workflowLogs";

declare const require: (module: "child_process" | "fs") => {
  execSync: (command: string, options?: { encoding?: string; timeout?: number; cwd?: string; stdio?: unknown }) => string;
  execFileSync: (command: string, args: string[], options?: { encoding?: string; timeout?: number; cwd?: string; env?: Record<string, string> }) => string;
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  copyFileSync: (src: string, dest: string) => void;
  renameSync: (oldPath: string, newPath: string) => void;
  existsSync: (path: string) => boolean;
};
import { runMarkItDownScript, runPdfScript, runWechatScript } from "../localScripts/rawExtractors";
import {
  ensureMarkItDownRawMarkdown,
  resolveMarkItDownRawTargetDir,
  type RawDomain
} from "./markItDownRaw";
import {
  buildRawNoteMarkdown,
  hasExactMarkdownSection,
  normalizeRawExtractionStatus,
  upsertRawFrontmatterString as upsertFrontmatterString,
  upsertRawFrontmatterStringIfMissing as upsertFrontmatterStringIfMissing
} from "./rawMarkdown";
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

/**
 * Restructure translated markdown so that the body content lives under
 * ## Original Content. The LLM may return translated text at the root level;
 * this moves it into the required ## Original Content section and removes
 * the duplicate root-level content.
 */
export function promoteToOriginalContent(markdown: string): string {
  // Split off frontmatter
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    // No frontmatter; wrap entire body in ## Original Content
    return `## Original Content\n\n${markdown.trim()}\n`;
  }
  const [, frontmatter, body] = fmMatch;

  // Demote all #/## headings (outside fences) so they don't prematurely close
  // ## Original Content. Skip both ``` and ~~~ fences with 0-3 leading spaces.
  let inFence = false;
  let fenceChar = "";
  const demotedBody = body.trim().split("\n").map((line) => {
    // Detect fence open/close (``` or ~~~)
    const fenceMatch = line.match(/^[ \t]{0,3}(```|~~~)/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
        return line;
      }
      if (marker === fenceChar) {
        inFence = false;
        fenceChar = "";
        return line;
      }
      // Different fence marker inside an open fence — unmatched closer, stay in fence
      return line;
    }
    if (inFence) return line;

    // Demote root-level headings: ## → ####, # → ###
    const headingMatch = line.match(/^([ \t]{0,3})(#{1,2})\s+(.+)/);
    if (headingMatch) {
      const [, indent, hashes, rest] = headingMatch;
      const newLevel = hashes.length + 2;
      return `${indent}${"#".repeat(newLevel)} ${rest}`;
    }
    return line;
  }).join("\n");

  const ocSection = `## Original Content\n\n${demotedBody}\n`;
  return `---\n${frontmatter}\n---\n\n${ocSection}`;
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
      patchedMarkdown = normalizeRawExtractionStatus(patchedMarkdown);
      patchedMarkdown = upsertFrontmatterString(patchedMarkdown, "domain", "general");
      patchedMarkdown = upsertFrontmatterStringIfMissing(patchedMarkdown, "workflow", "wechat_to_raw");
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

  async executePdfRaw(params: { pdfPath: string; startedAt?: number }): Promise<{ created: TFile[]; markdown: string }> {
    const action = "convert_to_raw";
    const workflowName = "pdf_to_raw";
    const startedAt = params.startedAt ?? Date.now();
    const { pdfPath } = params;
    let step = "fetch_pdf";

    try {
      const markdown = await runPdfScript(this.options.app, this.options.getSettings(), pdfPath);
      this.options.onSystemTurn("PDF extracted. Building raw note…");

      // Normalize the markdown
      let patchedMarkdown = markdown;
      patchedMarkdown = normalizeRawExtractionStatus(patchedMarkdown);
      // Use IfMissing to preserve values already set by the python script
      patchedMarkdown = upsertFrontmatterStringIfMissing(patchedMarkdown, "domain", "general");
      patchedMarkdown = upsertFrontmatterStringIfMissing(patchedMarkdown, "type", "raw");
      patchedMarkdown = upsertFrontmatterStringIfMissing(patchedMarkdown, "source", pdfPath);
      patchedMarkdown = upsertFrontmatterStringIfMissing(patchedMarkdown, "date", new Date().toISOString().split("T")[0]);
      patchedMarkdown = upsertFrontmatterStringIfMissing(
        patchedMarkdown,
        "created",
        frontmatterString(patchedMarkdown, "date") || new Date().toISOString().split("T")[0]
      );
      patchedMarkdown = upsertFrontmatterStringIfMissing(patchedMarkdown, "tags", "[raw, pdf]");
      // workflow is always overridden to track which workflow generated the note
      patchedMarkdown = upsertFrontmatterString(patchedMarkdown, "workflow", workflowName);

      step = "write_target_note";
      const targetDir = "PARA/03Resources/01Raw/PDF";
      const targetPath = resolveRawOutputPath(this.options.app, targetDir, patchedMarkdown, pdfPath, undefined);
      const created = await this.options.writeFile(targetPath, patchedMarkdown, "raw");
      await logExecution(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: pdfPath,
        targetNote: created.path,
        domain: "general",
        topic: "",
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel: "PASS"
      });
      return { created: [created], markdown: patchedMarkdown };
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

  async executeTranslation(params: {
    activeFile: TFile;
    startedAt?: number;
  }): Promise<{ created: TFile; markdown: string }> {
    const action = "translate_note";
    const workflowName = "raw_to_translated";
    const startedAt = params.startedAt ?? Date.now();
    const { activeFile } = params;
    const title = activeFile.basename || activeFile.name.replace(/\.md$/i, "");
    let step = "read_note";

    try {
      const content = await this.options.app.vault.cachedRead(activeFile);
      if (!content.trim()) throw new Error("Current note content is empty.");

      step = "preValidation";
      const inputResult = validateInput({
        workflowName: "raw_to_translated",
        currentNoteContent: content
      });
      if (inputResult.level === "FAIL") {
        throw new Error(inputResult.reason);
      }
      if (inputResult.level === "WARNING") {
        this.options.onSystemTurn(`[WARNING] ${inputResult.reason}`);
      }

      step = "build_translation_prompt";
      const translationPrompt = [
        "You are a professional scientific translator.",
        "Translate the following English content to Chinese (Simplified Chinese).",
        "Preserve all markdown formatting, headings, code blocks, emphasis, and structural elements.",
        "Do NOT change or reinterpret the content -- translate literally and accurately.",
        "Do NOT add explanations or notes outside the translated markdown.",
        "",
        "Original content:",
        content,
        "",
        "Return only the translated markdown document."
      ].join("\n");

      this.options.onSystemTurn("Translating note to Chinese…");

      step = "send_openclaw";
      const replyPromise = this.options.waitForMarkdownReply();
      const res = await this.options.getClient()?.generateMarkdown({
        action: "generate_markdown",
        prompt: translationPrompt,
        title,
        path: activeFile.path,
        content
      });

      if (!res) throw new Error("OpenClaw client is not ready.");
      if (!res.ok) {
        this.options.cancelPendingReply();
        throw new Error(res.error?.message ?? "Translation request rejected");
      }

      step = "wait_for_reply";
      const translatedMarkdown = normalizeMarkdownArtifact(await replyPromise);
      if (!translatedMarkdown.trim()) throw new Error("OpenClaw returned empty translation.");

      step = "write_target_note";
      // Normalize frontmatter: ensure correct metadata on translated note
      let finalMarkdown = translatedMarkdown;
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "title", `${title} (Translated)`);
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "source", activeFile.path);
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "workflow", "raw_to_translated");
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "type", "raw");
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "status", "new");
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "tags", "[raw, translated]");
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "domain", frontmatterString(content, "domain") || "general");
      finalMarkdown = upsertFrontmatterString(finalMarkdown, "date", new Date().toISOString().split("T")[0]);

      // Ensure ## Original Content section exists with the translated body.
      // Must run BEFORE adding ## Source — otherwise Source gets demoted into Original Content.
      if (!hasExactMarkdownSection(finalMarkdown, "original content")) {
        finalMarkdown = promoteToOriginalContent(finalMarkdown);
      }
      // Ensure ## Source section exists (runs after promote so it stays at root level)
      if (!hasExactMarkdownSection(finalMarkdown, "source")) {
        finalMarkdown += "\n\n## Source\n\n- Original: [[" + activeFile.path + "]]\n";
      }

      step = "postValidation";
      const noteResult = validateNote(finalMarkdown);
      if (noteResult.level === "FAIL") {
        throw new Error(`Translated note failed validation: ${noteResult.message}`);
      }
      if (noteResult.level === "WARNING") {
        await logWarning(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: activeFile.path,
          targetNote: "",
          domain: frontmatterString(finalMarkdown, "domain") || "general",
          message: noteResult.message,
          missingFields: noteResult.missingFields,
          missingSections: noteResult.missingSections,
          durationMs: Date.now() - startedAt
        });
      }

      const targetDir = "PARA/03Resources/01Raw/Translated";
      const targetPath = resolveOutputPath(
        this.options.app,
        targetDir,
        finalMarkdown,
        title,
        "Translation"
      );
      const created = await this.options.writeFile(targetPath, finalMarkdown, "translation");

      await logExecution(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: activeFile.path,
        targetNote: created.path,
        domain: frontmatterString(finalMarkdown, "domain") || "general",
        topic: "",
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel: noteResult.level
      });

      return { created, markdown: finalMarkdown };
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
        markWorkflowErrorLogged(error);
      }
      throw error;
    }
  }

  async executeMarkItDownRaw(params: { inputPath: string; domain: RawDomain; startedAt?: number }): Promise<{ created: TFile; markdown: string }> {
    const action = "convert_to_raw";
    const workflowName = "markitdown_to_raw";
    const startedAt = params.startedAt ?? Date.now();
    const { inputPath, domain } = params;
    let step = "validate_input";

    try {
      const inputResult = validateInput({ workflowName, inputPath });
      if (inputResult.level === "FAIL") {
        throw new Error(inputResult.reason);
      }

      step = "fetch_markitdown";
      const markdown = await runMarkItDownScript(this.options.app, this.options.getSettings(), inputPath);
      this.options.onSystemTurn("MarkItDown extracted. Validating…");

      const patchedMarkdown = ensureMarkItDownRawMarkdown(markdown, inputPath, domain);

      step = "postValidation";
      const noteResult = validateNote(patchedMarkdown);
      if (noteResult.level === "FAIL") {
        throw new Error(`Generated note failed validation: ${noteResult.message}`);
      }
      if (noteResult.level === "WARNING") {
        await logWarning(this.options.app, {
          action,
          workflow: workflowName,
          sourceNote: inputPath,
          targetNote: "",
          domain,
          message: noteResult.message,
          missingFields: noteResult.missingFields,
          missingSections: noteResult.missingSections,
          durationMs: Date.now() - startedAt
        });
      }

      step = "write_target_note";
      const targetDir = resolveMarkItDownRawTargetDir(domain);
      const targetPath = resolveRawOutputPath(this.options.app, targetDir, patchedMarkdown, inputPath, undefined);
      const created = await this.options.writeFile(targetPath, patchedMarkdown, "raw");
      await logExecution(this.options.app, {
        action,
        workflow: workflowName,
        sourceNote: inputPath,
        targetNote: created.path,
        domain,
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
        sourceNote: inputPath,
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
      if (inputResult.level === "WARNING") {
        this.options.onSystemTurn(`[WARNING] ${inputResult.reason}`);
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

  private getVaultFileSystemRoot(): string {
    const adapter = this.options.app.vault.adapter as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();
    if (!basePath) throw new Error("Cannot resolve vault filesystem path: adapter.getBasePath not available");
    return basePath;
  }

  async executeImageGeneration(params: {
    activeFile: TFile;
    startedAt?: number;
  }): Promise<{ imagePath: string; imageRelativePath: string; prompt: string }> {
    const action = "generate_image";
    const startedAt = params.startedAt ?? Date.now();
    const { activeFile } = params;
    const title = activeFile.basename;
    let step = "read_note";

    const MMX_PATH = "/Users/hushaozhi/.npm-global/bin/mmx";
    const IMAGE_DIR = "PARA/03Resources/03Domains/02AI/00image";

    // Use adapter.getBasePath() to get real filesystem path
    const vaultRootFs = this.getVaultFileSystemRoot();
    const vaultImagesDir = `${vaultRootFs}/${IMAGE_DIR}`;

    try {
      const content = await this.options.app.vault.cachedRead(activeFile);
      if (!content.trim()) throw new Error("Current note content is empty.");

      step = "send_to_llm";
      this.options.onSystemTurn("Generating image prompt…");

      const imagePromptRequest = [
        "Based on the following note, generate a concise English image generation prompt (1-2 sentences, suitable for DALL-E/Midjourney).",
        "Include the main subject, scene, style, and mood. Be specific but concise.",
        "Only return the image prompt, nothing else.",
        "",
        "Note title: " + title,
        "Note content (first 1500 chars):",
        content.substring(0, 1500)
      ].join("\n");

      const replyPromise = this.options.waitForMarkdownReply();
      const res = await this.options.getClient()?.chatSend(imagePromptRequest);

      if (!res) throw new Error("OpenClaw client is not ready.");
      if (!res.ok) {
        this.options.cancelPendingReply();
        throw new Error(res.error?.message ?? "Image prompt request rejected");
      }

      step = "wait_for_prompt";
      const imagePrompt = (await replyPromise).trim();
      if (!imagePrompt) throw new Error("LLM returned empty image prompt.");

      this.options.onSystemTurn(`Image prompt: ${imagePrompt}`);

      step = "call_mmx";
      const timestamp = Date.now();
      const safeTitle = sanitizeFilenamePart(title).substring(0, 30);
      const imageFilename = `${timestamp}_${safeTitle}.jpg`;

      // Use execFile with argv array to avoid shell injection (no string concatenation)
      // Include common bin directories in PATH so env-shebang scripts (e.g., #!/usr/bin/env node) can find node
      const mmxArgs = ["image", "generate", "--resolution", "2048x1024", "--output", "json", imagePrompt];
      const mmxOutput = require("child_process").execFileSync(MMX_PATH, mmxArgs, {
        encoding: "utf-8",
        timeout: 120000,
        cwd: vaultRootFs,
        env: { PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin" }
      });
      const mmxResult = JSON.parse(mmxOutput);
      const generatedFileName = mmxResult.saved?.[0];
      if (!generatedFileName) throw new Error("mmx did not return saved file path.");

      // mmx saves relative to cwd; construct absolute path to the saved file
      const generatedFileAbs = `${vaultRootFs}/${generatedFileName}`;
      const fs = require("fs");
      if (!fs.existsSync(generatedFileAbs)) {
        throw new Error(`mmx saved file not found at: ${generatedFileAbs}`);
      }
      fs.mkdirSync(vaultImagesDir, { recursive: true });
      const finalDest = `${vaultImagesDir}/${imageFilename}`;
      fs.copyFileSync(generatedFileAbs, finalDest);

      step = "append_to_note";
      const imageRelativePath = `${IMAGE_DIR}/${imageFilename}`;
      const imageMarkdown = `\n\n![${title}](${imageRelativePath})\n`;
      const currentContent = await this.options.app.vault.cachedRead(activeFile);
      await this.options.replaceFile(activeFile, currentContent + imageMarkdown);

      this.options.onSystemTurn(`Image saved: ${imageFilename}`);

      return { imagePath: `${vaultImagesDir}/${imageFilename}`, imageRelativePath, prompt: imagePrompt };
    } catch (error) {
      this.options.cancelPendingReply();
      await logError(this.options.app, {
        action,
        workflow: "generate_image",
        sourceNote: activeFile.path,
        step,
        errorType: errorType(error),
        message: errorMessage(error),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }
}
