import type { ConnectionState, GatewayInbound, GatewayOutbound, GatewayRes, NodeInvokeFrame, NodeInvokeResult, OpenClawReference } from "../types";
import type { StoredDeviceAuth, StoredDeviceIdentity } from "../settings";
import { createSignedDeviceEnvelope, ensureDeviceIdentity } from "./deviceAuth";
import { parseSetupCode } from "./setupCode";

export type OpenClawClientOptions = {
  url: string;
  onState: (state: ConnectionState, error?: string) => void;
  onGatewayMessage: (msg: GatewayInbound) => void;
  onSystemLog?: (text: string) => void;
  onDeviceIdentity?: (identity: StoredDeviceIdentity) => void | Promise<void>;
  onDeviceAuth?: (auth: StoredDeviceAuth | null) => void | Promise<void>;
  onNodeInvoke?: (frame: NodeInvokeFrame) => Promise<NodeInvokeResult>;
  clientVersion?: string;
  clientId?: string;
  clientMode?: string;
  deviceIdentity?: StoredDeviceIdentity | null;
  deviceAuth?: StoredDeviceAuth | null;
};

export type GenerateMarkdownPayload = {
  action: "generate_markdown";
  prompt: string;
  title: string;
  path: string;
  content: string;
};

export type OpenClawSkillPayload = {
  action: "convert_to_raw";
  backendMode: "openclaw_skill";
  backendSkill: string;
  input: {
    url: string;
    [key: string]: unknown;
  };
};

