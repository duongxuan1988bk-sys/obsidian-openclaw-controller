import React from "react";
import type { TokenUsage } from "../../types";

function fmt(n?: number) {
  if (n == null) return "—";
  return Intl.NumberFormat(undefined).format(n);
}

export function TokenUsagePill(props: { usage?: TokenUsage; variant?: "pill" | "compact"; hideModel?: boolean }) {
  const u = props.usage;
  const variant = props.variant ?? "pill";
  const hideModel = props.hideModel ?? false;
  const model = u?.model ?? "gpt-mini-5.4";
  const total = u?.totalTokens ?? (u?.inputTokens != null && u?.outputTokens != null ? u.inputTokens + u.outputTokens : undefined);

  if (variant === "compact") {
    return (
      <div
        className="text-[11px] leading-4"
        style={{ color: "var(--oc-muted)" }}
        title="Token usage (gpt-mini 5.4 format)"
      >
        {!hideModel ? (
          <>
            <span className="font-medium" style={{ color: "var(--text-normal)" }}>
              {model}
            </span>
            <span className="mx-1">·</span>
          </>
        ) : null}
        <span>total {fmt(total)}</span>
      </div>
    );
  }

  return (
    <div
      className="text-[11px] leading-4 px-2 py-1 rounded-md border"
      style={{ borderColor: "var(--oc-border)", background: "var(--oc-surface-2)", color: "var(--oc-muted)" }}
      title="Token usage (gpt-mini 5.4 format)"
    >
      {!hideModel ? (
        <>
          <span className="font-medium" style={{ color: "var(--text-normal)" }}>
            {model}
          </span>
          <span className="mx-1">·</span>
        </>
      ) : null}
      <span>total {fmt(total)}</span>
    </div>
  );
}
