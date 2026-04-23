import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Notice, type App as ObsidianApp, TFile, TFolder, type TAbstractFile } from "obsidian";
import type OpenClawControllerPlugin from "./main";
import { OpenClawClient } from "./openclaw/OpenClawClient";
import type { ChatTurn, ConnectionState, GatewayChatEvent, GatewayInbound, GatewayRes, Role, TokenUsage } from "./types";
import { DEFAULT_GATEWAY_URL, type OpenClawUiSkin } from "./settings";
import type { PermissionRequestModel } from "./ui/components/PermissionRequest";
import { loadLocalPrompts } from "./prompts/loadLocalPrompts";
import { Clock3, Cpu, FileSearch, Palette, Plus, RefreshCw, Send, Settings2, Sparkles, Wand2, X } from "lucide-react";
import type { OpenClawCatalogOption } from "./openclaw/localConfig";
import { logError, logExecution } from "./monitoring/workflowLogs";
import { validateNote } from "./validation";
import { AgentStatusBar } from "./ui/AgentStatusBar";
import { ChatPanel } from "./ui/ChatPanel";
import { InputBar } from "./ui/InputBar";
import {
  NoteLinkOrganizer,
  type LinkCandidate,
  type LinkOrganizerScanResult,
  type LinkScanDays
} from "./linking/NoteLinkOrganizer";
import {
  WorkflowExecutor,
  frontmatterString,
} from "./workflows/WorkflowExecutor";

const DEFAULT_AGENT_ID = "Obsidian";
const DEFAULT_SESSION_KEY = "agent:Obsidian:main";
const INSIGHT_ACTION_TIMEOUT_MS = 120000;

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function canonicalAgentSessionKey(agentId: string) {
  return `agent:${(agentId || DEFAULT_AGENT_ID).trim()}:main`;
}

function looksLikeMarkdownNote(value: string): boolean {
  const text = value.trim();
  return /^---\n[\s\S]*?\n---/m.test(text) || /^#\s+.+/m.test(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function isFolder(f: TAbstractFile): f is TFolder {
  return (f as TFolder).children != null;
}

function resolvePromptFolder(app: ObsidianApp): { path: string; tried: string[] } {
  const tried = ["Prompts", "AI_LAb/Prompts", "Templates/prompts", "Templates", "_templates/prompts", "_templates"];
  for (const p of tried) {
    const af = app.vault.getAbstractFileByPath(p);
    if (af && isFolder(af)) return { path: p, tried };
  }
  return { path: "Prompts", tried };
}

function resolveTemplatesFolder(app: ObsidianApp): { path: string; tried: string[] } {
  const tried = ["Templates", "AI_LAb/Templates", "_templates", "templates"];
  for (const p of tried) {
    const af = app.vault.getAbstractFileByPath(p);
    if (af && isFolder(af)) return { path: p, tried };
  }
  return { path: "Templates", tried };
}

type StreamState = {
  thinking: string;
  content: string;
  tokenUsage?: TokenUsage;
};

type ComposerReference = {
  kind: "prompt" | "template" | "file";
  path: string;
  label: string;
  auto?: boolean;
};

type PendingInsightConversion = {
  resolve: (markdown: string) => void;
  reject: (error: Error) => void;
  timeout: number;
};

class WeChatUrlModal extends Modal {
  private value = "";
  private settled = false;
  private resolve: (value: string | null) => void;

  constructor(app: ObsidianApp, resolve: (value: string | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-url-modal");
    contentEl.createEl("h2", { text: "Convert WeChat URL to Raw" });
    contentEl.createEl("p", {
      text: "Paste a WeChat article URL. OpenClaw will run the wechat-to-obsidian skill and return a raw markdown note."
    });
    const input = contentEl.createEl("input", {
      type: "url",
      placeholder: "https://mp.weixin.qq.com/..."
    });
    input.addClass("oc-url-modal-input");
    input.addEventListener("input", () => {
      this.value = input.value.trim();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.submit();
      if (event.key === "Escape") this.cancel();
    });

    const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const submit = actions.createEl("button", { text: "Convert" });
    submit.addClass("mod-cta");
    cancel.addEventListener("click", () => this.cancel());
    submit.addEventListener("click", () => this.submit());
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }

  private submit() {
    this.settled = true;
    this.resolve(this.value.trim());
    this.close();
  }

  private cancel() {
    this.settled = true;
    this.resolve(null);
    this.close();
  }
}

class RawContentModal extends Modal {
  private value = "";
  private settled = false;
  private resolve: (value: string | null) => void;

  constructor(app: ObsidianApp, resolve: (value: string | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-url-modal");
    contentEl.createEl("h2", { text: "Convert Content to Raw" });
    contentEl.createEl("p", {
      text: "Paste content (article text, notes, etc.) to convert into a raw markdown note."
    });
    const textarea = contentEl.createEl("textarea", {
      placeholder: "Paste content here..."
    });
    textarea.addClass("oc-url-modal-input");
    textarea.style.width = "100%";
    textarea.style.minHeight = "150px";
    textarea.style.resize = "vertical";
    textarea.addEventListener("input", () => {
      this.value = textarea.value.trim();
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.cancel();
    });

    const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const submit = actions.createEl("button", { text: "Convert" });
    submit.addClass("mod-cta");
    cancel.addEventListener("click", () => this.cancel());
    submit.addEventListener("click", () => this.submit());
    window.setTimeout(() => textarea.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }

  private submit() {
    this.settled = true;
    this.resolve(this.value.trim());
    this.close();
  }

  private cancel() {
    this.settled = true;
    this.resolve(null);
    this.close();
  }
}

class PdfFilePickerModal extends Modal {
  private settled = false;
  private resolve: (value: string | null) => void;
  private selectedPath: string | null = null;
  private allFiles: TFile[] = [];

  constructor(app: ObsidianApp, resolve: (value: string | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-url-modal");
    contentEl.createEl("h2", { text: "Select PDF to Convert" });
    contentEl.createEl("p", { text: "Choose a PDF file from your vault to convert to raw markdown." });

    // Search filter
    const filter = contentEl.createEl("input", {
      type: "text",
      placeholder: "Filter PDFs…"
    });
    filter.addClass("oc-url-modal-input");
    filter.style.width = "100%";
    filter.style.marginBottom = "8px";

    // File list container
    const listEl = contentEl.createDiv({ cls: "oc-file-list" });
    listEl.style.maxHeight = "300px";
    listEl.style.overflowY = "auto";
    listEl.style.border = "1px solid var(--background-modifier-border)";
    listEl.style.borderRadius = "6px";
    listEl.style.padding = "4px";

    // Load PDF files
    this.allFiles = this.app.vault.getFiles()
      .filter((f) => f.extension === "pdf")
      .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));

    const renderList = (query: string) => {
      listEl.empty();
      const filtered = query
        ? this.allFiles.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))
        : this.allFiles;

      if (filtered.length === 0) {
        const emptyEl = listEl.createEl("div", {
          text: this.allFiles.length === 0 ? "No PDF files found in vault." : "No matching files."
        });
        emptyEl.style.padding = "12px";
        emptyEl.style.color = "var(--text-muted)";
        return;
      }

      for (const file of filtered.slice(0, 100)) {
        const item = listEl.createDiv({
          cls: `oc-file-item${this.selectedPath === file.path ? " is-selected" : ""}`,
        });
        item.style.padding = "6px 10px";
        item.style.cursor = "pointer";
        item.style.borderRadius = "4px";
        item.style.fontSize = "13px";
        item.setAttr("data-path", file.path);
        item.createEl("div", { text: file.basename, cls: "oc-file-item-name" });
        const pathEl = item.createEl("div", {
          text: file.path,
          cls: "oc-file-item-path"
        });
        pathEl.style.fontSize = "11px";
        pathEl.style.color = "var(--text-muted)";
        item.addEventListener("click", () => {
          this.selectedPath = file.path;
          // Highlight selected
          listEl.findAll(".oc-file-item").forEach((el) => el.removeClass("is-selected"));
          item.addClass("is-selected");
        });
        item.addEventListener("dblclick", () => {
          this.settled = true;
          this.resolve(this.selectedPath);
          this.close();
        });
      }
    };

