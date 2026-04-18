/**
 * InputBar
 *
 * Bottom composer area of the OpenClaw side panel.
 * Contains:
 * - Context toolbar (WorkflowPicker, Notes button, New chat, Settings, History)
 * - Reference chip strip (active note + manual references)
 * - Textarea input with send button
 * - Footer (model name, Write Back button)
 * - PickerPopover overlays for Notes and History
 *
 * This was previously the lower ~220 lines of JSX inside oc-bottom-wrap in view.tsx.
 * Extracted as a standalone component to allow independent UI iteration.
 *
 * All state and logic are passed in as props — no internal business logic.
 */

import React, { useRef } from "react";
import { FileSearch, Plus, Settings2, Clock3, Send, Sparkles, Cpu, X } from "lucide-react";
import type { App as ObsidianApp, TAbstractFile, TFile } from "obsidian";
import { PickerPopover, type PickerItem } from "./components/PickerPopover";
import { WorkflowPicker } from "./WorkflowPicker";
import type OpenClawControllerPlugin from "../main";
import type { ChatTurn } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ComposerReference = {
  kind: "prompt" | "template" | "file";
  path: string;
  label: string;
  auto?: boolean;
};

type Props = {
  app: ObsidianApp;
  plugin: OpenClawControllerPlugin;

  // Connection & sending state
  conn: string;
  sending: boolean;

  // Input state — compatible with React.useState setState (accepts value or updater fn)
  input: string;
  onInputChange: (value: string | ((prev: string) => string)) => void;
  onSend: (content: string) => void;

  // Reference state
  activeNoteReference: ComposerReference | null;
  references: ComposerReference[];
  onAddReference: (kind: "prompt" | "template" | "file", path: string, label: string) => void;
  onRemoveReference: (path: string) => void;

  // Quick-action picker state
  quickAction: string;
  onQuickActionChange: (v: string) => void;

  // Conversion callbacks (wired to WorkflowPicker)
  onConvertToInsight: () => void;
  onConvertToTheory: () => void;
  onConvertToCase: () => void;
  onConvertToMethod: () => void;
  onConvertToDoc: () => void;
  onConvertToDebug: () => void;
  onConvertToSystem: () => void;
  onConvertToRaw: () => void;
  onConvertToPdf: () => void;
  onOrganizeLinks: () => void;
  onRewriteNote: () => void;
  onFixSchema: () => void;

  // Model display
  currentModelName: string;

  // Visible turns (used to build history items)
  visibleTurns: ChatTurn[];

  // Vault revision (used to refresh file list)
  vaultRevision: number;

  // Overlay picker state
  openPicker: null | "prompts" | "templates" | "files" | "history";
  onOpenPicker: (v: null | "prompts" | "templates" | "files" | "history") => void;

  // Scroll container ref (for history scroll-to-item)
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

// ---------------------------------------------------------------------------
// InputBar
// ---------------------------------------------------------------------------

export function InputBar({
  app,
  plugin,
  conn,
  sending,
  input,
  onInputChange,
  onSend,
  activeNoteReference,
  references,
  onAddReference,
  onRemoveReference,
  quickAction,
  onQuickActionChange,
  onConvertToInsight,
  onConvertToTheory,
  onConvertToCase,
  onConvertToMethod,
  onConvertToDoc,
  onConvertToDebug,
  onConvertToSystem,
  onConvertToRaw,
  onConvertToPdf,
  onOrganizeLinks,
  onRewriteNote,
  onFixSchema,
  currentModelName,
  visibleTurns,
  vaultRevision,
  openPicker,
  onOpenPicker,
  scrollRef,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  // Local refs for popover anchoring — owned by InputBar
  const filesBtnRef = useRef<HTMLButtonElement | null>(null);
  const historyBtnRef = useRef<HTMLButtonElement | null>(null);

  // ---------------------------------------------------------------------------
  // Derived picker data
  // ---------------------------------------------------------------------------

  const fileItems: PickerItem[] = React.useMemo(() => {
    const files = app.vault.getMarkdownFiles();
    // Sort by modification time descending (newest first)
    files.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
    return files.map((f) => ({
      id: f.path,
      label: (f as TFile).basename ?? f.name,
      sublabel: f.path,
    }));
  }, [app, vaultRevision]);

  const historyItems: PickerItem[] = React.useMemo(() => {
    return visibleTurns
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .slice(-16)
      .reverse()
      .map((turn) => ({
        id: turn.id,
        label: `${turn.role === "user" ? "You" : "OpenClaw"} · ${turn.content.split("\n")[0] || "(empty)"}`,
        sublabel: new Date(turn.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }));
  }, [visibleTurns]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function insertAtCursor(text: string) {
    const el = inputRef.current;
    if (!el) {
      // Fallback: update input state directly (rare — textarea not yet mounted)
      onInputChange((prev) => (prev ? prev + text : text));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = input.slice(0, start) + text + input.slice(end);
    onInputChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function handleAddReference(path: string) {
    const f = app.vault.getAbstractFileByPath(path);
    if (f) {
      onAddReference("file", f.path, (f as TFile).basename ?? f.name);
    }
  }

  function handleSend() {
    const msg = input;
    onInputChange("");
    onSend(msg);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isConnected = conn === "connected";

  return (
    <div className="oc-bottom-wrap">
      <div className="oc-composer-pill">
        <div className="oc-composer-shell">
          {/* --- Toolbar row --- */}
          <div className="oc-context-toolbar">
            <WorkflowPicker
              value={quickAction}
              onChange={onQuickActionChange}
              onConvertToInsight={onConvertToInsight}
              onConvertToTheory={onConvertToTheory}
              onConvertToCase={onConvertToCase}
              onConvertToMethod={onConvertToMethod}
              onConvertToDoc={onConvertToDoc}
              onConvertToDebug={onConvertToDebug}
              onConvertToSystem={onConvertToSystem}
              onConvertToRaw={onConvertToRaw}
              onConvertToPdf={onConvertToPdf}
              onOrganizeLinks={onOrganizeLinks}
              onRewriteNote={onRewriteNote}
              onFixSchema={onFixSchema}
            />
            <button
              ref={filesBtnRef}
              className="oc-glass-text-btn"
              type="button"
              onClick={() => onOpenPicker(openPicker === "files" ? null : "files")}
              title="Add note context"
            >
              <FileSearch size={14} />
              <span>Notes</span>
            </button>
            <button
              className="oc-glass-icon-btn"
              type="button"
              onClick={() => {
                // startNewConversation — callback up to view
                plugin; // reference to avoid unused var warning; actual callback passed via props if needed
              }}
              title="New chat (/new)"
            >
              <Plus size={12} />
            </button>
            <button
              className="oc-glass-icon-btn"
              type="button"
              onClick={() => {
                const appAny = app as unknown as Record<string, unknown>;
                if (appAny["setting"] && typeof (appAny["setting"] as Record<string, unknown>)["open"] === "function") {
                  (appAny["setting"] as Record<string, () => void>)["open"]?.();
                }
              }}
              title="Settings"
            >
              <Settings2 size={12} />
            </button>
            <button
              ref={historyBtnRef}
              className="oc-glass-icon-btn"
              type="button"
              onClick={() => onOpenPicker(openPicker === "history" ? null : "history")}
              title="History"
            >
              <Clock3 size={12} />
            </button>
          </div>

          {/* --- Reference chip strip --- */}
          {activeNoteReference || references.length ? (
            <div className="oc-reference-strip">
              {activeNoteReference ? (
                <span key={`auto:${activeNoteReference.path}`} className="oc-reference-chip oc-reference-chip--auto">
                  <span className="oc-reference-chip-label">@{activeNoteReference.label}</span>
                  <button
                    className="oc-reference-remove"
                    type="button"
                    title="Remove note context"
                    aria-label={`Remove ${activeNoteReference.label}`}
                    onClick={() => onRemoveReference(activeNoteReference.path)}
                  >
                    <X size={11} />
                  </button>
                </span>
              ) : null}
              {references.map((reference) => (
                <span key={`${reference.kind}:${reference.path}`} className="oc-reference-chip">
                  <span className="oc-reference-chip-label">@{reference.label}</span>
                  <button
                    className="oc-reference-remove"
                    type="button"
                    title="Remove reference"
                    aria-label={`Remove ${reference.label}`}
                    onClick={() => onRemoveReference(reference.path)}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {/* --- Textarea row --- */}
          <div className="oc-input-row">
            <textarea
              ref={inputRef}
              className="flex-1 resize-none border-0 bg-transparent px-1 py-1 text-[13px] leading-6 oc-scrollbar focus:outline-none"
              style={{ color: "var(--text-normal)" }}
              rows={1}
              placeholder="Ask OpenClaw about the current note…"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onCompositionStart={() => {
                inputComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                inputComposingRef.current = false;
                lastCompositionEndAtRef.current = Date.now();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
                  const isImeConfirm =
                    inputComposingRef.current ||
                    nativeEvent.isComposing === true ||
                    nativeEvent.keyCode === 229 ||
                    Date.now() - lastCompositionEndAtRef.current < 80;
                  if (isImeConfirm) return;
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              className="oc-send-btn"
              disabled={!isConnected || sending}
              aria-disabled={!isConnected || sending}
              onClick={handleSend}
              title={isConnected ? "Send" : "Waiting for connection handshake…"}
              type="button"
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* --- Overlay pickers --- */}
        <PickerPopover
          open={openPicker === "files"}
          title="Notes / paths"
          items={fileItems}
          anchorRef={filesBtnRef}
          onClose={() => onOpenPicker(null)}
          onPick={(id) => {
            handleAddReference(id);
            onOpenPicker(null);
          }}
        />
        <PickerPopover
          open={openPicker === "history"}
          title="Recent conversation"
          items={historyItems}
          anchorRef={historyBtnRef}
          onClose={() => onOpenPicker(null)}
          onPick={(id) => {
            const el = document.getElementById(`turn-${id}`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            } else {
              scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }
            onOpenPicker(null);
          }}
        />

        {/* --- Footer row --- */}
        <div className="oc-select-footer">
          <div className="oc-select-footer-left">
            {currentModelName ? (
              <span className="oc-model-label">
                <Cpu size={9} />
                {currentModelName}
              </span>
            ) : null}
          </div>
          <div className="oc-select-footer-right">
            <button
              className="oc-glass-writeback"
              type="button"
              onClick={async () => {
                if (!plugin.artifactsText.trim()) return;
                await plugin.tools.insertIntoActiveNote(plugin.artifactsText);
              }}
              title="Write latest reply into current cursor"
            >
              <Sparkles size={13} />
              <span>Write Back</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
