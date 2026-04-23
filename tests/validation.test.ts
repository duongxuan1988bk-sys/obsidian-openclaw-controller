import assert from "node:assert/strict";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { resolveOutputPath, resolveRawOutputPath, sanitizeFilenamePart } from "../src/utils/notePaths";
import { validateInput, validateNote } from "../src/validation";

const longContent = "x".repeat(120);

function markdownFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  const name = path.split("/").pop() ?? path;
  Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.md$/i, ""),
    extension: "md",
    stat: { ctime: 0, mtime: 0, size: 100 }
  });
  return file;
}

function folder(path: string, children: Array<TFile | TFolder>): TFolder {
  const dir = Object.create(TFolder.prototype) as TFolder;
  const name = path.split("/").pop() ?? path;
  Object.assign(dir, { path, name, children, isRoot: false });
  return dir;
}

function appWithEntries(entries: Record<string, TFile | TFolder>): App {
  return {
    vault: {
      getAbstractFileByPath(path: string) {
        return entries[path] ?? null;
      }
    }
  } as App;
}

assert.equal(
  validateInput({ workflowName: "wechat_to_raw", url: "https://mp.weixin.qq.com/s/example" }).level,
  "PASS",
  "wechat_to_raw accepts HTTP URLs"
);

assert.equal(
  validateInput({ workflowName: "wechat_to_raw", url: "notaurl" }).level,
  "FAIL",
  "wechat_to_raw rejects non-HTTP URLs"
);

assert.equal(
  validateInput({ workflowName: "markitdown_to_raw", inputPath: "docs/example.docx" }).level,
  "PASS",
  "markitdown_to_raw accepts a non-empty inputPath"
);

assert.equal(
  validateInput({ workflowName: "markitdown_to_raw", inputPath: "docs/example.pdf" }).level,
  "FAIL",
  "markitdown_to_raw rejects PDFs so pdf_to_raw remains the dedicated PDF path"
);

assert.equal(
  validateInput({ workflowName: "markitdown_to_raw" }).level,
  "FAIL",
  "markitdown_to_raw rejects missing inputPath"
);

assert.equal(
  sanitizeFilenamePart('Quarterly/Report:*? "draft"'),
  "Quarterly Report draft",
  "sanitizeFilenamePart strips reserved filename characters"
);

const outputDir = "PARA/03Resources/02Insight/AI";
const existingOutput = markdownFile(`${outputDir}/03 Frontmatter Title.md`);
const outputFolder = folder(outputDir, [
  markdownFile(`${outputDir}/01 Existing.md`),
  markdownFile(`${outputDir}/02 Existing 2.md`),
  existingOutput
]);
const outputApp = appWithEntries({
  [outputDir]: outputFolder,
  [existingOutput.path]: existingOutput
});

assert.equal(
  resolveOutputPath(
    outputApp,
    outputDir,
    `---\ntitle: "Frontmatter Title"\n---\n\n# Ignored heading\n`,
    "Source Note",
    "Insight",
    "frontmatter_title"
  ),
  `${outputDir}/03 Frontmatter Title 2.md`,
  "resolveOutputPath uses frontmatter title and appends collision suffix within the next sequence number"
);

const yearPrefixedOutputFolder = folder(outputDir, [
  markdownFile(`${outputDir}/01 Existing.md`),
  markdownFile(`${outputDir}/02 Existing 2.md`),
  markdownFile(`${outputDir}/2026 Frontmatter Title.md`)
]);
const yearPrefixedOutputApp = appWithEntries({
  [outputDir]: yearPrefixedOutputFolder
});

assert.equal(
  resolveOutputPath(
    yearPrefixedOutputApp,
    outputDir,
    `---\ntitle: "Frontmatter Title"\n---\n`,
    "Source Note",
    "Insight",
    "frontmatter_title"
  ),
  `${outputDir}/04 Frontmatter Title.md`,
  "resolveOutputPath ignores non-OpenClaw year-prefixed markdown files when matching safeBase collisions"
);

const caseVariantOutputFolder = folder(outputDir, [
  markdownFile(`${outputDir}/01 Existing.md`),
  markdownFile(`${outputDir}/02 Existing 2.md`),
  markdownFile(`${outputDir}/03 frontmatter title.md`),
  markdownFile(`${outputDir}/03 frontmatter title 2.md`)
]);
const caseVariantOutputApp = appWithEntries({
  [outputDir]: caseVariantOutputFolder
});

assert.equal(
  resolveOutputPath(
    caseVariantOutputApp,
    outputDir,
    `---\ntitle: "Frontmatter Title"\n---\n`,
    "Source Note",
    "Insight",
    "frontmatter_title"
  ),
  `${outputDir}/03 Frontmatter Title 3.md`,
  "resolveOutputPath advances collision suffix using case-insensitive directory checks"
);

const rawDir = "PARA/03Resources/01Raw/WeChat";
const existingRaw = markdownFile(`${rawDir}/02 Existing Raw.md`);
const rawFolder = folder(rawDir, [
  markdownFile(`${rawDir}/01 Older Raw.md`),
  existingRaw
]);
const rawApp = appWithEntries({
  [rawDir]: rawFolder,
  [existingRaw.path]: existingRaw
});

assert.equal(
  resolveRawOutputPath(
    rawApp,
    "03Resources/01Raw",
    `# Existing Raw\n\nBody`,
    "https://mp.weixin.qq.com/s/example",
    "source_based"
  ),
  `${rawDir}/02 Existing Raw 2.md`,
  "resolveRawOutputPath normalizes raw registry paths into PARA WeChat directories and handles same-sequence collisions"
);

const validRaw = `---
type: raw
status: new
date: 2026-04-17
tags: [raw]
source: test
domain: general
workflow: pdf_to_raw
---

# Raw

## Source

test

## Original Content

body
`;

assert.equal(validateNote(validRaw).level, "PASS", "valid raw note passes");

const insightMissingOptional = `---
type: insight
status: new
date: 2026-04-17
tags: [insight]
source: test
domain: general
workflow: raw_to_insight
---

# Insight

## Summary

summary

## Key Points

points
`;

assert.equal(validateNote(insightMissingOptional).level, "WARNING", "missing optional insight sections warns");

const invalidRaw = `---
type: raw
status: new
date: 2026-04-17
tags: [raw]
source: test
---

# Raw
`;

assert.equal(validateNote(invalidRaw).level, "FAIL", "missing raw fields and sections fails");
