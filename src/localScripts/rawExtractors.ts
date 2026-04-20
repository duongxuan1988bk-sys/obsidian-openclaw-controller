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
    on(event: "close", handler: (code: number | null, signal: string | null) => void): void;
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

/**
 * Section title patterns for biomedical/antibody papers.
 * Keys are canonical names; values are regex patterns (case-insensitive).
 */
const SECTION_PATTERNS: { canonical: string; patterns: RegExp[] }[] = [
  { canonical: "Abstract", patterns: [/^abstract$/i, /^摘要$/] },
  { canonical: "Introduction", patterns: [/^introduction$/i, /^引言$/, /^背景$/] },
  { canonical: "Materials and Methods", patterns: [/^materials?\s*(and)?\s*methods?$/i, /^实验材料与方法$/, /^材料与方法$/, /^methods?$/i] },
  { canonical: "Results", patterns: [/^results?$/i, /^结果$/] },
  { canonical: "Discussion", patterns: [/^discussion$/i, /^讨论$/] },
  { canonical: "Conclusion", patterns: [/^conclusion$/i, /^结论$/, /^conclusions?$/i] },
  { canonical: "Acknowledgments", patterns: [/^acknowledgements?$/i, /^致谢$/, /^acknowledgment$/i] },
  { canonical: "References", patterns: [/^references?$/i, /^参考文献$/, /^reference$/i] },
  { canonical: "Supplementary", patterns: [/^supplementary(\s+(materials?|information))?$/i, /^补充材料$/, /^补充信息$/, /^supporting\s+information$/i] },
];

const SECTION_ORDER: Record<string, number> = {
  "Abstract": 1,
  "Introduction": 2,
  "Materials and Methods": 3,
  "Results": 4,
  "Discussion": 5,
  "Conclusion": 6,
  "Acknowledgments": 7,
  "References": 8,
  "Supplementary": 9,
};

/** Schema section titles that should NOT be treated as PDF sections */
const SCHEMA_SECTION_TITLES = new Set([
  "source",      // ## Source — raw note wrapper
  "original content", // ## Original Content — raw note wrapper
  "原文",        // Chinese variant of Original Content
]);

function isSchemaSection(canonicalTitle: string): boolean {
  return SCHEMA_SECTION_TITLES.has(canonicalTitle.toLowerCase());
}

function slugifyTitle(title: string): string {
  return title
    .replace(/[\\/:?<>|"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSectionTitle(title: string): string {
  const trimmed = title.trim();
  for (const { canonical, patterns } of SECTION_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return canonical;
      }
    }
  }
  return slugifyTitle(trimmed);
}

function getSectionOrder(title: string): number {
  return SECTION_ORDER[title] ?? 100;
}

export interface SplitSection {
  title: string;
  canonicalTitle: string;
  content: string;
  seq: string;
}

export interface SplitResult {
  folderName: string;
  sections: SplitSection[];
}

/**
 * Split a markdown document by ## headings into individual sections.
 * Each section becomes a separate note with its own frontmatter.
 *
 * Strategy: First locate ## Original Content (the PDF body wrapper added by
 * pdf_to_obsidian.py). Extract the body AFTER that heading, then split that
 * body by ## section headings. This preserves any lead paragraphs / metadata
 * that appear between ## Original Content and the first real section heading.
 */
