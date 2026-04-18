import React, { useMemo, useState } from "react";
import { Notice, type App, type Component } from "obsidian";
import type { ChatTurn } from "../../types";
import { useObsidianMarkdown } from "../markdown/useObsidianMarkdown";

export function ChatMessage(props: {
  app: App;
  component: Component;
  turn: ChatTurn;
  onDelete?: (turn: ChatTurn) => void;
  onRetry?: (turn: ChatTurn) => void;
}) {
  const { turn } = props;
  const [showThinking, setShowThinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [finalEl, setFinalEl] = useState<HTMLDivElement | null>(null);
  const [thinkingEl, setThinkingEl] = useState<HTMLDivElement | null>(null);

  const roleLabel = useMemo(() => {
    if (turn.role === "user") return "You";
    if (turn.role === "system") return "System";
    return "OpenClaw";
  }, [turn.role]);

  useObsidianMarkdown(props.app, finalEl, turn.content, props.component);
  useObsidianMarkdown(props.app, thinkingEl, turn.thinking ?? "", props.component);

  const hasThinking = Boolean(turn.thinking && turn.thinking.trim().length > 0);
  const isAssistant = turn.role === "assistant";
  const isStreaming = turn.id === "stream";
  const isUser = turn.role === "user";
  const isSystem = turn.role === "system";
  const roleIcon = isUser ? "🥳" : isSystem ? "系" : "🦞";
  const sentReferences = isUser ? turn.references ?? [] : [];

  const bubbleClass = isUser ? "oc-message-bubble oc-message-bubble--user" : isSystem ? "oc-message-bubble oc-message-bubble--system" : "oc-message-bubble oc-message-bubble--assistant";
  const canRetry = !isStreaming && (turn.role === "user" || turn.role === "assistant");
  const canDelete = !isStreaming;

  async function copyTurn() {
    const text = [turn.content, turn.thinking].filter((part) => typeof part === "string" && part.trim()).join("\n\n");
    if (!text.trim()) {
      new Notice("Nothing to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.setAttribute("readonly", "true");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
    new Notice("Copied message.");
  }

  return (
    <div id={`turn-${turn.id}`} className={`px-2 py-2 ${isUser ? "oc-message-row oc-message-row--user" : ""}`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`oc-role-badge ${isUser ? "oc-role-badge--user" : isSystem ? "oc-role-badge--system" : "oc-role-badge--assistant"}`}>
            {roleIcon}
          </span>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--oc-muted)" }}>
            {roleLabel}
          </div>
        </div>
        <div className="text-[11px]" style={{ color: "var(--oc-muted)" }}>
          {new Date(turn.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      {hasThinking ? (
        <div className="mt-2 oc-card oc-card--soft overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-2 py-1.5 text-left text-[12px]"
            style={{ color: "var(--oc-muted)" }}
            onClick={() => setShowThinking((v) => !v)}
          >
            <span className="oc-thinking-label">
              <span>{isAssistant && isStreaming && !showThinking ? "Agent is thinking..." : "Thinking"}</span>
              {isAssistant && isStreaming && !showThinking ? (
                <span className="oc-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : null}
            </span>
            <span className="text-[11px]">{showThinking ? "Collapse" : "Expand"}</span>
          </button>
          <div className="oc-collapse px-2 pb-2 text-[12px] oc-scrollbar" data-open={showThinking ? "true" : "false"} ref={setThinkingEl} />
        </div>
      ) : null}

      <div className={`${hasThinking ? "mt-2" : "mt-1"} ${bubbleClass}`}>
        {sentReferences.length ? (
          <div className="oc-sent-reference-strip">
            {sentReferences.map((reference) => (
              <span key={`${reference.kind}:${reference.path}`} className="oc-sent-reference-chip" title={reference.path}>
                @{reference.label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="px-3 py-2.5 text-[13px] oc-scrollbar" ref={setFinalEl} />
        <div className="oc-message-actions">
          <button
            className="oc-icon-btn"
            type="button"
            onClick={copyTurn}
            title={copied ? "Copied" : "Copy"}
            aria-label="Copy this message"
          >
            <span className="oc-icon-glyph">{copied ? "✓" : "⧉"}</span>
          </button>
          {canRetry ? (
            <button
              className="oc-icon-btn"
              type="button"
              onClick={() => props.onRetry?.(turn)}
              title="Retry"
              aria-label="Retry"
            >
              <span className="oc-icon-glyph">↻</span>
            </button>
          ) : null}
          {canDelete ? (
            <button
              className="oc-icon-btn"
              type="button"
              onClick={() => props.onDelete?.(turn)}
              title="Delete"
              aria-label="Delete"
            >
              <span className="oc-icon-glyph">✕</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
