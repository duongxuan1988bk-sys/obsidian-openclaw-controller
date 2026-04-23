import { parseYaml, type App, type TFile } from "obsidian";
import { runMarkItDownScript, runPdfScript, runWechatScript } from "../localScripts/rawExtractors";
import { logError, logExecution, logWarning } from "../monitoring/workflowLogs";
import type { OpenClawClient } from "../openclaw/OpenClawClient";
import {
  resolveFixFrontmatterWorkflow,
  resolveRawSkillWorkflow,
  resolveRewriteWorkflow
} from "../registry/insightRegistry";
import type { OpenClawSettings } from "../settings";
import { resolveOutputPath, resolveRawOutputPath, sanitizeFilenamePart } from "../utils/notePaths";
import { validateInput, validateNote } from "../validation";
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

type EditableWorkflowName = "rewrite_current_note" | "fix_frontmatter";

type WorkflowRunContext = {
  title: string;
  path: string;
  action?: string;
};

function normalizeMarkdownArtifact(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced?.[1] ?? trimmed).trim() + "\n";
}

export function promoteToOriginalContent(markdown: string): string {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return `## Original Content\n\n${markdown.trim()}\n`;

  const [, frontmatter, body] = fmMatch;
  let inFence = false;
  let fenceChar = "";
  const demotedBody = body.trim().split("\n").map((line) => {
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
      return line;
    }
    if (inFence) return line;

    const headingMatch = line.match(/^([ \t]{0,3})(#{1,2})\s+(.+)/);
    if (!headingMatch) return line;
    const [, indent, hashes, rest] = headingMatch;
    return `${indent}${"#".repeat(hashes.length + 2)} ${rest}`;
  }).join("\n");

  return `---\n${frontmatter}\n---\n\n## Original Content\n\n${demotedBody}\n`;
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

function resolveRawDomainTargetDir(domain: RawDomain): string {
  switch (domain) {
    case "openclaw":
      return "PARA/03Resources/01Raw/OpenClaw";
    case "ai":
      return "PARA/03Resources/01Raw/AI";
    default:
      return "PARA/03Resources/01Raw/General";
  }
}

export class WorkflowExecutor {
  constructor(private readonly options: WorkflowExecutorOptions) {}

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
      patchedMarkdown = upsertFrontmatterStringIfMissing(patchedMarkdown, "workflow", workflowName);
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
        workflow: workflowName,
        sourceNote: url,
        targetNote: created.path,
        domain: frontmatterString(patchedMarkdown, "domain"),
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

      let patchedMarkdown = markdown;
      patchedMarkdown = normalizeRawExtractionStatus(patchedMarkdown);
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
      patchedMarkdown = upsertFrontmatterString(patchedMarkdown, "workflow", workflowName);

      step = "write_target_note";
      const targetPath = resolveRawOutputPath(this.options.app, "PARA/03Resources/01Raw/PDF", patchedMarkdown, pdfPath, undefined);
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

  async executeMarkItDownRaw(params: { inputPath: string; domain: RawDomain; startedAt?: number }): Promise<{ created: TFile; markdown: string }> {
    const action = "convert_to_raw";
    const workflowName = "markitdown_to_raw";
    const startedAt = params.startedAt ?? Date.now();
    const { inputPath, domain } = params;
    let step = "validate_input";

    try {
      const inputResult = validateInput({ workflowName, inputPath });
      if (inputResult.level === "FAIL") throw new Error(inputResult.reason);

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
    domain: RawDomain;
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

      step = "write_target_note";
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
      const markdown = await this.runWorkflow("fix_frontmatter", content, { title, path: activeFile.path });

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

  async runWorkflow(workflowName: EditableWorkflowName, inputMarkdown: string, context: WorkflowRunContext): Promise<string> {
    const startedAt = Date.now();
    const action = context.action ?? workflowName;
    let step = "validate_input";

    try {
      if (!inputMarkdown.trim()) throw new Error("Current note content is empty.");

      step = "preValidation";
      const inputResult = validateInput({
        workflowName,
        currentNoteContent: inputMarkdown
      });
      if (inputResult.level === "FAIL") throw new Error(inputResult.reason);
      if (inputResult.level === "WARNING") {
        this.options.onSystemTurn(`[WARNING] ${inputResult.reason}`);
      }

      step = "resolve_registry";
      const input = {
        title: context.title,
        path: context.path,
        content: inputMarkdown
      };
      const prompt = workflowName === "rewrite_current_note"
        ? (await resolveRewriteWorkflow(this.options.app, input)).prompt
        : (await resolveFixFrontmatterWorkflow(this.options.app, input)).prompt;

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
      const markdown = normalizeMarkdownArtifact(await replyPromise);
      if (!markdown.trim()) throw new Error("OpenClaw returned empty markdown.");

      step = "postValidation";
      if (workflowName === "fix_frontmatter") {
        const noteResult = validateNote(markdown);
        if (noteResult.level === "FAIL") {
          throw new Error(`Generated note failed validation: ${noteResult.message}`);
        }
        if (noteResult.level === "WARNING") {
          await logWarning(this.options.app, {
            action,
            workflow: workflowName,
            sourceNote: context.path,
            targetNote: context.path,
            domain: frontmatterString(markdown, "domain"),
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
        topic: "",
        model: this.options.currentModelName(),
        durationMs: Date.now() - startedAt,
        validationLevel: "PASS"
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
