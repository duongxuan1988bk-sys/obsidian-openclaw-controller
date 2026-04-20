import { normalizePath, TFile, TFolder, type App } from "obsidian";

export function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[\\/:?<>|"]/g, " ")
    .replace(/[*_`#[\]()>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function extractFrontmatterTitle(markdown: string): string | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const titleLine = match[1]
    .split("\n")
    .find((line) => /^title\s*:/i.test(line));
  if (!titleLine) return null;
  return titleLine.replace(/^title\s*:\s*/i, "").replace(/^["']|["']$/g, "").trim() || null;
}

function buildFallbackTitle(sourceTitle: string, label: string): string {
  const base = sanitizeFilenamePart(sourceTitle);
  return base ? `${base} ${label}` : "untitled-note";
}

function timestampSlug(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}${min}`;
}

function titleFromMarkdown(markdown: string): string | null {
  return extractFrontmatterTitle(markdown) ?? markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
    return sanitizeFilenamePart(last) || `WeChat ${timestampSlug()}`;
  } catch {
    return `WeChat ${timestampSlug()}`;
  }
}

function getNextSeqPrefix(app: App, targetDir: string): string {
  const dir = app.vault.getAbstractFileByPath(targetDir);
  if (!(dir instanceof TFolder)) return "01";
  const count = dir.children.filter((f) => f instanceof TFile && f.extension === "md").length;
  return String(count + 1).padStart(2, "0");
}

function parseSequencedMarkdownBase(file: TFile): { seq: string; base: string } | null {
  if (file.extension !== "md") return null;
  const match = file.basename.match(/^(\d{2,3})\s+(.+)$/);
  if (!match) return null;
  return { seq: match[1], base: match[2] };
}

function markdownNameExists(dir: TFolder, name: string): boolean {
  const lowerName = name.toLowerCase();
  return dir.children.some((child) => child instanceof TFile && child.extension === "md" && child.name.toLowerCase() === lowerName);
}

function resolveSequencedMarkdownPath(app: App, targetDir: string, safeBase: string): string {
  const seq = getNextSeqPrefix(app, targetDir);
  const candidateName = `${seq} ${safeBase}.md`;
  const candidate = normalizePath(`${targetDir}/${candidateName}`);
  const dir = app.vault.getAbstractFileByPath(targetDir);

  if (!(dir instanceof TFolder)) {
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;

    let index = 2;
    let alt = normalizePath(`${targetDir}/${seq} ${safeBase} ${index}.md`);
    while (app.vault.getAbstractFileByPath(alt)) {
      index += 1;
      alt = normalizePath(`${targetDir}/${seq} ${safeBase} ${index}.md`);
    }
    return alt;
  }

  let colliderSeq: string | null = markdownNameExists(dir, candidateName) ? seq : null;
  for (const child of dir.children) {
    if (!(child instanceof TFile)) continue;
    const parsed = parseSequencedMarkdownBase(child);
    if (parsed?.base.toLowerCase() === safeBase.toLowerCase()) {
      colliderSeq = parsed.seq;
      break;
    }
  }

  if (!colliderSeq) return candidate;

  let index = 2;
  let altName = `${colliderSeq} ${safeBase} ${index}.md`;
  while (markdownNameExists(dir, altName)) {
    index += 1;
    altName = `${colliderSeq} ${safeBase} ${index}.md`;
  }
  return normalizePath(`${targetDir}/${altName}`);
}

export function resolveOutputPath(
  app: App,
  targetDir: string,
  markdown: string,
  sourceTitle: string,
  label: string,
  filenameStrategy?: string
): string {
  const fromFrontmatter = filenameStrategy === "frontmatter_title" ? extractFrontmatterTitle(markdown) : null;
  const frontmatterBase = fromFrontmatter ? sanitizeFilenamePart(fromFrontmatter) : "";
  const fallbackBase = sanitizeFilenamePart(buildFallbackTitle(sourceTitle, label)) || "untitled-note";
  const safeBase = frontmatterBase || fallbackBase;
  return resolveSequencedMarkdownPath(app, targetDir, safeBase);
}

export function resolveRawOutputPath(
  app: App,
  targetDir: string,
  markdown: string,
  url: string,
  filenameStrategy?: string
): string {
  const rawDir = normalizeRawWechatDir(targetDir);
  const markdownTitle = titleFromMarkdown(markdown);
  const titleSeed =
    filenameStrategy === "source_based"
      ? markdownTitle ?? titleFromUrl(url)
      : extractFrontmatterTitle(markdown) ?? markdownTitle ?? titleFromUrl(url);
  const safeBase = sanitizeFilenamePart(titleSeed) || `Raw ${timestampSlug()}`;
  return resolveSequencedMarkdownPath(app, rawDir, safeBase);
}

function normalizeRawWechatDir(targetDir: string): string {
  const normalized = normalizeRegistryTargetDir(targetDir);
  if (/\/01Raw$/i.test(normalized)) return `${normalized}/WeChat`;
  return normalized;
}

function normalizeRegistryTargetDir(targetDir: string): string {
  const normalized = normalizePath(targetDir).replace(/\/$/, "").replace(/^\/+/, "");
  if (!normalized) return normalized;

  if (/^PARA\//i.test(normalized)) return normalized;
  if (/^03Resources\//i.test(normalized)) return `PARA/${normalized}`;
  if (/^01Raw(\/|$)/i.test(normalized)) return `PARA/03Resources/${normalized}`;
  return normalized;
}