    filter.addEventListener("input", () => renderList(filter.value));
    renderList("");

    const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const submit = actions.createEl("button", { text: "Convert" });
    submit.addClass("mod-cta");
    cancel.addEventListener("click", () => this.cancel());
    submit.addEventListener("click", () => {
      if (this.selectedPath) {
        this.settled = true;
        this.resolve(this.selectedPath);
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }

  private cancel() {
    this.settled = true;
    this.resolve(null);
    this.close();
  }
}

const MARKITDOWN_EXTENSIONS = ["docx", "pptx", "xlsx", "html", "htm", "csv", "json", "xml", "zip", "epub", "md", "markdown"];

class MarkItDownFilePickerModal extends Modal {
  private settled = false;
  private resolve: (value: string | null) => void;
  private selectedPath: string | null = null;
  private allFiles: TFile[] = [];

  constructor(app: ObsidianApp, resolve: (value: string | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-url-modal");
    contentEl.createEl("h2", { text: "Select File to Convert via MarkItDown" });
    contentEl.createEl("p", {
      text: "Supported: DOCX, PPTX, XLSX, HTML, CSV, JSON, XML, ZIP, EPub, Markdown"
    });

    const filter = contentEl.createEl("input", {
      type: "text",
      placeholder: "Filter files…"
    });
    filter.addClass("oc-url-modal-input");
    filter.style.width = "100%";
    filter.style.marginBottom = "8px";

    const listEl = contentEl.createDiv({ cls: "oc-file-list" });
    listEl.style.maxHeight = "300px";
    listEl.style.overflowY = "auto";
    listEl.style.border = "1px solid var(--background-modifier-border)";
    listEl.style.borderRadius = "6px";
    listEl.style.padding = "4px";

    this.allFiles = this.app.vault.getFiles()
      .filter((f) => MARKITDOWN_EXTENSIONS.includes(f.extension.toLowerCase()))
      .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));

    const renderList = (query: string) => {
      listEl.empty();
      const filtered = query
        ? this.allFiles.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))
        : this.allFiles;

      if (filtered.length === 0) {
        const emptyEl = listEl.createEl("div", {
          text: this.allFiles.length === 0 ? "No supported files found in vault." : "No matching files."
        });
        emptyEl.style.padding = "12px";
        emptyEl.style.color = "var(--text-muted)";
        return;
      }

      for (const file of filtered.slice(0, 100)) {
        const item = listEl.createDiv({
          cls: `oc-file-item${this.selectedPath === file.path ? " is-selected" : ""}`,
        });
        item.style.padding = "6px 10px";
        item.style.cursor = "pointer";
        item.style.borderRadius = "4px";
        item.style.fontSize = "13px";
        item.setAttr("data-path", file.path);
        item.createEl("div", { text: file.basename, cls: "oc-file-item-name" });
        const pathEl = item.createEl("div", {
          text: `${file.extension.toUpperCase()} · ${file.path}`,
          cls: "oc-file-item-path"
        });
        pathEl.style.fontSize = "11px";
        pathEl.style.color = "var(--text-muted)";
        item.addEventListener("click", () => {
          this.selectedPath = file.path;
          listEl.findAll(".oc-file-item").forEach((el) => el.removeClass("is-selected"));
          item.addClass("is-selected");
        });
        item.addEventListener("dblclick", () => {
          this.settled = true;
          this.resolve(this.selectedPath);
          this.close();
        });
      }
    };

    filter.addEventListener("input", () => renderList(filter.value));
    renderList("");

    const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const submit = actions.createEl("button", { text: "Convert" });
    submit.addClass("mod-cta");
    cancel.addEventListener("click", () => {
      this.settled = true;
      this.resolve(null);
      this.close();
    });
    submit.addEventListener("click", () => {
      if (this.selectedPath) {
        this.settled = true;
        this.resolve(this.selectedPath);
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }
}

class RewriteFixConfirmModal extends Modal {
  private settled = false;
  private resolve: (continueFix: boolean) => void;

  constructor(app: ObsidianApp, resolve: (continueFix: boolean) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-url-modal");
    contentEl.createEl("h2", { text: "Rewrite complete" });
    contentEl.createEl("p", {
      text: "Rewrite 已完成，是否继续执行 Fix Schema？Continue 会先修复 frontmatter/schema，再写回当前笔记。"
    });

    const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    const skip = actions.createEl("button", { text: "Skip" });
    const proceed = actions.createEl("button", { text: "Continue" });
    proceed.addClass("mod-cta");
    skip.addEventListener("click", () => this.finish(false));
    proceed.addEventListener("click", () => this.finish(true));
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(false);
  }

  private finish(continueFix: boolean) {
    this.settled = true;
    this.resolve(continueFix);
    this.close();
  }
}

class LinkScanRangeModal extends Modal {
  private settled = false;
  private resolve: (days: LinkScanDays | null) => void;

  constructor(app: ObsidianApp, resolve: (days: LinkScanDays | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-url-modal");
    contentEl.createEl("h2", { text: "Organize Note Links" });
    contentEl.createEl("p", {
      text: "选择要整理的 Insight+ 笔记范围。Raw 和未加工提取内容不会参与链接整理。"
    });

    const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    for (const days of [3, 7, 14] as const) {
      const button = actions.createEl("button", { text: `${days} days` });
      if (days === 7) button.addClass("mod-cta");
      button.addEventListener("click", () => this.finish(days));
    }
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.finish(null));
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }

  private finish(days: LinkScanDays | null) {
    this.settled = true;
    this.resolve(days);
    this.close();
  }
}

class LinkCandidateReviewModal extends Modal {
  private settled = false;
  private selected = new Set<string>();
  private resolve: (candidates: LinkCandidate[] | null) => void;

  constructor(app: ObsidianApp, private readonly result: LinkOrganizerScanResult, resolve: (candidates: LinkCandidate[] | null) => void) {
    super(app);
    this.resolve = resolve;
    for (const candidate of result.candidates) {
      if (candidate.defaultSelected) this.selected.add(candidate.id);
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-url-modal");
    contentEl.createEl("h2", { text: "Review Related Notes" });
    contentEl.createEl("p", {
      text: `范围：最近 ${this.result.days} 天。Source ${this.result.sourceCount} 篇，Target ${this.result.targetCount} 篇，候选 ${this.result.candidates.length} 条。`
    });

    if (!this.result.candidates.length) {
      contentEl.createEl("p", { text: "没有找到足够稳的候选链接。" });
      const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
      const close = actions.createEl("button", { text: "Close" });
      close.addClass("mod-cta");
      close.addEventListener("click", () => this.finish(null));
      return;
    }

    const bulk = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    const selectStrong = bulk.createEl("button", { text: "Select 80+" });
    const clear = bulk.createEl("button", { text: "Clear" });
    selectStrong.addEventListener("click", () => {
      this.selected.clear();
      for (const candidate of this.result.candidates) {
        if (candidate.score >= 80) this.selected.add(candidate.id);
      }
      this.renderList(listEl);
    });
    clear.addEventListener("click", () => {
      this.selected.clear();
      this.renderList(listEl);
    });

    const listEl = contentEl.createDiv({ cls: "oc-file-list" });
    listEl.style.maxHeight = "420px";
    listEl.style.overflowY = "auto";
    listEl.style.border = "1px solid var(--background-modifier-border)";
    listEl.style.borderRadius = "6px";
    listEl.style.padding = "6px";
    this.renderList(listEl);

    const actions = contentEl.createDiv({ cls: "oc-url-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const apply = actions.createEl("button", { text: "Write selected links" });
    apply.addClass("mod-cta");
    cancel.addEventListener("click", () => this.finish(null));
    apply.addEventListener("click", () => {
      const approved = this.result.candidates.filter((candidate) => this.selected.has(candidate.id));
      this.finish(approved);
    });
  }

  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }

  private renderList(listEl: HTMLElement) {
    listEl.empty();
    for (const candidate of this.result.candidates) {
      const item = listEl.createDiv({ cls: "oc-file-item" });
      item.style.display = "grid";
      item.style.gridTemplateColumns = "24px 1fr";
      item.style.gap = "8px";
      item.style.padding = "8px";
      item.style.borderRadius = "4px";

      const checkbox = item.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(candidate.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(candidate.id);
        else this.selected.delete(candidate.id);
      });

      const body = item.createDiv();
      body.createEl("div", {
        text: `${candidate.sourceTitle} → ${candidate.targetTitle}`,
        cls: "oc-file-item-name"
      });
      const meta = body.createEl("div", {
        text: `Score ${candidate.score} · ${candidate.reasons.join("；")}`,
        cls: "oc-file-item-path"
      });
      meta.style.fontSize = "11px";
      meta.style.color = "var(--text-muted)";
      const path = body.createEl("div", {
        text: `${candidate.sourcePath} → ${candidate.targetPath}`,
        cls: "oc-file-item-path"
      });
      path.style.fontSize = "11px";
      path.style.color = "var(--text-faint)";
    }
  }

  private finish(candidates: LinkCandidate[] | null) {
    this.settled = true;
    this.resolve(candidates);
    this.close();
  }
}


function collectTextParts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectTextParts(item));
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of [
    "text",
    "content",
    "message",
    "markdown",
    "value",
    "delta",
    "answer",
    "output",
    "reply",
    "result",
    "data",
    "artifact",
    "markdownFile",
    "file"
  ]) {
    const field = record[key];
    if (typeof field === "string") parts.push(field);
    if (field && typeof field === "object" && !Array.isArray(field)) parts.push(...collectTextParts(field));
  }

