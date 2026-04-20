import assert from "node:assert/strict";
import type { TFile } from "obsidian";
import { buildLinkableNote, scoreLinkCandidate, upsertRelatedBlock } from "../src/linking/NoteLinkOrganizer";

function file(path: string, ctime = Date.parse("2026-04-17T00:00:00")): TFile {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.md$/i, ""),
    extension: "md",
    stat: { ctime, mtime: ctime, size: 1000 },
  } as TFile;
}

const raw = buildLinkableNote(
  file("PARA/03Resources/01Raw/PDF/01 Raw.md"),
  `---
type: raw
date: 2026-04-17
tags: [raw, OCR]
source: paper.pdf
domain: biotech
workflow: pdf_to_raw
---

# Raw

## Original Content

RapidOCR scanned PDF text.
`
);

assert.equal(raw, null, "raw notes are not linkable");

const source = buildLinkableNote(
  file("PARA/03Resources/02Insight/OpenClaw/01 Scanned PDF OCR.md"),
  `---
title: Scanned PDF OCR
type: insight
date: 2026-04-17
tags: [OCR, PDF, RapidOCR]
source: paper.pdf
domain: openclaw
workflow: raw_to_insight
---

# Scanned PDF OCR

## Summary

RapidOCR restores scanned PDF text when PyMuPDF extracts almost no body content. The PDF pipeline skips full-page scan images and keeps useful rendered figures.

## Key Points

RapidOCR, scanned PDF, PyMuPDF, OCR fallback, rendered figures, Obsidian wikilinks.
`
);

const target = buildLinkableNote(
  file("PARA/03Resources/02Insight/OpenClaw/02 RapidOCR Support Added.md"),
  `---
title: RapidOCR Support Added
aliases: [RapidOCR]
type: insight
date: 2026-04-16
tags: [OCR, PDF, RapidOCR]
source: paper.pdf
domain: openclaw
workflow: raw_to_insight
---

# RapidOCR Support Added

## Summary

RapidOCR adds OCR fallback for scanned PDF pages and returns line-level text blocks. It is used when PyMuPDF text extraction is too short.

## Key Points

RapidOCR, scanned PDF, PyMuPDF, OCR fallback, line-level blocks, full-page scan image filtering.
`
);

assert.ok(source, "source insight is linkable");
assert.ok(target, "target insight is linkable");

const candidate = scoreLinkCandidate(source!, target!);
assert.ok(candidate, "strong insight candidates are scored");
assert.ok(candidate!.score >= 65, "strong insight candidates pass display threshold");
assert.ok(candidate!.reasons.some((reason) => reason.includes("标签") || reason.includes("关键词")), "candidate has explainable reasons");

const alreadyLinkedSource = buildLinkableNote(
  file("PARA/03Resources/02Insight/OpenClaw/03 Already Linked.md"),
  `---
type: insight
date: 2026-04-17
tags: [OCR, PDF, RapidOCR]
source: paper.pdf
domain: openclaw
workflow: raw_to_insight
---

# Already Linked

## Summary

RapidOCR and scanned PDF extraction are already linked to [[RapidOCR Support Added]] in this note. RapidOCR scanned PDF PyMuPDF OCR fallback.

## Key Points

RapidOCR, scanned PDF, PyMuPDF, OCR fallback, line-level blocks, full-page scan image filtering.
`
);

assert.equal(scoreLinkCandidate(alreadyLinkedSource!, target!), null, "existing wikilinks are excluded");

const sourceWithReferences = `---
type: insight
date: 2026-04-17
tags: [OCR, PDF]
domain: openclaw
workflow: raw_to_insight
---

# Scanned PDF OCR

## Summary

RapidOCR restores scanned PDF text.

## References

- paper.pdf
`;

const insertedBeforeReferences = upsertRelatedBlock(sourceWithReferences, [
  {
    sourcePath: "PARA/03Resources/02Insight/OpenClaw/01 Scanned PDF OCR.md",
    targetPath: "PARA/03Resources/02Insight/OpenClaw/02 RapidOCR Support Added.md",
    targetTitle: "RapidOCR Support Added",
    description: "共享标签：ocr"
  }
]);

assert.ok(
  insertedBeforeReferences.indexOf("<!-- openclaw-related-notes:start -->") < insertedBeforeReferences.indexOf("## References"),
  "new related notes block is inserted before trailing reference/source sections"
);

const withExistingRelatedBlock = `# Existing

<!-- openclaw-related-notes:start -->
## Related Notes

- [[PARA/03Resources/02Insight/OpenClaw/02 RapidOCR Support Added|RapidOCR Support Added]]：旧说明
<!-- openclaw-related-notes:end -->
`;

const mergedExistingBlock = upsertRelatedBlock(withExistingRelatedBlock, [
  {
    sourcePath: "PARA/03Resources/02Insight/OpenClaw/01 Scanned PDF OCR.md",
    targetPath: "PARA/03Resources/02Insight/OpenClaw/02 RapidOCR Support Added.md",
    targetTitle: "RapidOCR Support Added",
    description: "新说明"
  }
]);

assert.equal(
  [...mergedExistingBlock.matchAll(/^- \[\[/gm)].length,
  1,
  "existing related note targets are updated instead of duplicated"
);
assert.ok(!mergedExistingBlock.includes("旧说明"), "old plugin block description is replaced");
assert.ok(mergedExistingBlock.includes("新说明"), "approved description replaces existing plugin block description");
