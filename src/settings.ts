export type StoredDeviceIdentity = {
  version: 1;
  deviceId: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  createdAtMs: number;
};

export type StoredDeviceAuth = {
  deviceToken: string;
  role?: string;
  scopes?: string[];
  issuedAtMs?: number;
  clientId?: string;
  clientMode?: string;
};

export type OpenClawUiSkin = "claude" | "apple";

export type OpenClawSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  selectedAgentId: string;
  selectedModel: string;
  uiSkin: OpenClawUiSkin;
  clientId: string;
  clientMode: string;
  deviceIdentity: StoredDeviceIdentity | null;
  deviceAuth: StoredDeviceAuth | null;
  paraInsightBase: string;
  paraTheoryBase: string;
  paraCaseBase: string;
  paraMethodBase: string;
  wechatScriptPath: string;
  pdfScriptPath: string;
  pythonPath: string;
  pdfPythonPath: string;
  wechatScriptTimeoutMs: number;
  pdfScriptTimeoutMs: number;
};

export const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789/";
export const DEFAULT_WECHAT_SCRIPT_PATH = "";
export const DEFAULT_PDF_SCRIPT_PATH = "";
export const DEFAULT_PYTHON_PATH = "python3";
export const DEFAULT_PDF_PYTHON_PATH = "python3";

export const DEFAULT_SETTINGS: OpenClawSettings = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  token: "",
  sessionKey: "agent:Obsidian:main",
  selectedAgentId: "Obsidian",
  selectedModel: "",
  uiSkin: "claude",
  clientId: "node-host",
  clientMode: "node",
  deviceIdentity: null,
  deviceAuth: null,
  // Defaults follow 03Workflow + 04Planner Design phrasing.
  paraInsightBase: "PARA/Resources",
  paraTheoryBase: "PARA/Resources",
  paraCaseBase: "PARA/Projects",
  paraMethodBase: "PARA/Methods",
  wechatScriptPath: DEFAULT_WECHAT_SCRIPT_PATH,
  pdfScriptPath: DEFAULT_PDF_SCRIPT_PATH,
  pythonPath: DEFAULT_PYTHON_PATH,
  pdfPythonPath: DEFAULT_PDF_PYTHON_PATH,
  wechatScriptTimeoutMs: 60000,
  pdfScriptTimeoutMs: 120000
};