export type ConvertToInsightPayload = GenerateMarkdownPayload;

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private opts: OpenClawClientOptions;
  private reconnectTimer: number | null = null;
  private manualClose = false;
  private connectedProtocol = false;
  private pending: Map<string, (res: GatewayRes) => void> = new Map();

  private token: string | null = null;
  private deviceIdentity: StoredDeviceIdentity | null = null;
  private deviceAuth: StoredDeviceAuth | null = null;
  private sessionKey: string | null = null;
  private sawChallenge = false;
  private challengeTimer: number | null = null;
  private backoffMs = 1200;
  private seq = 1;
  private pendingRejects: Map<string, (err: Error) => void> = new Map();
  private retryingWithBootstrap = false;

  constructor(opts: OpenClawClientOptions) {
    this.opts = opts;
    this.deviceIdentity = opts.deviceIdentity ?? null;
    this.deviceAuth = opts.deviceAuth ?? null;
  }

  configure(params: {
    token: string;
    sessionKey: string;
    deviceIdentity?: StoredDeviceIdentity | null;
    deviceAuth?: StoredDeviceAuth | null;
  }) {
    this.token = params.token;
    this.sessionKey = params.sessionKey;
    if (params.deviceIdentity !== undefined) this.deviceIdentity = params.deviceIdentity;
    if (params.deviceAuth !== undefined) this.deviceAuth = params.deviceAuth;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manualClose = false;
    this.connectedProtocol = false;
    this.sawChallenge = false;
    this.seq = 1;
    this.opts.onState("connecting");
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.opts.onSystemLog?.("WS open. Waiting for connect.challenge…");
      if (this.challengeTimer != null) window.clearTimeout(this.challengeTimer);
      this.challengeTimer = window.setTimeout(() => {
        if (this.connectedProtocol) return;
        if (!this.sawChallenge) {
          this.opts.onState("error", "No connect.challenge received (check allowedOrigins / URL)");
        }
      }, 4000);
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as GatewayInbound;
        this.opts.onGatewayMessage(parsed);
        this.onInbound(parsed);
      } catch (e) {
        this.opts.onState("error", `Invalid gateway message: ${String(e)}`);
      }
    };

    ws.onerror = () => {
      this.opts.onState("error", "WebSocket error");
    };

    ws.onclose = (ev) => {
      this.ws = null;
      for (const reject of this.pendingRejects.values()) {
        reject(new Error(`WebSocket closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`));
      }
      this.pending.clear();
      this.pendingRejects.clear();
      this.connectedProtocol = false;
      this.sawChallenge = false;
      if (this.challengeTimer != null) {
        window.clearTimeout(this.challengeTimer);
        this.challengeTimer = null;
      }
      if (this.manualClose) {
        this.opts.onState("disconnected");
        return;
      }
      if (ev.reason?.includes("device token mismatch") && this.deviceAuth && this.token?.trim()) {
        this.opts.onSystemLog?.("Stored device token no longer matches this client identity. Clearing it and retrying with bootstrap token…");
        this.deviceAuth = null;
        void this.opts.onDeviceAuth?.(null);
        if (!this.retryingWithBootstrap) {
          this.retryingWithBootstrap = true;
          this.opts.onState("connecting");
          window.setTimeout(() => {
            this.retryingWithBootstrap = false;
            this.connect();
          }, 250);
          return;
        }
      }
      this.opts.onState("disconnected", `WS closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`);
      this.scheduleReconnect();
    };
  }

  close() {
    this.manualClose = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  sendRaw(msg: GatewayOutbound) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  async connectHandshake(nonce: string) {
    const clientId = this.opts.clientId ?? "node-host";
    const clientMode = this.opts.clientMode ?? "node";
    const platform = this.detectPlatform();
    const role = "node";
    const scopes: string[] = [];
    const commands = [
      "obsidian.ping",
      "obsidian.read_active_note",
      "obsidian.append_active_note",
      "obsidian.modify_file",
      "obsidian.write_file",
      "obsidian.list_files"
    ];
    const caps = ["obsidian", "vault"];
    const identity = await ensureDeviceIdentity(this.deviceIdentity);
    if (this.deviceIdentity?.deviceId !== identity.deviceId) {
      this.deviceIdentity = identity;
      await this.opts.onDeviceIdentity?.(identity);
      this.opts.onSystemLog?.(`Local device ready: ${identity.deviceId.slice(0, 12)}…`);
    }

    const setupCode = parseSetupCode(this.token);
    if (setupCode?.url && setupCode.url !== this.opts.url) {
      this.opts.onSystemLog?.(`Setup code points to ${setupCode.url}. Current plugin URL is ${this.opts.url}.`);
    }

    const compatibleDeviceToken = this.resolveCompatibleDeviceToken(clientId, clientMode, role)
      ? this.deviceAuth?.deviceToken
      : null;
    const auth =
      compatibleDeviceToken
        ? { deviceToken: compatibleDeviceToken }
        : setupCode?.bootstrapToken
          ? { bootstrapToken: setupCode.bootstrapToken }
          : this.token?.trim()
            ? { bootstrapToken: this.token.trim() }
          : null;
    if (!auth) throw new Error("Missing gateway bootstrap token");

    const signatureToken = "deviceToken" in auth ? auth.deviceToken : auth.bootstrapToken;
    const device = await createSignedDeviceEnvelope({
      identity,
      clientId,
      clientMode,
      role,
      scopes,
      nonce,
      token: signatureToken,
      platform
    });

    // The gateway sample uses string ids "1", "2", ... and may validate this strictly.
    const id = "1";
    this.seq = 2;
    this.opts.onSystemLog?.(
      `Connect auth mode: ${
        "deviceToken" in auth ? "deviceToken" : "bootstrapToken"
      } · client=${clientId}/${clientMode} · role=${role} · device=${device.id.slice(0, 12)}…`
    );
    this.opts.onSystemLog?.(
      `Connect payload preview: ${JSON.stringify({
        client: {
          id: clientId,
          displayName: "Obsidian",
          version: this.opts.clientVersion ?? "1.0.0",
          platform,
          mode: clientMode
        },
        role,
        scopes,
        auth: "deviceToken" in auth ? { deviceToken: "***" } : { bootstrapToken: "***" },
        device: {
          id: device.id,
          publicKey: `${device.publicKey.slice(0, 12)}…`,
          signedAt: device.signedAt,
          nonce: device.nonce
        }
      })}`
    );
    const res = await this.req("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        displayName: "Obsidian",
        version: this.opts.clientVersion ?? "1.0.0",
        platform,
        mode: clientMode
      },
      caps,
      commands,
      role,
      scopes,
      auth,
      device,
      locale: "zh-CN"
    }, id);
    if (!res.ok) {
      if (res.error?.message?.includes("device_token_mismatch") && this.deviceAuth && this.token?.trim()) {
        this.deviceAuth = null;
        await this.opts.onDeviceAuth?.(null);
        this.opts.onSystemLog?.("Stored node device token was rejected. Falling back to bootstrap token on next reconnect.");
        throw new Error("device token was rejected");
      }
      throw new Error(res.error?.message ?? "connect failed");
    }
    const payload = (res.payload ?? {}) as any;
    const nextDeviceToken = payload?.auth?.deviceToken;
    if (typeof nextDeviceToken === "string" && nextDeviceToken.trim()) {
      const nextAuth: StoredDeviceAuth = {
        deviceToken: nextDeviceToken.trim(),
        role: typeof payload?.auth?.role === "string" ? payload.auth.role : undefined,
        scopes: Array.isArray(payload?.auth?.scopes) ? payload.auth.scopes.filter((v: unknown): v is string => typeof v === "string") : undefined,
        issuedAtMs: typeof payload?.auth?.issuedAtMs === "number" ? payload.auth.issuedAtMs : undefined,
        clientId,
        clientMode
      };
      const changed =
        nextAuth.deviceToken !== this.deviceAuth?.deviceToken ||
        nextAuth.role !== this.deviceAuth?.role ||
        JSON.stringify(nextAuth.scopes ?? []) !== JSON.stringify(this.deviceAuth?.scopes ?? []) ||
        nextAuth.issuedAtMs !== this.deviceAuth?.issuedAtMs;
      if (changed) {
        this.deviceAuth = nextAuth;
        await this.opts.onDeviceAuth?.(nextAuth);
        this.opts.onSystemLog?.("Node pairing accepted. Saved device token for future reconnects.");
      }
    }
    if (payload?.type !== "hello-ok") {
      // Still accept ok response; just log.
      this.opts.onSystemLog?.(`Connected, unexpected hello payload: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    this.connectedProtocol = true;
    this.backoffMs = 1200;
    this.opts.onState("connected");
  }

  async chatSend(text: string, references?: OpenClawReference[], options?: { agentId?: string; model?: string }) {
    if (!this.sessionKey) throw new Error("Missing sessionKey");
    if (!this.connectedProtocol) throw new Error("Not connected (handshake incomplete)");
    const referenceSuffix =
      references && references.length > 0
        ? `\n\nReferences:\n${references.map((reference) => `- [${reference.kind}] ${reference.label}: ${reference.path}`).join("\n")}`
        : "";
    return await this.req("node.event", {
      event: "agent.request",
      payload: {
        sessionKey: this.sessionKey,
        agentId: options?.agentId ?? this.resolveAgentIdFromSessionKey(this.sessionKey),
        ...(options?.model ? { model: options.model } : {}),
        message: `${text}${referenceSuffix}`.trim()
      }
    });
  }

  async generateMarkdown(payload: GenerateMarkdownPayload) {
    if (!this.sessionKey) throw new Error("Missing sessionKey");
    if (!this.connectedProtocol) throw new Error("Not connected (handshake incomplete)");

    // Registry-driven MVP: Obsidian builds workflow prompts from vault YAML,
    // while OpenClaw only executes the model and returns markdown.
    return await this.req("node.event", {
      event: "agent.request",
      payload: {
        sessionKey: this.sessionKey,
        action: payload.action,
        prompt: payload.prompt,
        title: payload.title,
        path: payload.path,
        content: payload.content,
        message: payload.prompt
      }
    });
  }

  async convertToInsight(payload: ConvertToInsightPayload) {
    return await this.generateMarkdown(payload);
  }

  async invokeOpenClawSkill(payload: OpenClawSkillPayload) {
    if (!this.sessionKey) throw new Error("Missing sessionKey");
    if (!this.connectedProtocol) throw new Error("Not connected (handshake incomplete)");

    // Skill-backed workflows are still routed through the node agent event, but
    // unlike registry LLM workflows the plugin does not build a generation prompt.
    return await this.req("node.event", {
      event: "agent.request",
      payload: {
        sessionKey: this.sessionKey,
        action: payload.action,
        backend_mode: payload.backendMode,
        backend_skill: payload.backendSkill,
        skill: payload.backendSkill,
        input: payload.input,
        url: payload.input.url,
        message: [
          `请使用 ${payload.backendSkill} skill 处理下面这个 WeChat URL。`,
          "任务：把它转换成一篇完整的 raw Obsidian markdown note。",
          "要求：只返回最终 markdown，不要解释，不要聊天，不要在 OpenClaw 侧写文件；Obsidian 插件会负责保存文件。",
          `URL: ${payload.input.url}`
        ].join("\n")
      }
    });
  }

  async subscribeSessionMessages() {
    if (!this.sessionKey) throw new Error("Missing sessionKey");
    if (!this.connectedProtocol) throw new Error("Not connected (handshake incomplete)");
    return await this.req("node.event", {
      event: "chat.subscribe",
      payload: { sessionKey: this.sessionKey }
    });
  }

  private onInbound(msg: GatewayInbound) {
    if (msg.type === "res") {
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        this.pendingRejects.delete(msg.id);
        cb(msg);
      }
      return;
    }

    if (msg.type === "event" && msg.event === "connect.challenge") {
      this.sawChallenge = true;
      this.opts.onSystemLog?.("Received connect.challenge, sending connect handshake…");
      // Per protocol: first client frame must be connect req (after challenge).
      // We don't need the nonce for the provided connect params, but we treat challenge as "go".
      if (!this.connectedProtocol) {
        if (!this.token) {
          if (!this.deviceAuth?.deviceToken) {
            this.opts.onState("error", "Missing gateway token (set token in plugin settings)");
            return;
          }
        }
        this.connectHandshake(msg.payload?.nonce ?? "").catch((e) => {
          if (String(e).includes("device token was rejected")) {
            this.connect();
            return;
          }
          this.opts.onState("error", String(e));
        });
      }
      return;
    }

    if (msg.type === "event" && msg.event === "node.invoke.request") {
      const frame = this.parseNodeInvokeFrame(msg.payload);
      if (!frame) {
        this.opts.onSystemLog?.("Ignored malformed node.invoke.request payload.");
        return;
      }
      this.opts.onSystemLog?.(`Node invoke requested: ${frame.command}`);
      void this.handleNodeInvoke(frame);
      return;
    }
  }

  private req(method: string, params?: unknown, forcedId?: string): Promise<GatewayRes> {
    const id = forcedId ?? String(this.seq++);
    const msg: GatewayOutbound = { type: "req", id, method, params };
    return new Promise<GatewayRes>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }
      this.pending.set(id, resolve);
      this.pendingRejects.set(id, reject);
      this.ws.send(JSON.stringify(msg));
      window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        this.pendingRejects.delete(id);
        reject(new Error(`${method} timeout`));
      }, 8000);
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer != null) return;
    // Without any auth material we cannot complete the handshake; don't hammer the gateway.
    if (!this.token && !this.deviceAuth?.deviceToken) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.backoffMs = Math.min(Math.round(this.backoffMs * 1.6), 15000);
    }, this.backoffMs);
  }

  private resolveCompatibleDeviceToken(clientId: string, clientMode: string, role: string): boolean {
    const token = this.deviceAuth?.deviceToken?.trim();
    if (!token) return false;
    if (this.deviceAuth?.clientId && this.deviceAuth.clientId !== clientId) return false;
    if (this.deviceAuth?.clientMode && this.deviceAuth.clientMode !== clientMode) return false;
    if (this.deviceAuth?.role && this.deviceAuth.role !== role) return false;
    if (role === "node" && this.deviceAuth?.role === "operator") return false;
    return true;
  }

  private async handleNodeInvoke(frame: NodeInvokeFrame) {
    const result: NodeInvokeResult = this.opts.onNodeInvoke
      ? await this.opts.onNodeInvoke(frame).catch((error) => ({
          ok: false,
          error: {
            code: "HANDLER_FAILED",
            message: error instanceof Error ? error.message : String(error)
          }
        }))
      : {
          ok: false,
          error: {
            code: "NO_HANDLER",
            message: `No node command handler registered for ${frame.command}`
          }
        };

    try {
      await this.req("node.invoke.result", {
        id: frame.id,
        nodeId: frame.nodeId,
        ok: result.ok,
        ...(result.payload !== undefined ? { payload: result.payload } : {}),
        ...(result.error ? { error: result.error } : {})
      });
      this.opts.onSystemLog?.(
        result.ok ? `Node invoke completed: ${frame.command}` : `Node invoke failed: ${frame.command} (${result.error?.message ?? "unknown"})`
      );
    } catch (error) {
      this.opts.onSystemLog?.(`Failed to send node.invoke.result for ${frame.command}: ${String(error)}`);
    }
  }

  private parseNodeInvokeFrame(payload: unknown): NodeInvokeFrame | null {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    const nodeId = typeof obj.nodeId === "string" ? obj.nodeId.trim() : "";
    const command = typeof obj.command === "string" ? obj.command.trim() : "";
    if (!id || !nodeId || !command) return null;

    let params: unknown = obj.params;
    if (params === undefined && typeof obj.paramsJSON === "string" && obj.paramsJSON.trim()) {
      try {
        params = JSON.parse(obj.paramsJSON);
      } catch {
        params = { raw: obj.paramsJSON };
      }
    }

    return {
      id,
      nodeId,
      command,
      params,
      timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : null,
      idempotencyKey: typeof obj.idempotencyKey === "string" ? obj.idempotencyKey : null
    };
  }

  private detectPlatform(): string {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
    if (ua.includes("mac")) return "darwin";
    if (ua.includes("windows")) return "win32";
    if (ua.includes("linux")) return "linux";
    return "unknown";
  }

  private resolveAgentIdFromSessionKey(sessionKey: string): string | null {
    const match = sessionKey.match(/^agent:([^:]+):/i);
    return match?.[1] ?? null;
  }
}
