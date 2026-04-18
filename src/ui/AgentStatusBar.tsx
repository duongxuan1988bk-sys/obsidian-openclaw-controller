/**
 * AgentStatusBar
 *
 * Top status bar of the OpenClaw side panel.
 * Displays:
 * - Connection indicator (dot + label)
 * - Plugin version / agent / model tooltip
 * - UI skin toggle button
 * - Reconnect button
 *
 * All business logic (reconnect, skin cycling) is passed in as callbacks.
 * No internal state — purely presentational.
 */

import React, { useMemo } from "react";
import { Palette, RefreshCw } from "lucide-react";
import type { ConnectionState } from "../types";
import type { OpenClawUiSkin } from "../settings";

type Props = {
  conn: ConnectionState;
  connErr: string | undefined;
  pluginVersion: string;
  nodeStatus: string;
  agent: string;
  model: string;
  uiSkin: OpenClawUiSkin;
  agentModelMap: Record<string, string | undefined>;
  onReconnect: () => void;
  onCycleUiSkin: () => void;
};

export function AgentStatusBar({
  conn,
  connErr,
  pluginVersion,
  nodeStatus,
  agent,
  model,
  uiSkin,
  agentModelMap,
  onReconnect,
  onCycleUiSkin,
}: Props) {
  const connLabel = useMemo(() => {
    if (conn === "connected") return "Connected";
    if (conn === "connecting") return "Connecting…";
    if (conn === "error") return "Error";
    return "Disconnected";
  }, [conn]);

  const effectiveModel = model || agentModelMap[agent] || "default";

  return (
    <div className="oc-topbar">
      <div
        className="oc-statusline"
        title={`OpenClaw Gateway v${pluginVersion}\n${nodeStatus}\nAgent: ${agent}\nModel: ${effectiveModel}`}
      >
        <span className="oc-status-dot" data-state={conn} aria-hidden="true" />
        <span role="img" aria-label="OpenClaw" className="oc-lobster">
          🦞
        </span>
        <span className="oc-status-text">{connLabel}</span>
      </div>
      <div className="oc-topbar-actions">
        <button
          className="oc-ghost-btn"
          onClick={onCycleUiSkin}
          title={`Switch UI skin (${uiSkin === "apple" ? "Apple" : "Claude"})`}
          type="button"
        >
          <Palette size={22} />
        </button>
        <button
          className="oc-ghost-btn"
          onClick={onReconnect}
          title="Reconnect WebSocket"
          type="button"
        >
          <RefreshCw size={22} />
        </button>
      </div>
    </div>
  );
}
