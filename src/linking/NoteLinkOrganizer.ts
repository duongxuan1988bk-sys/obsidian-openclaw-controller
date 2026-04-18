import type { App, TFile } from "obsidian";

export type LinkScanDays = 3 | 7 | 14;

export type LinkableNoteType =
  | "insight"
  | "theory"
  | "case"
  | "doc"
  | "debug"
  | "system"
  | "concept"
  | "summary"
  | "permanent"
  | "literature"
  | "method";

export type LinkableNote = {
  file: TFile;
  content: string;
  title: string;
  aliases: string[];
  type: LinkableNoteType;
  domain: string;
  topic: string;
  source: string;
  workflow: string;
  tags: string[];
  createdAt: number;
  keywords: Set<string>;
  properTerms: Set<string>;
  outgoingLinks: Set<string>;
};

export type LinkCandidate = {
  id: string;
  sourcePath: string;
  sourceTitle: string;
  targetPath: string;
  targetTitle: string;
  score: number;
  reasons: string[];
  description: string;
  defaultSelected: boolean;
};

export type LinkOrganizerScanResult = {
  days: LinkScanDays;
  sourceCount: number;
  targetCount: number;
  candidates: LinkCandidate[];
};

export type ApprovedLinkCandidate = Pick<LinkCandidate, "sourcePath" | "targetPath" | "targetTitle" | "description">;

export type LinkWriteResult = {
  updatedFiles: string[];
  addedLinks: number;
};

export const RELATED_NOTES_START = "<!-- openclaw-related-notes:start -->";
export const RELATED_NOTES_END = "<!-- openclaw-related-notes:end -->";

const DEFAULT_MAX_CANDIDATES_PER_SOURCE = 8;
const STRONG_THRESHOLD = 80;
const DISPLAY_THRESHOLD = 65;
const MIN_EFFECTIVE_KEYWORDS = 5;
const MIN_EFFECTIVE_CONTENT_LENGTH = 300;

const LINKABLE_TYPES = new Set<LinkableNoteType>([
  "insight",
  "theory",
  "case",
  "doc",
  "debug",
  "system",
  "concept",
  "summary",
  "permanent",
  "literature",
  "method"
]);

const RAW_OR_INTERMEDIATE_TYPES = new Set([
  "raw",
  "pdf_raw",
  "ocr_raw",
  "extracted",
  "temporary",
  "draft_material",
  "module",
  "entry",
  "note"
]);

const GENERIC_TERMS = new Set([
  "analysis",
  "article",
  "background",
  "content",
  "data",
  "document",
  "figure",
  "generated",
  "insight",
  "markdown",
  "method",
  "model",
  "note",
  "openclaw",
  "paper",
  "pdf",
  "pipeline",
  "process",
  "research",
  "result",
  "section",
  "source",
  "summary",
  "system",
  "workflow",
  "using",
  "with",
  "from",
  "this",
  "that",
  "these",
  "those",
  "and",
  "the",
  "for",
  "raw",
  "notes",
  "content",
  "original"
]);

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  let currentKey = "";
  for (const rawLine of match[1].split("\n")) {
    const listItem = rawLine.match(/^\s*-\s+(.+)$/);
    if (listItem && currentKey) {
      const existing = Array.isArray(result[currentKey]) ? result[currentKey] as string[] : [];
      result[currentKey] = [...existing, cleanYamlScalar(listItem[1])];
      continue;
    }

    const colonIdx = rawLine.indexOf(":");
    if (colonIdx === -1) continue;
    const key = rawLine.slice(0, colonIdx).trim();
    const rawValue = rawLine.slice(colonIdx + 1).trim();
    if (!key) continue;
    currentKey = key;
    if (!rawValue) {
      result[key] = [];
      continue;
    }
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      result[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map((item) => cleanYamlScalar(item))
        .filter(Boolean);
      continue;
    }
    result[key] = cleanYamlScalar(rawValue);
  }
  return result;
}

