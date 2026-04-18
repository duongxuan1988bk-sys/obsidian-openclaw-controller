import { normalizePath, TFile, type App } from "obsidian";

export const MONITORING_LOG_PATHS = {
  execution: "03Resources/00System/Monitoring/Execution Log.md",
  error: "03Resources/00System/Monitoring/Error Log.md",
  reviewQueue: "03Resources/00System/Monitoring/Review Queue.md"
} as const;

export type WorkflowExecutionLog = {
  action?: string;
  workflow?: string;
  sourceNote?: string;
  targetNote?: string;
  domain?: string;
  topic?: string;
  model?: string;
  durationMs?: number;
  /** Result level from postValidation (PASS / WARNING). FAIL never reaches logExecution. */
  validationLevel?: "PASS" | "WARNING";
};

export type WorkflowErrorLog = {
  action?: string;
  workflow?: string;
  sourceNote?: string;
  step?: string;
  errorType?: string;
  message?: string;
  durationMs?: number;
};

export type WorkflowWarningLog = {
  action?: string;
  workflow?: string;
  sourceNote?: string;
  targetNote?: string;
  domain?: string;
  topic?: string;
  message?: string;
  missingFields?: string[];
  missingSections?: string[];
  durationMs?: number;
};

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\n/g, " ").trim();
}

function formatDuration(durationMs?: number): string {
  return typeof durationMs === "number" && Number.isFinite(durationMs) ? String(Math.max(0, Math.round(durationMs))) : "";
}

const RETENTION_DAYS = 3 as const;

/**
 * Returns current Beijing time (UTC+8) as "YYYY-MM-DD HH:mm:ss".
 */
function beijingTimestamp(): string {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60_000);
  const cst = new Date(utc + 8 * 60 * 60 * 1000);
  const yyyy = cst.getFullYear();
  const mm = String(cst.getMonth() + 1).padStart(2, "0");
  const dd = String(cst.getDate()).padStart(2, "0");
  const hh = String(cst.getHours()).padStart(2, "0");
  const min = String(cst.getMinutes()).padStart(2, "0");
  const sec = String(cst.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}

/**
 * Parse a timestamp string from the log (handles both legacy ISO-UTC
 * "## YYYY-MM-DDTHH:mm:ss.sssZ" and current "## YYYY-MM-DD HH:mm:ss").
 * Returns a Date in local JS time, or null if unrecognisable.
 */
function parseLogTimestamp(line: string): Date | null {
  const stripped = line.replace(/^##\s*/, "").trim();
  if (!stripped) return null;
  // Current format: "2026-04-17 13:45:00"
  const cstMatch = stripped.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (cstMatch) {
    const [, yyyy, mm, dd, hh, min, sec] = cstMatch;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh) - 8, Number(min), Number(sec)));
  }
  // Legacy ISO-UTC format: "2026-04-17T05:45:00.000Z"
  const isoMatch = stripped.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2}).*Z$/);
  if (isoMatch) {
    const [, hh, min, sec] = isoMatch;
    const d = new Date(stripped);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  if (parts.length <= 1) return;

  let current = "";
  for (const part of parts.slice(0, -1)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

async function getOrCreateLogFile(app: App, path: string): Promise<TFile> {
  const normalized = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFile) return existing;

  await ensureParentFolders(app, normalized);
  return await app.vault.create(normalized, "");
}

/**
 * Append a new entry to a monitoring log file, then trim entries older than
 * RETENTION_DAYS (3 days by default).  The file is only re-written when
 * trimming actually removes something, to avoid unnecessary disk I/O.
 */
async function appendAndTrimLog(app: App, path: string, entry: string): Promise<void> {
  const resolvedPath = resolveMonitoringPath(app, path);
  const file = await getOrCreateLogFile(app, resolvedPath);
  const content = await app.vault.read(file);
  const next = `${content}${entry}`;
  const trimmed = trimEntriesOlderThan(next, RETENTION_DAYS);
  if (trimmed !== next || next !== content) {
    await app.vault.modify(file, trimmed);
  }
}

/**
 * Remove log entries (blocks separated by "## timestamp" lines) older than
 * `days`.  Returns the original content unchanged when no trimming is needed.
 */
function trimEntriesOlderThan(content: string, days: number): string {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const lines = content.split("\n");
  const kept: string[] = [];
  let currentEntry: string[] = [];
  let currentEntryTimestamp: Date | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // Finish the previous entry
      if (currentEntryTimestamp === null || currentEntryTimestamp.getTime() >= cutoffMs) {
        kept.push(...currentEntry);
      }
      currentEntry = [line];
      currentEntryTimestamp = parseLogTimestamp(line);
    } else {
      currentEntry.push(line);
    }
  }

  // Don't drop the last entry without a trailing ## marker
  if (currentEntryTimestamp === null || currentEntryTimestamp.getTime() >= cutoffMs) {
    kept.push(...currentEntry);
  }

  return kept.join("\n");
}