export function splitMarkdownBySections(markdown: string, pdfFilename: string): SplitResult {
  const folderName = slugifyTitle(pdfFilename.replace(/\.pdf$/i, ""));

  // Find ## Original Content heading — everything after it is the PDF body
  const ocMatch = markdown.match(/^##\s+(original content|原文)\s*$/gim);
  let bodyStart = 0;
  let bodyMarkdown = markdown;

  if (ocMatch) {
    // Position right after the ## Original Content line
    bodyStart = markdown.indexOf(ocMatch[0]) + ocMatch[0].length;
    bodyMarkdown = markdown.slice(bodyStart).trim();
  }

  // Now find ## headings ONLY within the body (the actual PDF sections)
  const headingRegex = /^##\s+(.+)$/gm;
  const headings: Array<{ title: string; start: number; end: number }> = [];

  let match;
  while ((match = headingRegex.exec(bodyMarkdown)) !== null) {
    headings.push({
      title: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // If no ## headings found in body, treat the whole body as one section
  if (headings.length === 0) {
    return {
      folderName,
      sections: [{
        title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? folderName,
        canonicalTitle: folderName,
        content: bodyMarkdown,
        seq: "01",
      }],
    };
  }

  // Extract sections from the body
  const sections: SplitSection[] = [];
  const sortedHeadings = [...headings].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sortedHeadings.length; i++) {
    const heading = sortedHeadings[i];
    const nextStart = i + 1 < sortedHeadings.length ? sortedHeadings[i + 1].start : bodyMarkdown.length;
    // Content is from end of heading to start of next heading (or end of document)
    let content = bodyMarkdown.slice(heading.end, nextStart).trim();
    // Remove leading newlines from content
    content = content.replace(/^\n+/, "");

    const canonicalTitle = normalizeSectionTitle(heading.title);

    // Skip schema sections (shouldn't appear in body, but be safe)
    if (isSchemaSection(canonicalTitle)) continue;

    sections.push({
      title: heading.title,
      canonicalTitle,
      content,
      seq: String(sections.length + 1).padStart(2, "0"),
    });
  }

  // If there is preamble content (before the first heading), prepend it to the first section.
  // This captures title/author/DOI/abstract lead paragraphs that appear before ## Abstract.
  if (sections.length > 0 && sortedHeadings.length > 0) {
    const firstHeading = sortedHeadings[0];
    const preambleContent = bodyMarkdown.slice(0, firstHeading.start).trim();
    if (preambleContent) {
      sections[0].content = `${preambleContent}\n\n${sections[0].content}`;
    }
  }

  // If no valid sections found, treat the whole body as one section
  if (sections.length === 0) {
    return {
      folderName,
      sections: [{
        title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? folderName,
        canonicalTitle: folderName,
        content: bodyMarkdown,
        seq: "01",
      }],
    };
  }

  // Sort by canonical section order, then by original position for unknown sections
  sections.sort((a, b) => {
    const orderA = getSectionOrder(a.canonicalTitle);
    const orderB = getSectionOrder(b.canonicalTitle);
    if (orderA !== orderB) return orderA - orderB;
    // Fall back to original order for sections with same order (like multiple unknown sections)
    const posA = headings.findIndex(h => h.title === a.title);
    const posB = headings.findIndex(h => h.title === b.title);
    return posA - posB;
  });

  // Re-number sequentially after sorting (01, 02, 03...)
  sections.forEach((section, idx) => {
    section.seq = String(idx + 1).padStart(2, "0");
  });

  return { folderName, sections };
}

function buildFailedRawNote(params: {
  title: string;
  source: string;
  sourceType: "wechat" | "pdf" | "markitdown";
  errorMessage: string;
  failureKind: "extract" | "spawn";
}): string {
  const tags =
    params.sourceType === "wechat"
      ? "[raw, wechat]"
      : params.sourceType === "pdf"
        ? "[raw, pdf]"
        : "[raw, markitdown]";
  const body =
    params.sourceType === "wechat"
      ? `## ⚙️ 提取记录\n\n- ${params.failureKind === "spawn" ? "脚本调用失败" : "提取失败"}: ${params.errorMessage}\n\n## 📌 原文\n\n${params.source}`
      : params.sourceType === "pdf"
        ? `## Original Content\n\n[PDF extraction failed: ${params.errorMessage}]`
        : `## Original Content\n\n[MarkItDown extraction failed: ${params.errorMessage}]`;

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

function emptyOutputMessage(command: string, sourceType: "wechat" | "pdf" | "markitdown", inputPath?: string): string {
  if (sourceType === "markitdown") {
    const suffix = inputPath && /\.pdf$/i.test(inputPath)
      ? " PDF files are not supported by the MarkItDown raw workflow; use PDF to Raw for OCR/assets."
      : " The process exited successfully but did not produce markdown on stdout.";
    return `${command} exited with code 0 but produced no markdown output.${suffix}`;
  }
  return `${command} exited with code 0 but produced no markdown output.`;
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

      const errMsg = stderr.trim() ||
        (code === 0
          ? emptyOutputMessage(settings.pythonPath, "wechat")
          : `${settings.pythonPath} exited with code ${code}`);
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

      const errMsg = stderr.trim() ||
        (code === 0
          ? emptyOutputMessage(settings.pdfPythonPath, "pdf")
          : `${settings.pdfPythonPath} exited with code ${code}`);
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

export function runMarkItDownScript(
  app: App,
  settings: OpenClawSettings,
  inputPath: string
): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (markdown: string) => {
      if (settled) return;
      settled = true;
      resolve(markdown);
    };

    if (!settings.markItDownPath.trim()) {
      const basename = inputPath.split("/").pop() ?? "MarkItDown Note";
      finish(buildFailedRawNote({
        title: basename,
        source: inputPath,
        sourceType: "markitdown",
        errorMessage: "MarkItDown path is not configured in OpenClaw settings.",
        failureKind: "spawn"
      }));
      return;
    }

    // MarkItDown writes converted Markdown to stdout by default.
    const vaultPath = resolveVaultFileSystemPath(app, inputPath);
    const args = [vaultPath];
    const proc = require("child_process").spawn(settings.markItDownPath, args, {
      timeout: settings.markItDownTimeoutMs,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: unknown) => { stdout += String(chunk); });
    proc.stderr.on("data", (chunk: unknown) => { stderr += String(chunk); });

    proc.on("close", (code: number | null, signal: string | null) => {
      if (code === 0 && stdout.trim()) {
        finish(stdout.trim());
        return;
      }

      const errMsg = stderr.trim() ||
        (signal
          ? `${settings.markItDownPath} terminated by signal ${signal}`
          : code === 0
            ? emptyOutputMessage(settings.markItDownPath, "markitdown", inputPath)
            : `${settings.markItDownPath} exited with code ${code}`);
      console.warn(`[runMarkItDownScript] script failed: ${errMsg}`);
      const basename = inputPath.split("/").pop() ?? "MarkItDown Note";
      finish(buildFailedRawNote({
        title: basename,
        source: inputPath,
        sourceType: "markitdown",
        errorMessage: errMsg,
        failureKind: "extract"
      }));
    });

    proc.on("error", (err: Error) => {
      console.error(`[runMarkItDownScript] spawn error: ${err.message}`);
      const basename = inputPath.split("/").pop() ?? "MarkItDown Note";
      finish(buildFailedRawNote({
        title: basename,
        source: inputPath,
        sourceType: "markitdown",
        errorMessage: err.message,
        failureKind: "spawn"
      }));
    });
  });
}