function cleanYamlScalar(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function scalar(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(", ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return trimmed
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[()[\]{}'"`*_~!?:;,.，。！？：；、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTerm(value: string): string {
  return normalizeTerm(value).replace(/\s+/g, "");
}

function includesNormalized(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeTerm(needle);
  if (!normalizedNeedle || normalizedNeedle.length < 3) return false;
  return normalizeTerm(haystack).includes(normalizedNeedle) || compactTerm(haystack).includes(compactTerm(normalizedNeedle));
}

function parseDateMs(value: unknown): number | null {
  if (value == null) return null;
  const raw = scalar(value);
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function createdAtMs(file: TFile, frontmatter: Record<string, unknown>): number {
  return (
    parseDateMs(frontmatter.created) ??
    parseDateMs(frontmatter.generatedAt) ??
    parseDateMs(frontmatter.date) ??
    file.stat.ctime ??
    file.stat.mtime
  );
}

function inferNoteType(file: TFile, frontmatter: Record<string, unknown>): LinkableNoteType | null {
  const rawType = scalar(frontmatter.type).toLowerCase();
  if (RAW_OR_INTERMEDIATE_TYPES.has(rawType)) return null;
  if (LINKABLE_TYPES.has(rawType as LinkableNoteType)) return rawType as LinkableNoteType;

  const workflow = scalar(frontmatter.workflow).toLowerCase();
  if (workflow.includes("_to_raw") || workflow.includes("pdf_to_raw") || workflow.includes("wechat_to_raw")) return null;
  if (workflow.includes("raw_to_insight")) return "insight";
  if (workflow.includes("note_to_theory")) return "theory";
  if (workflow.includes("note_to_case")) return "case";
  if (workflow.includes("note_to_method")) return "method";
  if (workflow.includes("note_to_doc")) return "doc";
  if (workflow.includes("note_to_debug")) return "debug";
  if (workflow.includes("note_to_system")) return "system";

  const path = file.path.toLowerCase();
  if (path.includes("/01raw/") || path.includes("/01raw")) return null;
  if (path.includes("/02insight/")) return "insight";
  if (path.includes("/01theory/")) return "theory";
  if (path.includes("/02case/") || path.includes("/03user case/")) return "case";
  if (path.includes("/02method/") || path.includes("/method/") || path.includes("/02_method_development/")) return "method";
  if (path.includes("/07doc/") || path.includes("/doc/")) return "doc";
  if (path.includes("/04debug/") || path.includes("/debug/")) return "debug";
  if (path.includes("/00system/") || path.includes("/system/")) return "system";

  return null;
}

function stripFrontmatterAndRelatedBlock(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const markerPattern = new RegExp(`${escapeRegex(RELATED_NOTES_START)}[\\s\\S]*?${escapeRegex(RELATED_NOTES_END)}\\n?`, "m");
  return withoutFrontmatter.replace(markerPattern, "");
}

function extractKeywords(text: string): Set<string> {
  const normalized = text.replace(/[`*_#[\]()>|{}]/g, " ");
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g)) {
    const term = normalizeTerm(match[0]);
    if (term.length < 3 && !/[\u4e00-\u9fff]{2,}/.test(term)) continue;
    if (GENERIC_TERMS.has(term)) continue;
    terms.add(term);
  }
  return terms;
}

function extractProperTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9_-]{2,}\b|\b[A-Za-z]+[0-9][A-Za-z0-9_-]*\b/g)) {
    const term = normalizeTerm(match[0]);
    if (!term || GENERIC_TERMS.has(term)) continue;
    terms.add(term);
  }
  return terms;
}

function extractOutgoingLinks(markdown: string): Set<string> {
  const links = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    links.add(normalizeLinkTarget(match[1]));
  }
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    links.add(normalizeLinkTarget(decodeURIComponent(match[1])));
  }
  return links;
}

function normalizeLinkTarget(value: string): string {
  return normalizeTerm(value.replace(/\\/g, "/").replace(/\.md$/i, "").split("/").pop() ?? value);
}

function isAlreadyLinked(source: LinkableNote, target: LinkableNote): boolean {
  const targets = [
    normalizeLinkTarget(target.file.basename),
    normalizeLinkTarget(target.title),
    normalizeLinkTarget(target.file.path)
  ];
  return targets.some((item) => source.outgoingLinks.has(item));
}

function intersection<T>(left: Set<T>, right: Set<T>): T[] {
  const result: T[] = [];
  for (const item of left) {
    if (right.has(item)) result.push(item);
  }
  return result;
}

function cap(value: number, max: number): number {
  return Math.min(value, max);
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasStrongSignal(signals: {
  titleHit: boolean;
  aliasHit: boolean;
  sharedStrongTags: string[];
  sourceOverlap: boolean;
  keywordOverlap: string[];
  properOverlap: string[];
  sharedOutgoingLinks: string[];
  sameDomain: boolean;
}): boolean {
  return (
    signals.titleHit ||
    signals.aliasHit ||
    signals.sharedStrongTags.length > 0 ||
    (signals.sourceOverlap && (signals.keywordOverlap.length > 0 || signals.properOverlap.length > 0)) ||
    (signals.sameDomain && signals.properOverlap.length > 0) ||
    signals.sharedOutgoingLinks.length > 0
  );
}

function titleFor(file: TFile, frontmatter: Record<string, unknown>): string {
  return scalar(frontmatter.title) || file.basename;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildLinkableNote(file: TFile, content: string): LinkableNote | null {
  const frontmatter = parseFrontmatter(content);
  const type = inferNoteType(file, frontmatter);
  if (!type) return null;

  const effectiveContent = stripFrontmatterAndRelatedBlock(content);
  const keywords = extractKeywords([
    titleFor(file, frontmatter),
    scalar(frontmatter.domain),
    scalar(frontmatter.topic),
    stringList(frontmatter.tags).join(" "),
    stringList(frontmatter.keywords).join(" "),
    effectiveContent
  ].join("\n"));

  if (effectiveContent.trim().length < MIN_EFFECTIVE_CONTENT_LENGTH && keywords.size < MIN_EFFECTIVE_KEYWORDS) return null;

  return {
    file,
    content,
    title: titleFor(file, frontmatter),
    aliases: uniq([...stringList(frontmatter.aliases), ...stringList(frontmatter.alias)]),
    type,
    domain: scalar(frontmatter.domain).toLowerCase(),
    topic: scalar(frontmatter.topic).toLowerCase(),
    source: scalar(frontmatter.source) || scalar(frontmatter.sourceUrl) || scalar(frontmatter.sourcePath) || scalar(frontmatter.doi),
    workflow: scalar(frontmatter.workflow).toLowerCase(),
    tags: stringList(frontmatter.tags).map((tag) => normalizeTerm(tag.replace(/^#/, ""))).filter((tag) => tag && !GENERIC_TERMS.has(tag)),
    createdAt: createdAtMs(file, frontmatter),
    keywords,
    properTerms: extractProperTerms(effectiveContent),
    outgoingLinks: extractOutgoingLinks(content)
  };
}

export function scoreLinkCandidate(source: LinkableNote, target: LinkableNote): LinkCandidate | null {
  if (source.file.path === target.file.path) return null;
  if (isAlreadyLinked(source, target)) return null;

  const sourceBody = stripFrontmatterAndRelatedBlock(source.content);
  const titleHit = includesNormalized(sourceBody, target.title) || includesNormalized(sourceBody, target.file.basename);
  const aliasHit = target.aliases.some((alias) => includesNormalized(sourceBody, alias));
  const sourceTags = new Set(source.tags);
  const targetTags = new Set(target.tags);
  const sharedTags = intersection(sourceTags, targetTags);
  const sharedStrongTags = sharedTags.filter((tag) => !GENERIC_TERMS.has(tag));
  const sameDomain = Boolean(source.domain && target.domain && source.domain === target.domain);
  const sameTopic = Boolean(source.topic && target.topic && source.topic === target.topic);
  const sourceOverlap = Boolean(source.source && target.source && normalizeTerm(source.source) === normalizeTerm(target.source));
  const keywordOverlap = intersection(source.keywords, target.keywords).filter((term) => !GENERIC_TERMS.has(term));
  const properOverlap = intersection(source.properTerms, target.properTerms).filter((term) => !GENERIC_TERMS.has(term));
  const sharedOutgoingLinks = intersection(source.outgoingLinks, target.outgoingLinks);

  const signals = { titleHit, aliasHit, sharedStrongTags, sourceOverlap, keywordOverlap, properOverlap, sharedOutgoingLinks, sameDomain };
  if (!hasStrongSignal(signals)) return null;

  let score = 0;
  const reasons: string[] = [];

  if (titleHit) {
    score += 25;
    reasons.push("源笔记正文提到目标标题");
  }
  if (aliasHit) {
    score += 25;
    reasons.push("源笔记正文提到目标别名");
  }
  if (sharedStrongTags.length) {
    score += cap(sharedStrongTags.length * 8, 16);
    reasons.push(`共享标签：${sharedStrongTags.slice(0, 3).join(", ")}`);
  }
  if (sameDomain) {
    score += 6;
    reasons.push(`同属 domain：${source.domain}`);
  }
  if (sameTopic) {
    score += 8;
    reasons.push(`同属 topic：${source.topic}`);
  }
  if (sourceOverlap) {
    score += 8;
    reasons.push("来自同一 source/provenance");
  }
  if (keywordOverlap.length) {
    score += cap(keywordOverlap.length * 4, 16);
    reasons.push(`共享关键词：${keywordOverlap.slice(0, 4).join(", ")}`);
  }
  if (properOverlap.length) {
    score += cap(properOverlap.length * 5, 10);
    reasons.push(`共享专有名词：${properOverlap.slice(0, 3).join(", ")}`);
  }
  if (sharedOutgoingLinks.length) {
    score += cap(sharedOutgoingLinks.length * 3, 6);
    reasons.push("共享已有出链");
  }
  if (["concept", "method", "summary", "permanent"].includes(target.type)) score += 6;
  if (sourceOverlap && !keywordOverlap.length && !properOverlap.length && !titleHit && !aliasHit) score -= 10;
  if (!titleHit && !aliasHit && keywordOverlap.length <= 1 && properOverlap.length === 0 && sharedStrongTags.length === 0) score -= 20;
  if (stripFrontmatterAndRelatedBlock(target.content).trim().length < MIN_EFFECTIVE_CONTENT_LENGTH) score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score < DISPLAY_THRESHOLD) return null;

  return {
    id: `${source.file.path}::${target.file.path}`,
    sourcePath: source.file.path,
    sourceTitle: source.title,
    targetPath: target.file.path,
    targetTitle: target.title,
    score,
    reasons,
    description: buildDescription(reasons),
    defaultSelected: score >= STRONG_THRESHOLD
  };
}

function buildDescription(reasons: string[]): string {
  const first = reasons[0] ?? "相关知识节点";
  return first
    .replace(/^源笔记正文提到目标标题$/, "正文提到该主题")
    .replace(/^源笔记正文提到目标别名$/, "正文提到该主题别名")
    .replace(/^来自同一 source\/provenance$/, "来自同一来源材料");
}

function sortCandidates(a: LinkCandidate, b: LinkCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath);
  return a.targetPath.localeCompare(b.targetPath);
}

function renderLinkTarget(targetPath: string): string {
  return targetPath.replace(/\.md$/i, "").replace(/\|/g, "\\|").replace(/\]/g, "\\]");
}

function renderRelatedBlock(items: ApprovedLinkCandidate[]): string {
  const lines = items.map((item) => {
    const description = item.description.trim();
    return description
      ? `- [[${renderLinkTarget(item.targetPath)}|${item.targetTitle}]]：${description}`
      : `- [[${renderLinkTarget(item.targetPath)}|${item.targetTitle}]]`;
  });
  return `${RELATED_NOTES_START}\n## Related Notes\n\n${lines.join("\n")}\n${RELATED_NOTES_END}\n`;
}

function existingPluginBlockItems(markdown: string): ApprovedLinkCandidate[] {
  const start = markdown.indexOf(RELATED_NOTES_START);
  const end = markdown.indexOf(RELATED_NOTES_END);
  if (start === -1 || end === -1 || end <= start) return [];
  const block = markdown.slice(start, end);
  const items: ApprovedLinkCandidate[] = [];
  for (const match of block.matchAll(/^- \[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\](?:：(.+))?$/gm)) {
    const targetPath = match[1].trim().endsWith(".md") ? match[1].trim() : `${match[1].trim()}.md`;
    items.push({
      sourcePath: "",
      targetPath,
      targetTitle: (match[2] ?? match[1]).trim(),
      description: (match[3] ?? "").trim()
    });
  }
  return items;
}

function upsertRelatedBlock(markdown: string, approved: ApprovedLinkCandidate[]): string {
  const existing = existingPluginBlockItems(markdown);
  const merged = new Map<string, ApprovedLinkCandidate>();
  for (const item of existing) merged.set(normalizeLinkTarget(item.targetPath), item);
  for (const item of approved) merged.set(normalizeLinkTarget(item.targetPath), item);
  const block = renderRelatedBlock([...merged.values()].sort((a, b) => a.targetTitle.localeCompare(b.targetTitle)));
  const markerPattern = new RegExp(`${escapeRegex(RELATED_NOTES_START)}[\\s\\S]*?${escapeRegex(RELATED_NOTES_END)}\\n?`, "m");
  if (markerPattern.test(markdown)) {
    return markdown.replace(markerPattern, block);
  }
  return `${markdown.trimEnd()}\n\n${block}`;
}

export class NoteLinkOrganizer {
  constructor(private readonly app: App) {}

  async scan(days: LinkScanDays): Promise<LinkOrganizerScanResult> {
    const now = Date.now();
    const since = now - days * 24 * 60 * 60 * 1000;
    const notes = await this.loadLinkableNotes();
    const sources = notes.filter((note) => note.createdAt >= since);
    const candidates: LinkCandidate[] = [];

    for (const source of sources) {
      const sourceCandidates = notes
        .map((target) => scoreLinkCandidate(source, target))
        .filter((candidate): candidate is LinkCandidate => candidate != null)
        .sort(sortCandidates)
        .slice(0, DEFAULT_MAX_CANDIDATES_PER_SOURCE);
      candidates.push(...sourceCandidates);
    }

    return {
      days,
      sourceCount: sources.length,
      targetCount: notes.length,
      candidates: candidates.sort(sortCandidates)
    };
  }

  async applyApprovedLinks(approved: ApprovedLinkCandidate[]): Promise<LinkWriteResult> {
    const bySource = new Map<string, ApprovedLinkCandidate[]>();
    for (const item of approved) {
      const list = bySource.get(item.sourcePath) ?? [];
      list.push(item);
      bySource.set(item.sourcePath, list);
    }

    const updatedFiles: string[] = [];
    let addedLinks = 0;
    for (const [sourcePath, items] of bySource) {
      const abstractFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!abstractFile || !("extension" in abstractFile) || abstractFile.extension !== "md") continue;
      const file = abstractFile as TFile;
      const markdown = await this.app.vault.read(file);
      const beforeLinks = new Set(existingPluginBlockItems(markdown).map((item) => normalizeLinkTarget(item.targetPath)));
      const nextMarkdown = upsertRelatedBlock(markdown, items);
      if (nextMarkdown !== markdown) {
        await this.app.vault.modify(file, nextMarkdown);
        updatedFiles.push(file.path);
        addedLinks += items.filter((item) => !beforeLinks.has(normalizeLinkTarget(item.targetPath))).length;
      }
    }

    return { updatedFiles, addedLinks };
  }

  private async loadLinkableNotes(): Promise<LinkableNote[]> {
    const files = this.app.vault.getMarkdownFiles();
    const notes: LinkableNote[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const note = buildLinkableNote(file, content);
      if (note) notes.push(note);
    }
    return notes;
  }
}
