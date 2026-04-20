import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { OPENCLAW_VIEW_TYPE, OpenClawView } from "./view/OpenClawView";
import { DEFAULT_SETTINGS, type OpenClawSettings, type StoredDeviceAuth, type StoredDeviceIdentity } from "./settings";
import { OpenClawSettingTab } from "./OpenClawSettingTab";
import { ToolManager } from "./tools/ToolManager";
import type { NodeInvokeResult } from "./types";
import type { OpenClawCatalog } from "./openclaw/localConfig";
import { loadLocalOpenClawCatalog } from "./openclaw/localConfig";

// ---------------------------------------------------------------------------
// ConversionType
//
// Union of all conversion operations supported by the plugin.
// Each entry maps to one listener set and one notice message.
// ---------------------------------------------------------------------------
export type ConversionType =
  | "insight"
  | "theory"
  | "case"
  | "raw"
  | "markItDown"
  | "organizeLinks"
  | "rewrite"
  | "fixFrontmatter"
  | "translation";

export default class OpenClawControllerPlugin extends Plugin {
  settings: OpenClawSettings = DEFAULT_SETTINGS;
  tools!: ToolManager;
  // Artifact buffer for "one-click writeback"
  artifactsText = "";

  // -----------------------------------------------------------------------
  // Settings listeners — unchanged
  // -----------------------------------------------------------------------
  private settingsListeners = new Set<() => void>();

  // -----------------------------------------------------------------------
  // Conversion listeners — one set per ConversionType
  // Kept as named private fields (no string-reflection) for type safety.
  // -----------------------------------------------------------------------
  private convertToInsightListeners = new Set<() => void | Promise<void>>();
  private convertToTheoryListeners = new Set<() => void | Promise<void>>();
  private convertToCaseListeners = new Set<() => void | Promise<void>>();
  private convertToRawListeners = new Set<() => void | Promise<void>>();
  private convertToPdfListeners = new Set<() => void | Promise<void>>();
  private convertToMarkItDownListeners = new Set<() => void | Promise<void>>();
  private organizeLinksListeners = new Set<() => void | Promise<void>>();
  private rewriteCurrentNoteListeners = new Set<() => void | Promise<void>>();
  private fixFrontmatterListeners = new Set<() => void | Promise<void>>();
  private convertToTranslationListeners = new Set<() => void | Promise<void>>();

  // -----------------------------------------------------------------------
  // ConversionType → listener-set mapping
  //
  // Explicit, type-safe lookup — no string concatenation or reflection.
  // Adding a new ConversionType requires adding a new case here AND
  // registering the corresponding onXxxRequested() method below.
  // -----------------------------------------------------------------------
  private getConversionListeners(type: ConversionType): Set<() => void | Promise<void>> {
    switch (type) {
      case "insight":
        return this.convertToInsightListeners;
      case "theory":
        return this.convertToTheoryListeners;
      case "case":
        return this.convertToCaseListeners;
      case "raw":
        return this.convertToRawListeners;
      case "markItDown":
        return this.convertToMarkItDownListeners;
      case "organizeLinks":
        return this.organizeLinksListeners;
      case "rewrite":
        return this.rewriteCurrentNoteListeners;
      case "fixFrontmatter":
        return this.fixFrontmatterListeners;
      case "translation":
        return this.convertToTranslationListeners;
    }
  }

  // -----------------------------------------------------------------------
  // Notice message per ConversionType — matches original hard-coded strings
  // -----------------------------------------------------------------------
  private conversionNoticeMessage(type: ConversionType): string {
    switch (type) {
      case "insight":
        return "OpenClaw view is not ready yet. Please try Convert to Insight again.";
      case "theory":
        return "OpenClaw view is not ready yet. Please try Convert to Theory again.";
      case "case":
        return "OpenClaw view is not ready yet. Please try Convert to Case again.";
      case "raw":
        return "OpenClaw view is not ready yet. Please try Convert to Raw again.";
      case "markItDown":
        return "OpenClaw view is not ready yet. Please try Convert to MarkItDown again.";
      case "organizeLinks":
        return "OpenClaw view is not ready yet. Please try Organize Note Links again.";
      case "rewrite":
        return "OpenClaw view is not ready yet. Please try Rewrite Note again.";
      case "fixFrontmatter":
        return "OpenClaw view is not ready yet. Please try Fix Schema again.";
      case "translation":
        return "OpenClaw view is not ready yet. Please try Translate again.";
    }
  }

