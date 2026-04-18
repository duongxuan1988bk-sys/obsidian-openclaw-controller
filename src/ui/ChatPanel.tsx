/**
 * ChatPanel
 *
 * Middle scrollable area of the OpenClaw side panel.
 * Renders:
 * - All conversation turns (visibleTurns — system turns filtered)
 * - TopicPicker card (shown when theory/case topic selection is in progress)
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
import { TopicPicker, THEORY_TOPIC_OPTIONS, CASE_TOPIC_OPTIONS, METHOD_TOPIC_OPTIONS, type TopicOption } from "./components/TopicPicker";
import { DomainPicker, INSIGHT_DOMAIN_OPTIONS, type InsightDomainOption } from "./components/DomainPicker";
import type OpenClawControllerPlugin from "../main";
import type { TheoryTopic, CaseTopic, MethodTopic } from "../registry/insightRegistry";

// RegistryTopic is the union used for topic picker selection
type RegistryTopic = TheoryTopic | CaseTopic | MethodTopic;

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

type StreamState = {
  thinking: string;
  content: string;
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; model?: string };
};

type TopicPickerState = null | { kind: "theory" | "case" | "method" | "insight" | "doc" | "debug" | "system" | "case_by_domain" };

type Props = {
  app: ObsidianApp;
  plugin: OpenClawControllerPlugin;
  visibleTurns: ChatTurn[];
  turns: ChatTurn[];
  stream: StreamState;
  pendingAction: PermissionRequestModel | null;
  topicPicker: TopicPickerState;
  onRemoveTurn: (turnId: string) => void;
  onRetryTurn: (turn: ChatTurn) => void;
  onCompleteTopicSelection: (topic: RegistryTopic | null) => void;
  onCompleteInsightDomainSelection: (domain: "biotech" | "openclaw" | "ai" | "general" | null) => void;
  onRespondAction: (id: string, approved: boolean) => void;
};

export function ChatPanel({
  app,
  plugin,
  visibleTurns,
  stream,
  pendingAction,
  topicPicker,
  onRemoveTurn,
  onRetryTurn,
  onCompleteTopicSelection,
  onCompleteInsightDomainSelection,
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

      {topicPicker ? (
        topicPicker.kind === "theory" ? (
          <TopicPicker
            title="Convert to Theory"
            options={THEORY_TOPIC_OPTIONS}
            onPick={(topic) => onCompleteTopicSelection(topic)}
            onCancel={() => onCompleteTopicSelection(null)}
          />
        ) : topicPicker.kind === "case" ? (
          <TopicPicker
            title="Convert to Case"
            options={CASE_TOPIC_OPTIONS}
            onPick={(topic) => onCompleteTopicSelection(topic)}
            onCancel={() => onCompleteTopicSelection(null)}
          />
        ) : topicPicker.kind === "method" ? (
          <TopicPicker
            title="Convert to Method"
            options={METHOD_TOPIC_OPTIONS}
            onPick={(topic) => onCompleteTopicSelection(topic)}
            onCancel={() => onCompleteTopicSelection(null)}
          />
        ) : (
          <DomainPicker
            title={
              topicPicker.kind === "insight" ? "Convert to Insight" :
              topicPicker.kind === "doc" ? "Convert to Doc" :
              topicPicker.kind === "debug" ? "Convert to Debug" :
              topicPicker.kind === "system" ? "Convert to System" :
              topicPicker.kind === "case_by_domain" ? "Convert to Case" :
              "Select Domain"
            }
            options={INSIGHT_DOMAIN_OPTIONS}
            onPick={(domain) => onCompleteInsightDomainSelection(domain)}
            onCancel={() => onCompleteInsightDomainSelection(null)}
          />
        )
      ) : null}

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
