/**
 * ChatPanel
 *
 * Middle scrollable area of the OpenClaw side panel.
 * Renders:
 * - All conversation turns (visibleTurns — system turns filtered)
 * - PermissionRequest card (shown when an action requires approval)
 * - Stream indicator (live streaming assistant message)
 *
 * All data is passed in as props. No internal state beyond local scroll.
 * Auto-scrolls to bottom whenever turns or stream changes.
 */

import React, { useEffect, useRef } from "react";
import type { App as ObsidianApp } from "obsidian";
import type { ChatTurn } from "../types";
import { ChatMessage } from "./components/ChatMessage";
import { PermissionRequest, type PermissionRequestModel } from "./components/PermissionRequest";
import type OpenClawControllerPlugin from "../main";

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

type StreamState = {
  thinking: string;
  content: string;
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; model?: string };
};

type Props = {
  app: ObsidianApp;
  plugin: OpenClawControllerPlugin;
  visibleTurns: ChatTurn[];
  turns: ChatTurn[];
  stream: StreamState;
  pendingAction: PermissionRequestModel | null;
  onRemoveTurn: (turnId: string) => void;
  onRetryTurn: (turn: ChatTurn) => void;
  onRespondAction: (id: string, approved: boolean) => void;
};

export function ChatPanel({
  app,
  plugin,
  visibleTurns,
  stream,
  pendingAction,
  onRemoveTurn,
  onRetryTurn,
  onRespondAction,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom whenever turns or stream changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visibleTurns.length, stream.content, pendingAction?.id]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto oc-scrollbar px-2 pb-2">
      {visibleTurns.map((t) => (
        <ChatMessage
          key={t.id}
          app={app}
          component={plugin}
          turn={t}
          onDelete={(turn) => onRemoveTurn(turn.id)}
          onRetry={(turn) => void onRetryTurn(turn)}
        />
      ))}

      {pendingAction ? (
        <PermissionRequest
          req={pendingAction}
          onApprove={(id) => onRespondAction(id, true)}
          onDeny={(id) => onRespondAction(id, false)}
        />
      ) : null}

      {(stream.thinking.trim() || stream.content.trim()) && (
        <ChatMessage
          app={app}
          component={plugin}
          turn={{
            id: "stream",
            role: "assistant",
            createdAt: Date.now(),
            content: stream.content,
            thinking: stream.thinking,
            tokenUsage: stream.tokenUsage,
          }}
        />
      )}
    </div>
  );
}
