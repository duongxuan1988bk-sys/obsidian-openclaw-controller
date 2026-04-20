import {
  hasExactMarkdownSection,
  sanitizeRawTitle,
  todayISO,
  type RawDomain,
  upsertRawFrontmatterString,
  upsertRawFrontmatterStringIfMissing,
  yamlString
} from "./rawMarkdown";

export type { RawDomain };

export function resolveMarkItDownRawTargetDir(domain: RawDomain): string {
  const segment = domain === "ai"
    ? "AI"
    : domain === "openclaw"
      ? "OpenClaw"
      : domain === "biotech"
        ? "Biotech"
        : "General";
  return `PARA/03Resources/01Raw/MarkItDown/${segment}`;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function titleFromSourceFilename(inputPath: string): string {
  const basename = inputPath.split("/").pop() ?? "";
  return sanitizeRawTitle(basename.replace(/\.[^.]+$/, "")) ||
    "MarkItDown Note";
}

export function ensureMarkItDownRawMarkdown(markdown: string, inputPath: string, domain: RawDomain): string {
  let next = markdown.trim();
  const title = titleFromSourceFilename(inputPath);

  if (!hasExactMarkdownSection(next, "original content")) {
    const body = stripFrontmatter(next) || "[No content extracted via MarkItDown]";
    next = `# ${title}\n\n## Source\n\n- File: ${inputPath}\n\n## Original Content\n\n${body}\n`;
  } else if (!hasExactMarkdownSection(next, "source")) {
    next += "\n\n## Source\n\n- File: " + inputPath + "\n";
  }

  next = upsertRawFrontmatterString(next, "title", yamlString(title));
  next = upsertRawFrontmatterStringIfMissing(next, "type", "raw");
  next = upsertRawFrontmatterStringIfMissing(next, "date", todayISO());
  next = upsertRawFrontmatterStringIfMissing(next, "tags", "[raw, markitdown]");
  next = upsertRawFrontmatterStringIfMissing(next, "source", yamlString(inputPath));
  next = upsertRawFrontmatterStringIfMissing(next, "status", "draft");
  next = upsertRawFrontmatterString(next, "domain", domain);
  next = upsertRawFrontmatterString(next, "workflow", "markitdown_to_raw");

  return next.trimEnd() + "\n";
}
