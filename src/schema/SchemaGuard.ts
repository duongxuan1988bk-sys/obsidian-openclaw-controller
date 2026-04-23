type SchemaContext = {
  inferredType?: string;
  moduleHint?: string;
  activeNotePath?: string;
  additionalTags?: string[];
};

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseFrontmatter(text: string): { fm: string | null; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: null, body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

function hasKey(fm: string, key: string): boolean {
  return new RegExp(`^${key}\\s*:`, "m").test(fm);
}

function readKey(fm: string, key: string): string {
  const match = fm.match(new RegExp(`^${key}\\s*:\\s*([^\\n]*)$`, "m"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

function readListKey(fm: string, key: string): string[] {
  const lines = fm.split("\n");
  const values: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${key}\\s*:\\s*(.*)$`));
    if (!match) continue;

    const rawValue = match[1].trim();
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      values.push(
        ...rawValue
          .slice(1, -1)
          .split(",")
          .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean)
      );
      continue;
    }

    if (!rawValue) {
      let cursor = index + 1;
      while (cursor < lines.length) {
        const itemMatch = lines[cursor].match(/^\s*-\s+(.+?)\s*$/);
        if (!itemMatch) break;
        values.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ""));
        cursor += 1;
      }
      index = cursor - 1;
    }
  }

  return values;
}

function dateOnly(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "";
}

function upsertKey(fm: string, key: string, valueLine: string): string {
  const cleaned = removeKey(fm, key).trimEnd();
  return cleaned ? `${cleaned}\n${key}: ${valueLine}\n` : `${key}: ${valueLine}\n`;
}

function removeKey(fm: string, key: string): string {
  const lines = fm.split("\n");
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!new RegExp(`^${key}\\s*:`).test(line)) {
      kept.push(line);
      continue;
    }

    const rawValue = line.replace(new RegExp(`^${key}\\s*:\\s*`), "").trim();
    if (!rawValue) {
      let cursor = index + 1;
      while (cursor < lines.length && /^\s*-\s+/.test(lines[cursor])) cursor += 1;
      index = cursor - 1;
    }
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

function ensureListKey(fm: string, key: string, tag: string): string {
  const items = readListKey(fm, key);
  if (items.includes(tag)) return fm;
  return setListKey(fm, key, [...items, tag]);
}

function setListKey(fm: string, key: string, tags: string[]): string {
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  const value = `[${unique.join(", ")}]`;
  const cleaned = removeKey(fm, key).trimEnd();
  return cleaned ? `${cleaned}\n${key}: ${value}\n` : `${key}: ${value}\n`;
}

function readInlineListKey(fm: string, key: string): string[] {
  return readListKey(fm, key);
}

function removeListItems(fm: string, key: string, blocked: string[]): string {
  const blockedSet = new Set(blocked.map((item) => item.toLowerCase()));
  const kept = readInlineListKey(fm, key).filter((item) => !blockedSet.has(item.toLowerCase()));
  return setListKey(fm, key, kept);
}

function inferDomain(fm: string, path: string): string {
  const existing = readKey(fm, "domain").toLowerCase();
  if (existing) return existing;
  const normalizedPath = path.toLowerCase();
  if (normalizedPath.includes("openclaw")) return "openclaw";
  if (normalizedPath.includes("/ai/") || normalizedPath.includes("02ai")) return "ai";
  if (normalizedPath.includes("general")) return "general";
  return "general";
}

export function ensureSchemaFrontmatter(text: string, ctx: SchemaContext): string {
  const { fm, body } = parseFrontmatter(text);
  let nextFm = fm ?? "";

  if (!hasKey(nextFm, "status")) nextFm = upsertKey(nextFm, "status", "draft");
  const dateValue = dateOnly(readKey(nextFm, "date"));
  const createdValue = dateOnly(readKey(nextFm, "created"));
  if (hasKey(nextFm, "created") && createdValue) nextFm = upsertKey(nextFm, "created", createdValue);
  if (!hasKey(nextFm, "created")) nextFm = upsertKey(nextFm, "created", dateValue || todayISO());
  if (!hasKey(nextFm, "tags")) nextFm = ensureListKey(nextFm, "tags", "OpenClaw");

  const type = (ctx.inferredType ?? "").toLowerCase();
  const path = ctx.activeNotePath ?? "";
  const isRawContext = /\/01Raw\//i.test(path);
  const domain = inferDomain(nextFm, path);

  if (type && !hasKey(nextFm, "type")) nextFm = upsertKey(nextFm, "type", type);
  // Raw context belongs to the source note only. Generated target notes must
  // not inherit source-note lifecycle fields or tags.
  if (isRawContext && !type) nextFm = upsertKey(nextFm, "status", "raw");
  if (isRawContext && !type) nextFm = ensureListKey(nextFm, "tags", "raw");

  for (const tag of ctx.additionalTags ?? []) {
    nextFm = ensureListKey(nextFm, "tags", tag);
  }

  if (type === "raw") {
    nextFm = upsertKey(nextFm, "type", "raw");
    if (readKey(nextFm, "status") !== "failed-extract") {
      nextFm = upsertKey(nextFm, "status", "raw");
    }
    nextFm = ensureListKey(nextFm, "tags", "raw");
  }
  if (type === "insight") {
    nextFm = upsertKey(nextFm, "type", "insight");
    nextFm = upsertKey(nextFm, "status", "draft");
    nextFm = upsertKey(nextFm, "domain", domain);
    nextFm = upsertKey(nextFm, "workflow", "raw_to_insight");
    nextFm = removeKey(nextFm, "topic");
    nextFm = removeListItems(nextFm, "tags", ["raw", "Obsidian"]);
    nextFm = ensureListKey(nextFm, "tags", "insight");
    nextFm = ensureListKey(nextFm, "tags", domain);
  }

  const wrapped = `---\n${nextFm.trimEnd()}\n---\n\n`;
  return wrapped + body.replace(/^\n+/, "");
}