function resolveMonitoringPath(app: App, path: string): string {
  const normalized = normalizePath(path);

  // Some vaults keep PARA as a top-level folder. The Monitoring spec is written
  // relative to PARA, so prefer the existing PARA tree instead of creating a
  // second root-level 03Resources folder. This preference is intentional even
  // if the wrong root-level log was created by an older plugin build.
  if (!normalized.startsWith("PARA/") && app.vault.getAbstractFileByPath("PARA")) {
    return normalizePath(`PARA/${normalized}`);
  }

  if (app.vault.getAbstractFileByPath(normalized)) return normalized;
  return normalized;
}

export async function logExecution(app: App, input: WorkflowExecutionLog): Promise<void> {
  const timestamp = beijingTimestamp();
  const entry = [
    `## ${timestamp}`,
    "",
    `- action: ${formatValue(input.action)}`,
    `- workflow: ${formatValue(input.workflow)}`,
    `- source_note: ${formatValue(input.sourceNote)}`,
    `- target_note: ${formatValue(input.targetNote)}`,
    `- domain: ${formatValue(input.domain)}`,
    `- topic: ${formatValue(input.topic)}`,
    `- model: ${formatValue(input.model)}`,
    "- status: success",
    `- validation_level: ${formatValue(input.validationLevel ?? "PASS")}`,
    `- duration_ms: ${formatDuration(input.durationMs)}`,
    "",
    ""
  ].join("\n");

  try {
    await appendAndTrimLog(app, MONITORING_LOG_PATHS.execution, entry);
  } catch (error) {
    console.warn("[OpenClaw Monitoring] Failed to write execution log", error);
  }
}

export async function logError(app: App, input: WorkflowErrorLog): Promise<void> {
  const timestamp = beijingTimestamp();
  const entry = [
    `## ${timestamp}`,
    "",
    `- action: ${formatValue(input.action)}`,
    `- workflow: ${formatValue(input.workflow)}`,
    `- source_note: ${formatValue(input.sourceNote)}`,
    "- status: failed",
    `- step: ${formatValue(input.step)}`,
    `- error_type: ${formatValue(input.errorType)}`,
    `- message: ${formatValue(input.message)}`,
    `- duration_ms: ${formatDuration(input.durationMs)}`,
    "",
    ""
  ].join("\n");

  try {
    await appendAndTrimLog(app, MONITORING_LOG_PATHS.error, entry);
  } catch (error) {
    console.warn("[OpenClaw Monitoring] Failed to write error log", error);
  }
}

export async function logWarning(app: App, input: WorkflowWarningLog): Promise<void> {
  const timestamp = beijingTimestamp();
  const entry = [
    `## ${timestamp}`,
    "",
    `- workflow: ${formatValue(input.workflow)}`,
    `- source_note: ${formatValue(input.sourceNote)}`,
    `- target_note: ${formatValue(input.targetNote)}`,
    `- domain: ${formatValue(input.domain)}`,
    `- topic: ${formatValue(input.topic)}`,
    `- warning_message: ${formatValue(input.message)}`,
    `- missing_fields: ${(input.missingFields ?? []).join(", ")}`,
    `- missing_sections: ${(input.missingSections ?? []).join(", ")}`,
    "",
    ""
  ].join("\n");

  try {
    await appendToReviewQueue(app, entry);
  } catch (error) {
    console.warn("[OpenClaw Monitoring] Failed to write review queue entry", error);
  }
}

/**
 * Appends a structured entry to the Review Queue file.
 * If the file contains only a title line (e.g. "# Review Queue"), entries are
 * inserted below the title rather than appended at the end.
 * After appending, old entries beyond RETENTION_DAYS are trimmed.
 */
async function appendToReviewQueue(app: App, entry: string): Promise<void> {
  const path = resolveMonitoringPath(app, MONITORING_LOG_PATHS.reviewQueue);
  const normalized = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(normalized);

  if (!(existing instanceof TFile)) {
    // File doesn't exist yet — create with entry
    await ensureParentFolders(app, normalized);
    await app.vault.create(normalized, `${entry}\n`);
    return;
  }

  const content = await app.vault.read(existing);
  const titleOnly = /^#\s*\S.*?\n?$/m.test(content.trim());

  if (titleOnly) {
    // Keep title at top, insert entry immediately below
    const newContent = `${content.trim()}\n\n${entry}\n`;
    const trimmed = trimEntriesOlderThan(newContent, RETENTION_DAYS);
    await app.vault.modify(existing, trimmed);
  } else {
    const updated = `${content}${entry}`;
    const trimmed = trimEntriesOlderThan(updated, RETENTION_DAYS);
    if (trimmed !== content) {
      await app.vault.modify(existing, trimmed);
    }
  }
}
