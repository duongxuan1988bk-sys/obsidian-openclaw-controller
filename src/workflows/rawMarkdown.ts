export type RawDomain = "biotech" | "openclaw" | "ai" | "general";

export function todayISO(): string {
  const now = new Date();
  return now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
}

export function sanitizeRawTitle(value: string): string {
  return value
    .replace(/[\\/:?<>|"]/g, " ")
    .replace(/[*_`#[\]()>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

export function rawFrontmatterString(markdown: string, key: string): string {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return "";
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*)$`, "m");
  const lineMatch = match[1].match(keyPattern);
  if (!lineMatch) return "";
  return lineMatch[1].trim().replace(/^["']|["']$/g, "");
}

export function upsertRawFrontmatterString(markdown: string, key: string, value: string): string {
  const blockMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  const line = `${key}: ${value}`;
  if (!blockMatch) {
    return `---\n${line}\n---\n\n${markdown}`;
  }

  const block = blockMatch[1];
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*.*$`, "m");
  const nextBlock = keyPattern.test(block) ? block.replace(keyPattern, line) : `${block}\n${line}`;
  return markdown.replace(blockMatch[0], `---\n${nextBlock}\n---\n`);
}

export function upsertRawFrontmatterStringIfMissing(markdown: string, key: string, value: string): string {
  return rawFrontmatterString(markdown, key) ? markdown : upsertRawFrontmatterString(markdown, key, value);
}

export function normalizeRawExtractionStatus(markdown: string): string {
  return rawFrontmatterString(markdown, "status") === "failed-extract"
    ? markdown
    : upsertRawFrontmatterString(markdown, "status", "draft");
}

export function hasExactMarkdownSection(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "im").test(markdown);
}

export function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function buildRawNoteMarkdown(title: string, domain: RawDomain, content: string): string {
  const dateStr = todayISO();
  return `---\ntitle: ${title}\ndomain: ${domain}\ntype: raw\ndate: ${dateStr}\ncreated: ${dateStr}\nstatus: draft\nsource: manual\nworkflow: ${domain}_to_raw\ntags: [raw, ${domain}]\n---\n\n# ${title}\n\n## Source\n\nManual input\n\n## Original Content\n\n${content}\n`;
}
