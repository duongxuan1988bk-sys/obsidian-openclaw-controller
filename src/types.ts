export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type Role = "system" | "user" | "assistant";

export type ChatTurn = {
  id: string;
  role: Role;
  createdAt: number;
  content: string;
  thinking?: string;
  tokenUsage?: TokenUsage;
  references?: OpenClawReference[];
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
};

export type OpenClawReference = {
  kind: "prompt" | "template" | "file";
  path: string;
  label: string;
};

// ---- OpenClaw Gateway protocol (v3) ----
export type GatewayChallengeEvent = {
  type: "event";
  event: "connect.challenge";
  payload: { nonce: string; ts: number };
};

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  policy?: { tickIntervalMs?: number };
};

export type GatewayReq = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayRes = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message?: string; code?: string; data?: unknown };
};

export type GatewayChatEvent = {
  type: "event";
  event: "chat";
  payload: {
    sessionKey: string;
    kind: "assistant" | "user" | "system" | string;
    content: Array<{ type: "text"; text: string } | { type: string; [k: string]: unknown }>;
  };
};

export type NodeInvokeFrame = {
  id: string;
  nodeId: string;
  command: string;
  params: unknown;
  timeoutMs?: number | null;
  idempotencyKey?: string | null;
};

export type NodeInvokeResult = {
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
};

export type GatewayInbound = GatewayChallengeEvent | GatewayChatEvent | GatewayRes | { type: "event"; event: string; payload?: any };

export type GatewayOutbound = GatewayReq;
