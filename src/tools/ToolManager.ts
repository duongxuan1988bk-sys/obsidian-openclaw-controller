import { Notice, normalizePath, type App, type TFile, type Vault } from "obsidian";
import type { OpenClawSettings } from "../settings";
import { ensureSchemaFrontmatter } from "../schema/SchemaGuard";

export type ToolWriteFile = {
  tool: "write_file";
  path: string;
  content: string;
  inferredType?: "raw" | "insight" | "theory" | "case" | "method" | string;
};

export type ToolModifyFile = {
  tool: "modify_file";
  target: "active_note";
  content: string;
  inferredType?: "raw" | "insight" | "theory" | "case" | "method" | string;
};

export type ToolRequest = ToolWriteFile | ToolModifyFile;

export class ToolManager {
  private app: App;
  private settings: () => OpenClawSettings;

  constructor(app: App, settings: () => OpenClawSettings) {
    this.app = app;
    this.settings = settings;
  }

  async execute(req: ToolRequest): Promise<void> {
    if (req.tool === "write_file") {
      await this.writeFile(req.path, req.content, req.inferredType);
      return;
    }
    if (req.tool === "modify_file") {
      if (req.target !== "active_note") throw new Error("modify_file only supports active_note");
      await this.appendToActiveNote(req.content, req.inferredType);
      return;
    }
    throw new Error(`Unknown tool: ${(req as any).tool}`);
  }

  private detectType(content: string, inferredType?: string): "raw" | "insight" | "theory" | "case" | "method" {
    const hint = (inferredType ?? "").toLowerCase();
    if (hint.startsWith("theory:")) return "theory";
    if (hint.startsWith("case:")) return "case";
    if (hint.startsWith("method:")) return "method";
    if (hint === "raw" || hint === "insight" || hint === "theory" || hint === "case" || hint === "method") return hint;

    const text = content.toLowerCase();
    if (/method|protocol|步骤|workflow|方法/.test(text)) return "method";
    if (/issue|problem|bug|incident|troubleshoot|case/.test(text)) return "case";
    if (/theory|principle|architecture|mechanism|原理|总结/.test(text)) return "theory";
    return "insight";
  }

  private detectTheoryTopic(inferredType?: string): string | undefined {
    const [type, topic] = (inferredType ?? "").split(":");
    if (!["theory", "case", "method"].includes(type.toLowerCase())) return undefined;
    return topic?.trim() || undefined;
  }

  private deriveFilename(content: string, inferredType?: string): string {
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const frontmatterTitle = content.match(/^title\s*:\s*(.+)$/m)?.[1]?.trim();
    const seed = heading || frontmatterTitle || this.detectType(content, inferredType);
    const cleaned = seed
      .replace(/[*_`#[\]()>]/g, " ")
      .replace(/[\\/:?<>|"]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64);
    const fallback = `${this.detectType(content, inferredType)}-${Date.now()}`;
    return `${(cleaned || fallback).replace(/\s+/g, " ")}.md`;
  }

  resolveParaPath(inputPath: string, inferredType?: string): string {
    const s = this.settings();
    const raw = inputPath.trim();
    if (!raw) throw new Error("Empty path");

    // If planner already outputs PARA/... keep it.
    if (/^PARA\//i.test(raw)) return normalizePath(raw);

    const type = (inferredType ?? "").toLowerCase();
    const base =
      type === "case"
        ? s.paraCaseBase
        : type === "method"
          ? s.paraMethodBase
          : type === "theory"
            ? s.paraTheoryBase
            : s.paraInsightBase;

    return normalizePath(`${base.replace(/\/$/, "")}/${raw}`);
  }

  async writeFile(path: string, content: string, inferredType?: string): Promise<TFile> {
    const vault = this.app.vault;
    const normalizedInput = path.trim();
    const finalType = this.detectType(content, inferredType);
    const finalPath = /\.[a-z0-9]+$/i.test(normalizedInput) || normalizedInput.includes("/")
      ? normalizedInput
      : this.deriveFilename(content, finalType);
    const fullPath = this.resolveParaPath(finalPath, finalType);
    const fixed = ensureSchemaFrontmatter(content, {
      inferredType: finalType,
      theoryTopic: this.detectTheoryTopic(inferredType),
      activeNotePath: fullPath
    });

    await this.ensureParentFolders(vault, fullPath);
    const existing = this.app.vault.getAbstractFileByPath(fullPath);
    if (existing) throw new Error(`File already exists: ${fullPath}`);

    const file = await vault.create(fullPath, fixed);
    new Notice(`OpenClaw wrote: ${fullPath}`);
    return file;
  }

  async appendToActiveNote(content: string, inferredType?: string): Promise<TFile> {
    const file = this.app.workspace.getActiveFile();
    if (!file) throw new Error("No active file");
    if (file.extension !== "md") throw new Error("Active file is not markdown");

    const finalType = this.detectType(content, inferredType);
    const existing = await this.app.vault.cachedRead(file);
    const fixedExisting = ensureSchemaFrontmatter(existing, {
      inferredType: finalType,
      activeNotePath: file.path
    });

    const leaf = this.app.workspace.getMostRecentLeaf();
    const editor = (leaf?.view as any)?.editor;

    if (editor && typeof editor.replaceSelection === "function") {
      await this.app.vault.modify(file, fixedExisting);
      editor.replaceSelection(content.trim());
    } else {
      const next = fixedExisting.trimEnd() + "\n\n" + content.trim() + "\n";
      await this.app.vault.modify(file, next);
    }
    new Notice(`OpenClaw appended to: ${file.path}`);
    return file;
  }

  async insertIntoActiveNote(content: string, inferredType?: string): Promise<TFile> {
    return await this.appendToActiveNote(content, inferredType);
  }

  async replaceFile(file: TFile, content: string): Promise<TFile> {
    if (file.extension !== "md") throw new Error("Target file is not markdown");
    if (!content.trim()) throw new Error("Replacement content is empty");

    // Editing workflows such as rewrite_current_note intentionally replace the
    // active note in place. Schema/frontmatter decisions are delegated to the
    // registry prompt so we do not run creation-time schema repair here.
    await this.app.vault.modify(file, content.trimEnd() + "\n");
    new Notice(`OpenClaw replaced: ${file.path}`);
    return file;
  }

  async repairActiveNoteSchema(inferredType?: string): Promise<TFile> {
    const file = this.app.workspace.getActiveFile();
    if (!file) throw new Error("No active file");
    if (file.extension !== "md") throw new Error("Active file is not markdown");
    const existing = await this.app.vault.cachedRead(file);
    const fixed = ensureSchemaFrontmatter(existing, {
      inferredType,
      activeNotePath: file.path
    });
    await this.app.vault.modify(file, fixed);
    new Notice(`Schema repaired: ${file.path}`);
    return file;
  }

  private async ensureParentFolders(vault: Vault, fullPath: string) {
    const parts = fullPath.split("/");
    if (parts.length <= 1) return;
    let current = "";
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}/${part}` : part;
      if (!vault.getAbstractFileByPath(current)) {
        await vault.createFolder(current);
      }
    }
  }
}
