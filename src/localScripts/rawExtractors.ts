import type { App } from "obsidian";
import type { OpenClawSettings } from "../settings";

declare const require: (module: "child_process") => {
  spawn: (
    command: string,
    args: string[],
    options: { timeout: number; stdio: ["ignore", "pipe", "pipe"] }
  ) => {
    stdout: { on: (event: "data", handler: (chunk: unknown) => void) => void };
    stderr: { on: (event: "data", handler: (chunk: unknown) => void) => void };
    on(event: "close", handler: (code: number | null) => void): void;
    on(event: "error", handler: (err: Error) => void): void;
  };
};

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.searchParams.get("__biz") || u.hostname || "WeChat Article";
  } catch {
    return "WeChat Article";
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}

function buildFailedRawNote(params: {
  title: string;
  source: string;
  sourceType: "wechat" | "pdf";
  errorMessage: string;
  failureKind: "extract" | "spawn";
}): string {
  const tags = params.sourceType === "wechat" ? "[raw, wechat]" : "[raw, pdf]";
  const body =
    params.sourceType === "wechat"
      ? `## ⚙️ 提取记录\n\n- ${params.failureKind === "spawn" ? "脚本调用失败" : "提取失败"}: ${params.errorMessage}\n\n## 📌 原文\n\n${params.source}`
      : `## Original Content\n\n[PDF extraction failed: ${params.errorMessage}]`;

  return `---
title: ${params.title}
date: ${todayIsoDate()}
source: ${params.source}
tags: ${tags}
type: raw
status: failed-extract
---

# ${params.title}

${body}
`;
}

function resolveVaultFileSystemPath(app: App, vaultPath: string): string {
  if (vaultPath.startsWith("/")) return vaultPath;
  const adapter = app.vault.adapter as { getBasePath?: () => string };
  const basePath = adapter.getBasePath?.();
  return basePath ? `${basePath}/${vaultPath}` : vaultPath;
}

export function runWechatScript(settings: OpenClawSettings, url: string): Promise<string> {
  return new Promise((resolve) => {
    const scriptPath = settings.wechatScriptPath;
    if (!scriptPath.trim()) {
      resolve(buildFailedRawNote({
        title: titleFromUrl(url),
        source: url,
        sourceType: "wechat",
        errorMessage: "WeChat script path is not configured in OpenClaw settings.",
        failureKind: "spawn"
      }));
      return;
    }

    const args = [scriptPath, url, "--stdout"];
    const proc = require("child_process").spawn(settings.pythonPath, args, {
      timeout: settings.wechatScriptTimeoutMs,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: unknown) => { stdout += String(chunk); });
    proc.stderr.on("data", (chunk: unknown) => { stderr += String(chunk); });

    proc.on("close", (code: number | null) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }

      const errMsg = stderr.trim() || `${settings.pythonPath} exited with code ${code}`;
      console.warn(`[runWechatScript] script failed: ${errMsg}`);
      resolve(buildFailedRawNote({
        title: titleFromUrl(url),
        source: url,
        sourceType: "wechat",
        errorMessage: errMsg,
        failureKind: "extract"
      }));
    });

    proc.on("error", (err: Error) => {
      console.error(`[runWechatScript] spawn error: ${err.message}`);
      resolve(buildFailedRawNote({
        title: titleFromUrl(url),
        source: url,
        sourceType: "wechat",
        errorMessage: err.message,
        failureKind: "spawn"
      }));
    });
  });
}

export function runPdfScript(app: App, settings: OpenClawSettings, pdfPath: string): Promise<string> {
  return new Promise((resolve) => {
    if (!settings.pdfScriptPath.trim()) {
      const basename = pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") ?? "PDF Note";
      resolve(buildFailedRawNote({
        title: basename,
        source: pdfPath,
        sourceType: "pdf",
        errorMessage: "PDF script path is not configured in OpenClaw settings.",
        failureKind: "spawn"
      }));
      return;
    }

    const inputPath = resolveVaultFileSystemPath(app, pdfPath);
    const args = [settings.pdfScriptPath, inputPath, "--stdout"];
    const proc = require("child_process").spawn(settings.pdfPythonPath, args, {
      timeout: settings.pdfScriptTimeoutMs,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: unknown) => { stdout += String(chunk); });
    proc.stderr.on("data", (chunk: unknown) => { stderr += String(chunk); });

    proc.on("close", (code: number | null) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }

      const errMsg = stderr.trim() || `${settings.pdfPythonPath} exited with code ${code}`;
      console.warn(`[runPdfScript] script failed: ${errMsg}`);
      const basename = pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") ?? "PDF Note";
      resolve(buildFailedRawNote({
        title: basename,
        source: pdfPath,
        sourceType: "pdf",
        errorMessage: errMsg,
        failureKind: "extract"
      }));
    });

    proc.on("error", (err: Error) => {
      console.error(`[runPdfScript] spawn error: ${err.message}`);
      const basename = pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") ?? "PDF Note";
      resolve(buildFailedRawNote({
        title: basename,
        source: pdfPath,
        sourceType: "pdf",
        errorMessage: err.message,
        failureKind: "spawn"
      }));
    });
  });
}