  // -----------------------------------------------------------------------
  // Unified conversion request handler
  //
  // All six convert-to commands funnel through here.
  // • Opens / activates the side panel first so the view is ready.
  // • Checks that at least one listener is registered (view is mounted).
  // • Fires all listeners in parallel — view decides what to do.
  // • Preserves exact original Notice messages and Promise.all semantics.
  // -----------------------------------------------------------------------
  private async requestConversion(type: ConversionType): Promise<void> {
    await this.activateView();
    const listeners = this.getConversionListeners(type);
    if (!listeners.size) {
      new Notice(this.conversionNoticeMessage(type));
      return;
    }
    await Promise.all([...listeners].map((cb) => cb()));
  }

  async onload() {
    await this.loadSettings();
    this.tools = new ToolManager(this.app, () => this.settings);
    this.registerView(OPENCLAW_VIEW_TYPE, (leaf) => new OpenClawView(leaf, this));

    this.addRibbonIcon("bot", "OpenClaw Controller", async () => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-openclaw-controller",
      name: "Open OpenClaw Controller",
      callback: () => this.activateView()
    });

    this.addCommand({
      id: "openclaw-writeback-artifacts",
      name: "OpenClaw: Insert latest reply into current cursor",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "W" }],
      callback: async () => {
        if (!this.artifactsText.trim()) return;
        await this.tools.insertIntoActiveNote(this.artifactsText);
      }
    });

    this.addCommand({
      id: "convert-to-insight",
      name: "OpenClaw: Convert current note to Insight",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") return false;
        if (!checking) {
          void this.requestConvertToInsight();
        }
        return true;
      }
    });

    this.addCommand({
      id: "convert-to-theory",
      name: "OpenClaw: Convert current note to Theory",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") return false;
        if (!checking) {
          void this.requestConvertToTheory();
        }
        return true;
      }
    });

    this.addCommand({
      id: "convert-to-case",
      name: "OpenClaw: Convert current note to Case",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") return false;
        if (!checking) {
          void this.requestConvertToCase();
        }
        return true;
      }
    });

    this.addCommand({
      id: "convert-to-raw",
      name: "OpenClaw: Convert WeChat URL to Raw note",
      checkCallback: (checking) => {
        if (!checking) {
          void this.requestConvertToRaw();
        }
        return true;
      }
    });

    this.addCommand({
      id: "convert-pdf-to-raw",
      name: "OpenClaw: Convert PDF to Raw note",
      checkCallback: (checking) => {
        if (!checking) {
          void this.requestConvertToPdf();
        }
        return true;
      }
    });

    this.addCommand({
      id: "convert-markitdown-to-raw",
      name: "OpenClaw: Convert MarkItDown file to Raw note",
      checkCallback: (checking) => {
        if (!checking) {
          void this.requestConvertToMarkItDown();
        }
        return true;
      }
    });

    this.addCommand({
      id: "organize-note-links",
      name: "OpenClaw: Organize Note links",
      checkCallback: (checking) => {
        if (!checking) {
          void this.requestOrganizeLinks();
        }
        return true;
      }
    });

    this.addCommand({
      id: "rewrite-current-note",
      name: "OpenClaw: Rewrite current note",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") return false;
        if (!checking) {
          void this.requestRewriteCurrentNote();
        }
        return true;
      }
    });

    this.addCommand({
      id: "fix-frontmatter",
      name: "OpenClaw: Fix current note schema",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") return false;
        if (!checking) {
          void this.requestFixFrontmatter();
        }
        return true;
      }
    });

    this.addCommand({
      id: "translate-current-note",
      name: "OpenClaw: Translate current note (English to Chinese)",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") return false;
        if (!checking) {
          void this.requestConvertToTranslation();
        }
        return true;
      }
    });

    this.addSettingTab(new OpenClawSettingTab(this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(OPENCLAW_VIEW_TYPE);
  }

  async activateView() {
    const leaf = this.getRightLeafOrCreate();
    await leaf.setViewState({ type: OPENCLAW_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private getRightLeafOrCreate(): WorkspaceLeaf {
    const leaf =
      this.app.workspace.getLeavesOfType(OPENCLAW_VIEW_TYPE)[0] ??
      this.app.workspace.getRightLeaf(false) ??
      this.app.workspace.getLeaf("split", "vertical");
    return leaf;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const needsObsidianMigration =
      (this.settings.selectedAgentId === "main" && this.settings.sessionKey === "agent:main:main") ||
      this.settings.selectedAgentId === "obsidian" ||
      (this.settings.sessionKey.toLowerCase() === "agent:obsidian:main" && this.settings.sessionKey !== "agent:Obsidian:main");
    if (needsObsidianMigration) {
      this.settings.selectedAgentId = "Obsidian";
      this.settings.sessionKey = "agent:Obsidian:main";
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    for (const cb of this.settingsListeners) cb();
  }

  async saveDeviceIdentity(identity: StoredDeviceIdentity) {
    this.settings.deviceIdentity = identity;
    await this.saveSettings();
  }

  async saveDeviceAuth(auth: StoredDeviceAuth | null) {
    this.settings.deviceAuth = auth;
    await this.saveSettings();
  }

  onSettingsChanged(cb: () => void): () => void {
    this.settingsListeners.add(cb);
    return () => this.settingsListeners.delete(cb);
  }

  onConvertToInsightRequested(cb: () => void | Promise<void>): () => void {
    this.convertToInsightListeners.add(cb);
    return () => this.convertToInsightListeners.delete(cb);
  }

  onConvertToTheoryRequested(cb: () => void | Promise<void>): () => void {
    this.convertToTheoryListeners.add(cb);
    return () => this.convertToTheoryListeners.delete(cb);
  }

  onConvertToCaseRequested(cb: () => void | Promise<void>): () => void {
    this.convertToCaseListeners.add(cb);
    return () => this.convertToCaseListeners.delete(cb);
  }

  onConvertToRawRequested(cb: () => void | Promise<void>): () => void {
    this.convertToRawListeners.add(cb);
    return () => this.convertToRawListeners.delete(cb);
  }

  onConvertToPdfRequested(cb: () => void | Promise<void>): () => void {
    this.convertToPdfListeners.add(cb);
    return () => this.convertToPdfListeners.delete(cb);
  }

  onConvertToMarkItDownRequested(cb: () => void | Promise<void>): () => void {
    this.convertToMarkItDownListeners.add(cb);
    return () => this.convertToMarkItDownListeners.delete(cb);
  }

  onOrganizeLinksRequested(cb: () => void | Promise<void>): () => void {
    this.organizeLinksListeners.add(cb);
    return () => this.organizeLinksListeners.delete(cb);
  }

  onRewriteCurrentNoteRequested(cb: () => void | Promise<void>): () => void {
    this.rewriteCurrentNoteListeners.add(cb);
    return () => this.rewriteCurrentNoteListeners.delete(cb);
  }

  onFixFrontmatterRequested(cb: () => void | Promise<void>): () => void {
    this.fixFrontmatterListeners.add(cb);
    return () => this.fixFrontmatterListeners.delete(cb);
  }

  onConvertToTranslationRequested(cb: () => void | Promise<void>): () => void {
    this.convertToTranslationListeners.add(cb);
    return () => this.convertToTranslationListeners.delete(cb);
  }

  // ---------------------------------------------------------------------------
  // Private requestConvertToXxx — now thin wrappers around requestConversion(type).
  //
  // Preserved for backwards compatibility with any external callers.
  // All execution logic lives in requestConversion(type) above.
  // ---------------------------------------------------------------------------
  private async requestConvertToInsight() {
    await this.requestConversion("insight");
  }

  private async requestConvertToTheory() {
    await this.requestConversion("theory");
  }

  private async requestConvertToCase() {
    await this.requestConversion("case");
  }

  private async requestConvertToRaw() {
    await this.requestConversion("raw");
  }

  private async requestConvertToPdf() {
    for (const listener of this.convertToPdfListeners) {
      await listener();
    }
  }

  private async requestConvertToMarkItDown() {
    await this.requestConversion("markItDown");
  }

  private async requestOrganizeLinks() {
    await this.requestConversion("organizeLinks");
  }

  private async requestRewriteCurrentNote() {
    await this.requestConversion("rewrite");
  }

  private async requestFixFrontmatter() {
    await this.requestConversion("fixFrontmatter");
  }

  private async requestConvertToTranslation() {
    await this.requestConversion("translation");
  }

  async loadOpenClawCatalog(): Promise<OpenClawCatalog> {
    return await loadLocalOpenClawCatalog();
  }

  async handleNodeInvoke(command: string, params: unknown): Promise<NodeInvokeResult> {
    const input = params && typeof params === "object" ? (params as Record<string, unknown>) : {};

    try {
      if (command === "obsidian.ping") {
        return {
          ok: true,
          payload: {
            ok: true,
            plugin: "obsidian-openclaw-controller",
            version: this.manifest.version ?? "dev"
          }
        };
      }

      if (command === "obsidian.read_active_note") {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          return { ok: false, error: { code: "NO_ACTIVE_FILE", message: "No active note is open." } };
        }
        const content = await this.app.vault.cachedRead(file);
        return {
          ok: true,
          payload: {
            path: file.path,
            name: file.name,
            content
          }
        };
      }

      if (command === "obsidian.append_active_note") {
        const content = typeof input.content === "string" ? input.content : "";
        const inferredType = typeof input.inferredType === "string" ? input.inferredType : undefined;
        if (!content.trim()) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "`content` is required." } };
        }
        const file = await this.tools.appendToActiveNote(content, inferredType);
        return {
          ok: true,
          payload: {
            path: file.path,
            action: "appended"
          }
        };
      }

      if (command === "obsidian.modify_file") {
        const target = typeof input.target === "string" ? input.target : "active_note";
        const content = typeof input.content === "string" ? input.content : "";
        const inferredType = typeof input.inferredType === "string" ? input.inferredType : undefined;
        if (target !== "active_note") {
          return { ok: false, error: { code: "UNSUPPORTED_TARGET", message: "`modify_file` currently supports active_note only." } };
        }
        if (!content.trim()) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "`content` is required." } };
        }
        const file = await this.tools.insertIntoActiveNote(content, inferredType);
        return {
          ok: true,
          payload: {
            path: file.path,
            action: "modified"
          }
        };
      }

      if (command === "obsidian.write_file") {
        const path = typeof input.path === "string" ? input.path : "";
        const content = typeof input.content === "string" ? input.content : "";
        const inferredType = typeof input.inferredType === "string" ? input.inferredType : undefined;
        if (!path.trim() || !content.trim()) {
          return { ok: false, error: { code: "INVALID_PARAMS", message: "`path` and `content` are required." } };
        }
        const file = await this.tools.writeFile(path, content, inferredType);
        return {
          ok: true,
          payload: {
            path: file.path,
            action: "created"
          }
        };
      }

      if (command === "obsidian.list_files") {
        const prefix = typeof input.prefix === "string" ? input.prefix.trim() : "";
        const limitRaw = typeof input.limit === "number" ? input.limit : 200;
        const limit = Math.max(1, Math.min(Math.trunc(limitRaw), 1000));
        const files = this.app.vault
          .getFiles()
          .filter((file) => !prefix || file.path.startsWith(prefix))
          .slice(0, limit)
          .map((file) => ({
            path: file.path,
            name: file.name,
            basename: file.basename,
            extension: file.extension
          }));
        return {
          ok: true,
          payload: {
            files,
            count: files.length
          }
        };
      }

      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_COMMAND",
          message: `Unsupported node command: ${command}`
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "COMMAND_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
}