  for (const key of ["content", "items", "parts", "segments", "artifacts", "results", "files"]) {
    const field = record[key];
    if (Array.isArray(field)) parts.push(...collectTextParts(field));
  }

  return parts;
}

function extractGatewayText(value: unknown): string {
  return collectTextParts(value)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

function isChatLikeEvent(event: string): boolean {
  const normalized = event.toLowerCase();
  return (
    normalized === "chat" ||
    normalized === "agent" ||
    normalized.includes("chat.message") ||
    normalized.includes("chat.response") ||
    normalized.includes("agent.message") ||
    normalized.includes("agent.response") ||
    normalized.includes("assistant")
  );
}

/**
 * Right-leaf React UI.
 * Implements:
 * - WS stream (delta/final)
 * - Thinking vs Final rendering
 * - action_request permission UI (approve/deny)
 * - local prompt quick buttons with {{selection}} replacement
 */
export function OpenClawViewReact(props: { app: ObsidianApp; plugin: OpenClawControllerPlugin }) {
  const pluginVersion = props.plugin.manifest.version ?? "dev";
  const [conn, setConn] = useState<ConnectionState>("disconnected");
  const [connErr, setConnErr] = useState<string | undefined>(undefined);
  const [token, setToken] = useState<string>(() => props.plugin.settings.token ?? "");
  const [sessionKey, setSessionKey] = useState<string>(() => props.plugin.settings.sessionKey ?? DEFAULT_SESSION_KEY);
  const [gatewayUrl, setGatewayUrl] = useState<string>(() => props.plugin.settings.gatewayUrl ?? DEFAULT_GATEWAY_URL);
  const [clientId, setClientId] = useState<string>(() => props.plugin.settings.clientId ?? "node-host");
  const [clientMode, setClientMode] = useState<string>(() => props.plugin.settings.clientMode ?? "node");
  const [nodeStatus, setNodeStatus] = useState<string>("Node mode");

  const [agent, setAgent] = useState<string>(() => props.plugin.settings.selectedAgentId ?? DEFAULT_AGENT_ID);
  const [model, setModel] = useState<string>(() => props.plugin.settings.selectedModel ?? "");
  const [uiSkin, setUiSkin] = useState<OpenClawUiSkin>(() => props.plugin.settings.uiSkin ?? "claude");
  const [quickAction, setQuickAction] = useState<string>("quick-actions");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pendingAction, setPendingAction] = useState<PermissionRequestModel | null>(null);
  const [stream, setStream] = useState<StreamState>({ thinking: "", content: "" });

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [{ path: promptFolder, tried: promptFolderTried }] = useState(() => resolvePromptFolder(props.app));
  const [{ path: templatesFolder, tried: templatesFolderTried }] = useState(() => resolveTemplatesFolder(props.app));
  const [prompts, setPrompts] = useState<{ path: string; name: string }[]>([]);
  const [templates, setTemplates] = useState<{ path: string; name: string }[]>([]);
  const [agentOptions, setAgentOptions] = useState<OpenClawCatalogOption[]>([{ value: DEFAULT_AGENT_ID, label: DEFAULT_AGENT_ID, description: "agent" }]);
  const [modelOptions, setModelOptions] = useState<OpenClawCatalogOption[]>([]);

  const [openPicker, setOpenPicker] = useState<null | "prompts" | "templates" | "files" | "history">(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [references, setReferences] = useState<ComposerReference[]>([]);
  const [activeNoteReference, setActiveNoteReference] = useState<ComposerReference | null>(null);
  const [dismissedActiveNotePath, setDismissedActiveNotePath] = useState<string | null>(null);
  const [vaultRevision, setVaultRevision] = useState(0);

  const clientRef = useRef<OpenClawClient | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastConfiguredTokenRef = useRef<string>("");
  const agentModelMapRef = useRef<Record<string, string | undefined>>({});
  const sessionKeyRef = useRef(sessionKey);
  const pendingInsightRef = useRef<PendingInsightConversion | null>(null);
  const convertToRawRef = useRef<() => void>(() => {});
  const convertPdfRawRef = useRef<() => void>(() => {});
  const convertMarkItDownRawRef = useRef<() => void>(() => {});
  const organizeLinksRef = useRef<() => void>(() => {});
  const rewriteCurrentNoteRef = useRef<() => void>(() => {});
  const fixFrontmatterRef = useRef<() => void>(() => {});
  const inputComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  function currentModelName(): string {
    return model || agentModelMapRef.current[agent] || "";
  }

  useEffect(() => {
    return props.plugin.onConvertToRawRequested(() => convertToRawRef.current());
  }, [props.plugin]);

  useEffect(() => {
    return props.plugin.onConvertToPdfRequested(() => convertPdfRawRef.current());
  }, [props.plugin]);

  useEffect(() => {
    return props.plugin.onConvertToMarkItDownRequested(() => convertMarkItDownRawRef.current());
  }, [props.plugin]);

  useEffect(() => {
    return props.plugin.onOrganizeLinksRequested(() => organizeLinksRef.current());
  }, [props.plugin]);

  useEffect(() => {
    return props.plugin.onRewriteCurrentNoteRequested(() => rewriteCurrentNoteRef.current());
  }, [props.plugin]);

  useEffect(() => {
    return props.plugin.onFixFrontmatterRequested(() => fixFrontmatterRef.current());
  }, [props.plugin]);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  const visibleTurns = useMemo(() => {
    return turns.filter((turn) => {
      const text = turn.content.trim().toLowerCase();
      if (turn.role !== "system") return true;
      if (!text) return false;
      if (text === "gateway event tick" || text === "gateway event health") return false;
      if (text.startsWith("gateway event ")) return false;
      if (text.startsWith("connect payload preview")) return false;
      if (text.startsWith("connect auth mode")) return false;
      if (text.startsWith("ws open.")) return false;
      if (text.startsWith("received connect.challenge")) return false;
      if (text.startsWith("handshake complete.")) return false;
      if (text.startsWith("node chat subscription active")) return false;
      if (text.startsWith("local device ready")) return false;
      if (text.startsWith("setup code points to")) return false;
      if (text.startsWith("subscribe failed: error: not connected")) return false;
      return (
        text.includes("failed") ||
        text.includes("error") ||
        text.includes("rejected") ||
        text.includes("convert to ") ||
        text.includes("organize note links") ||
        text.includes("registry ") ||
        text.includes("openclaw accepted") ||
        text.includes("pairing") ||
        text.includes("denied") ||
        text.includes("approved")
      );
    });
  }, [turns]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await props.plugin.loadOpenClawCatalog();
        if (cancelled) return;
        agentModelMapRef.current = catalog.agentDefaults;
        if (catalog.agents.length) setAgentOptions(catalog.agents);
        if (catalog.models.length) setModelOptions(catalog.models);
        const configuredAgent = props.plugin.settings.selectedAgentId || agent;
        const exact = catalog.agents.find((item) => item.value === configuredAgent);
        const caseMatch = catalog.agents.find((item) => item.value.toLowerCase() === configuredAgent.toLowerCase());
        const preferred = catalog.agents.find((item) => item.value.toLowerCase() === "obsidian");
        const normalizedAgent = (exact ?? caseMatch ?? preferred)?.value;
        if (normalizedAgent && normalizedAgent !== configuredAgent) {
          const nextSessionKey = canonicalAgentSessionKey(normalizedAgent);
          setAgent(normalizedAgent);
          setSessionKey(nextSessionKey);
          sessionKeyRef.current = nextSessionKey;
          props.plugin.settings.selectedAgentId = normalizedAgent;
          props.plugin.settings.sessionKey = nextSessionKey;
          const nextModel = catalog.agentDefaults[normalizedAgent];
          if (nextModel) {
            setModel(nextModel);
            props.plugin.settings.selectedModel = nextModel;
          }
          await props.plugin.saveSettings();
          await reconnect({ sessionKey: nextSessionKey });
        }
      } catch {
        // Ignore local config read failures and keep fallbacks.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.plugin]);

  useEffect(() => {
    const client = new OpenClawClient({
      url: gatewayUrl,
      clientVersion: (props.plugin.manifest as { version?: string } | undefined)?.version ?? "1.0.0",
      clientId,
      clientMode,
      deviceIdentity: props.plugin.settings.deviceIdentity,
      deviceAuth: props.plugin.settings.deviceAuth,
      onState: (s, err) => {
        setConn(s);
        setConnErr(err);
      },
      onDeviceIdentity: async (identity) => {
        await props.plugin.saveDeviceIdentity(identity);
      },
      onDeviceAuth: async (auth) => {
        await props.plugin.saveDeviceAuth(auth);
      },
      onGatewayMessage: (m) => onGatewayInbound(m),
      onNodeInvoke: async (frame) => await props.plugin.handleNodeInvoke(frame.command, frame.params),
      onSystemLog: (text) => {
        setTurns((prev) => [...prev, { id: uid(), role: "system", createdAt: Date.now(), content: text }]);
      }
    });
    clientRef.current = client;
    client.configure({
      token,
      sessionKey,
      deviceIdentity: props.plugin.settings.deviceIdentity,
      deviceAuth: props.plugin.settings.deviceAuth
    });
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl, clientId, clientMode]);

  // Keep local state in sync when user edits plugin settings.
  useEffect(() => {
    return props.plugin.onSettingsChanged(() => {
      setToken(props.plugin.settings.token ?? "");
      setSessionKey(props.plugin.settings.sessionKey ?? DEFAULT_SESSION_KEY);
      setAgent(props.plugin.settings.selectedAgentId ?? DEFAULT_AGENT_ID);
      setModel(props.plugin.settings.selectedModel ?? "");
      setGatewayUrl(props.plugin.settings.gatewayUrl ?? DEFAULT_GATEWAY_URL);
      setClientId(props.plugin.settings.clientId ?? "node-host");
      setClientMode(props.plugin.settings.clientMode ?? "node");
      setUiSkin(props.plugin.settings.uiSkin ?? "claude");
    });
  }, [props.plugin]);

  // If token was added after the socket already received challenge, force a reconnect.
  useEffect(() => {
    const trimmed = token.trim();
    if (!trimmed) {
      lastConfiguredTokenRef.current = "";
      return;
    }
    if (trimmed === lastConfiguredTokenRef.current) return;
    lastConfiguredTokenRef.current = trimmed;
    if (conn === "connected") return;
    // Only reconnect when the token value actually changes, not on first mount.
    void reconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function reconnect(overrides?: { token?: string; sessionKey?: string }) {
    const nextToken = overrides?.token ?? token;
    const nextSessionKey = overrides?.sessionKey ?? sessionKey;
    clientRef.current?.close();
    clientRef.current?.configure({
      token: nextToken,
      sessionKey: nextSessionKey,
      deviceIdentity: props.plugin.settings.deviceIdentity,
      deviceAuth: props.plugin.settings.deviceAuth
    });
    clientRef.current?.connect();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadLocalPrompts(props.app, promptFolder);
      if (!cancelled) setPrompts(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.app, promptFolder, vaultRevision]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadLocalPrompts(props.app, templatesFolder);
      if (!cancelled) setTemplates(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.app, templatesFolder, vaultRevision]);

  useEffect(() => {
    const bumpVaultRevision = () => setVaultRevision((value) => value + 1);
    const createRef = props.app.vault.on("create", bumpVaultRevision);
    const deleteRef = props.app.vault.on("delete", bumpVaultRevision);
    const renameRef = props.app.vault.on("rename", bumpVaultRevision);
    return () => {
      props.app.vault.offref(createRef);
      props.app.vault.offref(deleteRef);
      props.app.vault.offref(renameRef);
    };
  }, [props.app]);

  useEffect(() => {
    const syncActiveNoteReference = () => {
      const activeFile = props.app.workspace.getActiveFile();
      if (!activeFile) {
        setActiveNoteReference(null);
        setDismissedActiveNotePath(null);
        return;
      }
      if (activeFile.path === dismissedActiveNotePath) {
        setActiveNoteReference(null);
        return;
      }
      if (dismissedActiveNotePath && activeFile.path !== dismissedActiveNotePath) {
        setDismissedActiveNotePath(null);
      }
      setActiveNoteReference({
        kind: "file",
        path: activeFile.path,
        label: activeFile.basename ?? activeFile.name,
        auto: true
      });
    };

    syncActiveNoteReference();
    const ref = props.app.workspace.on("file-open", () => syncActiveNoteReference());
    return () => props.app.workspace.offref(ref);
  }, [dismissedActiveNotePath, props.app]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, stream.content, pendingAction?.id]);

  function resolvePendingInsight(markdown: string) {
    const pending = pendingInsightRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingInsightRef.current = null;
    pending.resolve(markdown);
  }

  function rejectPendingInsight(error: Error) {
    const pending = pendingInsightRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingInsightRef.current = null;
    pending.reject(error);
  }

  function cancelPendingInsight() {
    const pending = pendingInsightRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingInsightRef.current = null;
  }

  function waitForInsightReply(): Promise<string> {
    if (pendingInsightRef.current) {
      rejectPendingInsight(new Error("A previous Convert to Insight request was replaced by a new one."));
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingInsightRef.current = null;
        reject(new Error("Timed out waiting for OpenClaw insight markdown."));
      }, INSIGHT_ACTION_TIMEOUT_MS);

      pendingInsightRef.current = { resolve, reject, timeout };
    });
  }

  function onGatewayInbound(m: GatewayInbound) {
    if (m.type === "event" && isChatLikeEvent(m.event)) {
      const ev = m as GatewayChatEvent;
      const incomingSessionKey = typeof ev.payload.sessionKey === "string" ? ev.payload.sessionKey : "";
      if (incomingSessionKey && incomingSessionKey.toLowerCase() !== sessionKeyRef.current.toLowerCase()) return;
      const state = typeof (ev.payload as any).state === "string" ? String((ev.payload as any).state) : "";
      const message = (ev.payload as any).message ?? ev.payload.content;
      const text = extractGatewayText(message);
      if (state === "delta") {
        setStream((prev) => ({ ...prev, content: text }));
        return;
      }
      if (state === "error") {
        rejectPendingInsight(new Error(String((ev.payload as any).errorMessage ?? "OpenClaw returned an error")));
        setStream({ thinking: "", content: "" });
        setTurns((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            createdAt: Date.now(),
            content: `Chat error: ${String((ev.payload as any).errorMessage ?? "unknown")}`
          }
        ]);
        return;
      }
      if (state === "aborted") {
        setStream({ thinking: "", content: "" });
        return;
      }
      if (!text.trim()) {
        if (state === "final") setStream({ thinking: "", content: "" });
        return;
      }
      const roleRaw =
        typeof (message as Record<string, unknown> | undefined)?.role === "string"
          ? String((message as Record<string, unknown>).role)
          : typeof (ev.payload as any).kind === "string"
            ? String((ev.payload as any).kind)
            : "assistant";
      const role: Role = roleRaw === "assistant" ? "assistant" : roleRaw === "user" ? "user" : "system";
      setStream({ thinking: "", content: "" });
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.role === role &&
          last.content.trim() === text &&
          Math.abs(Date.now() - last.createdAt) < 5000
        ) {
          return prev;
        }
        return [...prev, { id: uid(), role, createdAt: Date.now(), content: text }];
      });
      if (role === "assistant") {
        props.plugin.artifactsText = text;
        resolvePendingInsight(text);
      }
      return;
    }

    if (m.type === "event") {
      if (m.event === "tick" || m.event === "health") {
        return;
      }
      const payload = (m as { payload?: unknown }).payload;
      if (m.event === "node.pair.requested") {
        const nodeId = typeof (payload as Record<string, unknown> | undefined)?.nodeId === "string" ? String((payload as Record<string, unknown>).nodeId) : "";
        if (nodeId) setNodeStatus(`Pending pair · ${nodeId.slice(0, 12)}…`);
        setTurns((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            createdAt: Date.now(),
            content: "Node pairing request created. Approve it in OpenClaw Devices / Nodes, then reconnect."
          }
        ]);
        return;
      }
      if (m.event === "node.pair.resolved") {
        const decision = typeof (payload as Record<string, unknown> | undefined)?.decision === "string" ? String((payload as Record<string, unknown>).decision) : "updated";
        const nodeId = typeof (payload as Record<string, unknown> | undefined)?.nodeId === "string" ? String((payload as Record<string, unknown>).nodeId) : "";
        if (nodeId) setNodeStatus(`${decision} · ${nodeId.slice(0, 12)}…`);
        setTurns((prev) => [
          ...prev,
          {
            id: uid(),
            role: "system",
            createdAt: Date.now(),
            content: `Node pairing ${decision}.`
          }
        ]);
        return;
      }
      if (m.event === "agent") {
        const summary = extractGatewayText(payload);
        if (!summary) return;
        setStream({ thinking: "", content: "" });
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (
            last &&
            last.role === "assistant" &&
            last.content.trim() === summary.trim() &&
            Math.abs(Date.now() - last.createdAt) < 5000
          ) {
            return prev;
          }
          return [...prev, { id: uid(), role: "assistant", createdAt: Date.now(), content: summary }];
        });
        props.plugin.artifactsText = summary;
        resolvePendingInsight(summary);
        return;
      }
      const summary = extractGatewayText(payload);
      setTurns((prev) => [
        ...prev,
        {
          id: uid(),
          role: "system",
          createdAt: Date.now(),
          content: summary
            ? `gateway event \`${m.event}\`:\n\n${summary}`
            : `gateway event \`${m.event}\``
        }
      ]);
      return;
    }

    if (m.type === "res") {
      const res = m as GatewayRes;
      // When connect OK, fetch history to seed session.
      if (res.ok && (res.payload as any)?.type === "hello-ok") {
        setNodeStatus(`Node active · ${clientId}/${clientMode}`);
        setTurns((prev) => [...prev, { id: uid(), role: "system", createdAt: Date.now(), content: "Handshake complete. Subscribing to node chat stream…" }]);
        clientRef.current
          ?.subscribeSessionMessages()
          .then((sub) => {
            setTurns((prev) => [...prev, { id: uid(), role: "system", createdAt: Date.now(), content: `Node chat subscription active: ${sessionKey}` }]);
          })
          .catch((e) => {
            setTurns((prev) => [...prev, { id: uid(), role: "system", createdAt: Date.now(), content: `Subscribe failed: ${String(e)}` }]);
          });
      }
      return;
    }
  }

  async function buildReferenceContext(items: ComposerReference[]) {
    if (!items.length) return "";

    const chunks = await Promise.all(
      items.map(async (item) => {
        const file = props.app.vault.getAbstractFileByPath(item.path);
        if (!file || !(file instanceof TFile)) {
          return `## ${item.kind}: ${item.label}\nPath: ${item.path}\nStatus: File not found`;
        }

        try {
          const raw = await props.app.vault.cachedRead(file);
          const content = raw.trim();
          const body = content ? content : "(empty file)";
          return `## ${item.kind}: ${item.label}\nPath: ${item.path}\n\n${body}`;
        } catch (error) {
          return `## ${item.kind}: ${item.label}\nPath: ${item.path}\nStatus: Read failed: ${String(error)}`;
        }
      })
    );

    return `Referenced context:\n\n${chunks.join("\n\n---\n\n")}`;
  }

  async function sendUser(content: string) {
    if (!content.trim()) return;
    if (conn !== "connected") {
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: "**Not connected**: wait for handshake, then retry." }
      ]);
      return;
    }

    setSending(true);
    const outgoingReferences = activeNoteReference
      ? [activeNoteReference, ...references.filter((reference) => reference.path !== activeNoteReference.path)]
      : references;
    setTurns((prev) => [
      ...prev,
      {
        id: uid(),
        role: "user",
        createdAt: Date.now(),
        content,
        references: outgoingReferences.map(({ kind, path, label }) => ({ kind, path, label }))
      }
    ]);
    try {
      const referenceContext = await buildReferenceContext(outgoingReferences);
      const outbound = referenceContext ? `${content.trim()}\n\n${referenceContext}` : content.trim();
      const res = await clientRef.current?.chatSend(outbound, outgoingReferences, { agentId: agent, model });
      if (!res) return;
        if (!res.ok) {
          setTurns((prev) => [
            ...prev,
            { id: uid(), role: "system", createdAt: Date.now(), content: `**Send rejected**: ${res.error?.message ?? "chat.send failed"}` }
          ]);
          return;
        }

        const summary = extractGatewayText((res.payload as any)?.message ?? res.payload);
        if (summary) {
          setTurns((prev) => [...prev, { id: uid(), role: "system", createdAt: Date.now(), content: `chat.send ack:\n\n${summary}` }]);
        }
    } catch (e) {
      setTurns((prev) => [...prev, { id: uid(), role: "system", createdAt: Date.now(), content: `**Send failed**: ${String(e)}` }]);
    } finally {
      setReferences([]);
      setSending(false);
    }
  }

  function appendTurn(turn: ChatTurn) {
    setTurns((prev) => [...prev, turn]);
  }

  function appendSystemTurn(content: string) {
    appendTurn({ id: uid(), role: "system", createdAt: Date.now(), content });
  }

  function appendUserTurn(content: string) {
    appendTurn({ id: uid(), role: "user", createdAt: Date.now(), content });
  }

  async function logRawConnectionError(startedAt: number, message: string) {
    new Notice(message);
    appendSystemTurn(`**Convert to Raw failed**: ${message}`);
    await logError(props.app, {
      action: "convert_to_raw",
      workflow: "convert_to_raw",
      sourceNote: "",
      step: "preflight",
      errorType: "ConnectionError",
      message,
      durationMs: Date.now() - startedAt
    });
  }

  async function withRawExecution(options: {
    startMessage: string;
    successNotice: (path: string) => string;
    successMessage: (path: string) => string;
    failureNotice: (message: string) => string;
    failureMessage: (message: string) => string;
    run: () => Promise<{ created: TFile | TFile[] }>;
  }) {
    setSending(true);
    appendSystemTurn(options.startMessage);

    try {
      const { created } = await options.run();
      const createdArray = Array.isArray(created) ? created : [created];
      const primaryPath = createdArray[0]?.path ?? "unknown";
      const folderPath = createdArray.length > 1
        ? primaryPath.split("/").slice(0, -1).join("/")
        : primaryPath;
      const displayPath = createdArray.length > 1
        ? `${folderPath}/ (${createdArray.length} sections)`
        : primaryPath;
      new Notice(options.successNotice(displayPath));
      appendSystemTurn(options.successMessage(displayPath));
    } catch (error) {
      const message = errorMessage(error);
      new Notice(options.failureNotice(message));
      appendSystemTurn(options.failureMessage(message));
    } finally {
      setSending(false);
    }
  }

  async function convertToRaw() {
    const startedAt = Date.now();

    if (conn !== "connected") {
      await logRawConnectionError(startedAt, "Convert to Raw failed: OpenClaw is not connected.");
      return;
    }

    await convertBiotechRaw(startedAt);
  }

  /**
   * Biotech: WeChat URL → wechat-to-obsidian skill
   */
  async function convertBiotechRaw(startedAt: number) {
    const workflowName = "wechat_to_raw";

    const url = await promptForWeChatUrl();
    if (url == null) {
      appendSystemTurn("Convert to Raw cancelled: no URL entered.");
      return;
    }
    if (!url.trim()) {
      const message = "WeChat URL is required.";
      new Notice(`Convert to Raw failed: ${message}`);
      appendSystemTurn(`**Convert to Raw failed**: ${message}`);
      await logError(props.app, {
        action: "convert_to_raw",
        workflow: workflowName,
        sourceNote: "",
        step: "validate_input",
        errorType: "ValidationError",
        message,
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const trimmedUrl = url.trim();
    appendUserTurn(`Convert to Raw: ${trimmedUrl}`);
    await withRawExecution({
      startMessage: "Convert to Raw started. Running WeChat fetch script…",
      successNotice: (path) => `Raw created: ${path}`,
      successMessage: (path) => `Raw created: ${path}`,
      failureNotice: (message) => `Convert to Raw failed: ${message}`,
      failureMessage: (message) => `**Convert to Raw failed**: ${message}`,
      run: () => createWorkflowExecutor().executeWechatRaw({ url: trimmedUrl, startedAt })
    });
  }

  /**
   * PDF: select a vault PDF file → python3 pdf_to_obsidian.py → raw note
   * Images extracted to PARA/03Resources/01Raw/Assets/{title}/
   */
  async function convertPdfRaw() {
    const startedAt = Date.now();

    if (conn !== "connected") {
      new Notice("Convert to Raw failed: OpenClaw is not connected.");
      appendSystemTurn("**Convert to Raw failed**: OpenClaw is not connected.");
      return;
    }

    const pdfPath = await promptForPdfPath();
    if (!pdfPath) {
      appendSystemTurn("Convert to PDF Raw cancelled: no file selected.");
      return;
    }

    const file = props.app.vault.getAbstractFileByPath(pdfPath) as TFile | null;
    const title = file?.basename ?? pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") ?? "PDF Note";
    appendUserTurn(`Convert to Raw (PDF): ${title}`);
    await withRawExecution({
      startMessage: "Extracting PDF content…",
      successNotice: (path) => `PDF Raw created: ${path}`,
      successMessage: (path) => `PDF Raw created: ${path}`,
      failureNotice: (message) => `Convert to PDF Raw failed: ${message}`,
      failureMessage: (message) => `**Convert to PDF Raw failed**: ${message}`,
      run: () => createWorkflowExecutor().executePdfRaw({ pdfPath, startedAt })
    });
  }

  function promptForPdfPath(): Promise<string | null> {
    return new Promise((resolve) => {
      new PdfFilePickerModal(props.app, resolve).open();
    });
  }

  function promptForMarkItDownPath(): Promise<string | null> {
    return new Promise((resolve) => {
      new MarkItDownFilePickerModal(props.app, resolve).open();
    });
  }

  /**
   * MarkItDown: select a vault file → markitdown CLI → raw note
   * Supports DOCX, PPTX, XLSX, HTML, CSV, JSON, XML, ZIP, EPub, Markdown
   */
  async function convertMarkItDownRaw() {
    const startedAt = Date.now();

    if (conn !== "connected") {
      new Notice("Convert to MarkItDown Raw failed: OpenClaw is not connected.");
      appendSystemTurn("**Convert to MarkItDown Raw failed**: OpenClaw is not connected.");
      return;
    }

    const domain = "general" as const;

    const inputPath = await promptForMarkItDownPath();
    if (!inputPath) {
      appendSystemTurn("Convert to MarkItDown Raw cancelled: no file selected.");
      return;
    }

    const file = props.app.vault.getAbstractFileByPath(inputPath) as TFile | null;
    const title = file?.basename ?? inputPath.split("/").pop() ?? "MarkItDown Note";
    appendUserTurn(`Convert to Raw (MarkItDown): ${title}`);
    await withRawExecution({
      startMessage: "Extracting content via MarkItDown…",
      successNotice: (path) => `MarkItDown Raw created: ${path}`,
      successMessage: (path) => `MarkItDown Raw created: ${path}`,
      failureNotice: (message) => `Convert to MarkItDown Raw failed: ${message}`,
      failureMessage: (message) => `**Convert to MarkItDown Raw failed**: ${message}`,
      run: () => createWorkflowExecutor().executeMarkItDownRaw({ inputPath, domain, startedAt })
    });
  }

  /**
   * Non-biotech domains (openclaw/ai/general): generic content → raw note
   */
  async function convertGenericRaw(domain: "biotech" | "openclaw" | "ai" | "general", startedAt: number) {
    const workflowName = `${domain}_to_raw`;

    const content = await promptForRawContent();
    if (content == null) {
      appendSystemTurn("Convert to Raw cancelled: no content entered.");
      return;
    }
    if (!content.trim()) {
      const message = "content is required.";
      new Notice("Convert to Raw failed: content is required.");
      appendSystemTurn(`**Convert to Raw failed**: ${message}`);
      await logError(props.app, {
        action: "convert_to_raw",
        workflow: workflowName,
        sourceNote: "",
        step: "validate_input",
        errorType: "ValidationError",
        message,
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const trimmedContent = content.trim();
    appendUserTurn(`Convert to Raw (${domain}): ${trimmedContent.slice(0, 80)}…`);
    await withRawExecution({
      startMessage: `Convert to Raw (${domain}) started. Processing content…`,
      successNotice: (path) => `Raw created: ${path}`,
      successMessage: (path) => `Raw created: ${path}`,
      failureNotice: (message) => `Convert to Raw failed: ${message}`,
      failureMessage: (message) => `**Convert to Raw failed**: ${message}`,
      run: () => createWorkflowExecutor().executeGenericRaw({ domain, content: trimmedContent, startedAt })
    });
  }

  async function organizeInsightLinks() {
    const action = "organize_note_links";
    const workflowName = "organize_related_notes";
    const startedAt = Date.now();
    let step = "choose_range";

    try {
      const days = await chooseLinkScanRange();
      if (!days) return;

      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `Organize Note Links started: scanning recent ${days} days.` }
      ]);
      new Notice(`Scanning Insight+ notes from the last ${days} days…`);

      step = "scan_candidates";
      const organizer = new NoteLinkOrganizer(props.app);
      const result = await organizer.scan(days);

      step = "review_candidates";
      const approved = await reviewLinkCandidates(result);
      if (!approved || approved.length === 0) {
        new Notice("Organize Note Links cancelled: no links selected.");
        setTurns((prev) => [
          ...prev,
          { id: uid(), role: "system", createdAt: Date.now(), content: "Organize Note Links cancelled: no links selected." }
        ]);
        return;
      }

      step = "write_related_notes";
      const writeResult = await organizer.applyApprovedLinks(approved);
      new Notice(`Related Notes updated: ${writeResult.addedLinks} links in ${writeResult.updatedFiles.length} files.`);
      setTurns((prev) => [
        ...prev,
        {
          id: uid(),
          role: "system",
          createdAt: Date.now(),
          content: `Organize Note Links complete: ${writeResult.addedLinks} links written to ${writeResult.updatedFiles.length} files.`
        }
      ]);
      await logExecution(props.app, {
        action,
        workflow: workflowName,
        sourceNote: "",
        targetNote: writeResult.updatedFiles.join(", "),
        domain: "",
        topic: "",
        model: "rules",
        durationMs: Date.now() - startedAt,
        validationLevel: "PASS"
      });
    } catch (error) {
      const message = errorMessage(error);
      new Notice(`Organize Note Links failed: ${message}`);
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `**Organize Note Links failed**: ${message}` }
      ]);
      await logError(props.app, {
        action,
        workflow: workflowName,
        sourceNote: "",
        step,
        errorType: errorType(error),
        message,
        durationMs: Date.now() - startedAt
      });
    }
  }

  async function rewriteCurrentNote() {
    const action = "rewrite_current_note";
    const workflowName = "rewrite_current_note";
    const startedAt = Date.now();
    let step = "preflight";
    if (conn !== "connected") {
      new Notice("Rewrite Note failed: OpenClaw is not connected.");
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `**Rewrite Note failed**: OpenClaw is not connected.` }
      ]);
      await logError(props.app, {
        action,
        workflow: workflowName,
        sourceNote: "",
        step,
        errorType: "ConnectionError",
        message: "OpenClaw is not connected.",
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const activeFile = props.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Rewrite Note failed: No markdown note is open.");
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `**Rewrite Note failed**: No markdown note is open.` }
      ]);
      await logError(props.app, {
        action,
        workflow: workflowName,
        sourceNote: activeFile?.path ?? "",
        step,
        errorType: "PreflightError",
        message: "No markdown note is open.",
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const title = activeFile.basename || activeFile.name.replace(/\.md$/i, "");
    setSending(true);
    setTurns((prev) => [
      ...prev,
      {
        id: uid(),
        role: "user",
        createdAt: Date.now(),
        content: `Rewrite Note: ${title}`,
        references: [{ kind: "file", path: activeFile.path, label: title }]
      },
      {
        id: uid(),
        role: "system",
        createdAt: Date.now(),
        content: "Rewrite Note started. Reading current note and registry…"
      }
    ]);
    console.log("[Rewrite] start", { path: activeFile.path });

    try {
      const shouldFix = await confirmFixSchemaAfterRewrite();
      const file = await createWorkflowExecutor().executeRewriteCurrentNote({
        activeFile,
        shouldFixAfterRewrite: shouldFix,
        startedAt
      });
      new Notice(`Rewrite Note complete: ${file.path}`);
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `Rewrite Note complete: ${file.path}` }
      ]);
      console.log("[Writeback] done", { path: file.path });
    } catch (error) {
      const message = errorMessage(error);
      new Notice(`Rewrite Note failed: ${message}`);
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `**Rewrite Note failed**: ${message}` }
      ]);
      console.error("[Rewrite] failed", error);
    } finally {
      setSending(false);
    }
  }

  function promptForWeChatUrl(): Promise<string | null> {
    return new Promise((resolve) => {
      new WeChatUrlModal(props.app, resolve).open();
    });
  }

  function promptForRawContent(): Promise<string | null> {
    return new Promise((resolve) => {
      new RawContentModal(props.app, resolve).open();
    });
  }

  function chooseLinkScanRange(): Promise<LinkScanDays | null> {
    return new Promise((resolve) => {
      new LinkScanRangeModal(props.app, resolve).open();
    });
  }

  function reviewLinkCandidates(result: LinkOrganizerScanResult): Promise<LinkCandidate[] | null> {
    return new Promise((resolve) => {
      new LinkCandidateReviewModal(props.app, result, resolve).open();
    });
  }

  function confirmFixSchemaAfterRewrite(): Promise<boolean> {
    return new Promise((resolve) => {
      new RewriteFixConfirmModal(props.app, resolve).open();
    });
  }

  function createWorkflowExecutor(): WorkflowExecutor {
    return new WorkflowExecutor({
      app: props.app,
      getSettings: () => props.plugin.settings,
      writeFile: (path, content, inferredType) => props.plugin.tools.writeFile(path, content, inferredType),
      replaceFile: (file, content) => props.plugin.tools.replaceFile(file, content),
      getClient: () => clientRef.current,
      waitForMarkdownReply: waitForInsightReply,
      cancelPendingReply: cancelPendingInsight,
      currentModelName,
      onSystemTurn: (content) => {
        setTurns((prev) => [
          ...prev,
          { id: uid(), role: "system", createdAt: Date.now(), content }
        ]);
      }
    });
  }

  async function fixCurrentSchema() {
    const action = "fix_frontmatter";
    const workflowName = "fix_frontmatter";
    const startedAt = Date.now();
    let step = "preflight";
    if (conn !== "connected") {
      new Notice("Fix Schema failed: OpenClaw is not connected.");
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `**Fix Schema failed**: OpenClaw is not connected.` }
      ]);
      await logError(props.app, {
        action,
        workflow: workflowName,
        sourceNote: "",
        step,
        errorType: "ConnectionError",
        message: "OpenClaw is not connected.",
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const activeFile = props.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Fix Schema failed: No markdown note is open.");
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `**Fix Schema failed**: No markdown note is open.` }
      ]);
      await logError(props.app, {
        action,
        workflow: workflowName,
        sourceNote: activeFile?.path ?? "",
        step,
        errorType: "PreflightError",
        message: "No markdown note is open.",
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const title = activeFile.basename || activeFile.name.replace(/\.md$/i, "");
    setSending(true);
    setTurns((prev) => [
      ...prev,
      {
        id: uid(),
        role: "user",
        createdAt: Date.now(),
        content: `Fix Schema: ${title}`,
        references: [{ kind: "file", path: activeFile.path, label: title }]
      },
      {
        id: uid(),
        role: "system",
        createdAt: Date.now(),
        content: "Fix Schema started. Reading current note and registry…"
      }
    ]);
    console.log("[OpenClaw] fix_frontmatter started", { path: activeFile.path });

    try {
      const file = await createWorkflowExecutor().executeFixCurrentSchema({ activeFile, startedAt });
      new Notice(`Fix Schema complete: ${file.path}`);
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `Fix Schema complete: ${file.path}` }
      ]);
      console.log("[OpenClaw] fix_frontmatter completed", { path: file.path });
    } catch (error) {
      const message = errorMessage(error);
      new Notice(`Fix Schema failed: ${message}`);
      setTurns((prev) => [...prev, { id: uid(), role: "system", createdAt: Date.now(), content: `**Fix Schema failed**: ${message}` }]);
      console.error("[OpenClaw] fix_frontmatter failed", error);
    } finally {
      setSending(false);
    }
  }

  function insertAtCursor(text: string) {
    const el = inputRef.current;
    if (!el) {
      setInput((v) => (v ? v + text : text));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = input.slice(0, start) + text + input.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function addReference(kind: "prompt" | "template" | "file", path: string, label: string) {
    setReferences((prev) => {
      const exists = prev.some((r) => r.kind === kind && r.path === path);
      if (exists) return prev;
      return [...prev, { kind, path, label }];
    });
    insertAtCursor((input && !input.endsWith(" ") ? " " : "") + `@${label}` + " ");
  }

  function removeReference(path: string) {
    setReferences((prev) => prev.filter((reference) => reference.path !== path));
    if (activeNoteReference?.path === path) {
      setDismissedActiveNotePath(path);
      setActiveNoteReference(null);
    }
  }

  function respondAction(id: string, approved: boolean) {
    // TODO: map gateway action protocol once available
    setPendingAction(null);
    setTurns((prev) => [
      ...prev,
      {
        id: uid(),
        role: "system",
        createdAt: Date.now(),
        content: approved ? `Approved action \`${id}\`.` : `Denied action \`${id}\`.`
      }
    ]);
  }

  function clearConversation() {
    setTurns([]);
    setStream({ thinking: "", content: "" });
    props.plugin.artifactsText = "";
  }

  async function startNewConversation() {
    clearConversation();
    if (conn !== "connected") return;
    try {
      const res = await clientRef.current?.chatSend("/new", [], { agentId: agent, model });
      if (res && !res.ok) {
        setTurns((prev) => [
          ...prev,
          { id: uid(), role: "system", createdAt: Date.now(), content: `**New chat failed**: ${res.error?.message ?? "request failed"}` }
        ]);
      }
    } catch (error) {
      setTurns((prev) => [
        ...prev,
        { id: uid(), role: "system", createdAt: Date.now(), content: `**New chat failed**: ${String(error)}` }
      ]);
    }
  }

  async function openPluginSettings() {
    const appAny = props.app as any;
    if (appAny.setting?.open) {
      appAny.setting.open();
      if (typeof appAny.setting.openTabById === "function") {
        appAny.setting.openTabById(props.plugin.manifest.id);
      }
    }
  }

  function removeTurn(turnId: string) {
    setTurns((prev) => prev.filter((turn) => turn.id !== turnId));
  }

  async function retryTurn(turn: ChatTurn) {
    if (turn.role === "user") {
      await sendUser(turn.content);
      return;
    }
    if (turn.role === "assistant") {
      const previousUser = [...turns]
        .reverse()
        .find((candidate) => candidate.createdAt <= turn.createdAt && candidate.role === "user");
      if (previousUser) await sendUser(previousUser.content);
    }
  }

  convertToRawRef.current = () => {
    void convertToRaw();
  };
  convertPdfRawRef.current = () => {
    void convertPdfRaw();
  };
  convertMarkItDownRawRef.current = () => {
    void convertMarkItDownRaw();
  };
  organizeLinksRef.current = () => {
    void organizeInsightLinks();
  };
  rewriteCurrentNoteRef.current = () => {
    void rewriteCurrentNote();
  };
  fixFrontmatterRef.current = () => {
    void fixCurrentSchema();
  };

  async function cycleUiSkin() {
    const nextSkin: OpenClawUiSkin = uiSkin === "apple" ? "claude" : "apple";
    setUiSkin(nextSkin);
    props.plugin.settings.uiSkin = nextSkin;
    await props.plugin.saveSettings();
  }

  return (
    <div className="oc-shell h-full w-full flex flex-col" data-skin={uiSkin}>
      {/* ── AgentStatusBar ── */}
      <AgentStatusBar
        conn={conn}
        connErr={connErr}
        pluginVersion={pluginVersion}
        nodeStatus={nodeStatus}
        agent={agent}
        model={model}
        uiSkin={uiSkin}
        agentModelMap={agentModelMapRef.current}
        onReconnect={() => void reconnect()}
        onCycleUiSkin={() => void cycleUiSkin()}
      />

      {/* ── ChatPanel ── */}
      <ChatPanel
        app={props.app}
        plugin={props.plugin}
        visibleTurns={visibleTurns}
        turns={turns}
        stream={stream}
        pendingAction={pendingAction}
        onRemoveTurn={removeTurn}
        onRetryTurn={(turn) => void retryTurn(turn)}
        onRespondAction={respondAction}
      />

      {/* ── InputBar ── */}
      <InputBar
        app={props.app}
        plugin={props.plugin}
        conn={conn}
        sending={sending}
        input={input}
        onInputChange={setInput}
        onSend={sendUser}
        activeNoteReference={activeNoteReference}
        references={references}
        onAddReference={addReference}
        onRemoveReference={removeReference}
        quickAction={quickAction}
        onQuickActionChange={setQuickAction}
        onConvertToRaw={convertToRaw}
        onConvertToPdf={convertPdfRaw}
        onConvertToMarkItDown={convertMarkItDownRaw}
        onOrganizeLinks={organizeInsightLinks}
        onRewriteNote={rewriteCurrentNote}
        onFixSchema={fixCurrentSchema}
        currentModelName={currentModelName()}
        visibleTurns={visibleTurns}
        vaultRevision={vaultRevision}
        openPicker={openPicker}
        onOpenPicker={setOpenPicker}
        scrollRef={scrollRef}
      />
    </div>
  );
}
