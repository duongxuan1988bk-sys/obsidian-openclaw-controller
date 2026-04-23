import assert from "node:assert/strict";
import {
  ensureMarkItDownRawMarkdown,
  resolveMarkItDownRawTargetDir
} from "../src/workflows/markItDownRaw";
import { validateNote } from "../src/validation";

const converted = ensureMarkItDownRawMarkdown(
  `# Quarterly Report

Revenue and operating notes extracted from a DOCX file.
`,
  "Imports/Quarterly Report.docx",
  "ai"
);

assert.equal(validateNote(converted).level, "PASS", "plain MarkItDown output becomes a valid raw note");
assert.match(converted, /^title: "Quarterly Report"$/m, "source filename is used as the raw note title");
assert.match(converted, /^type: raw$/m, "raw type is injected");
assert.match(converted, /^status: draft$/m, "draft status is injected for successful extraction");
assert.match(converted, /^domain: ai$/m, "selected domain is injected");
assert.match(converted, /^workflow: markitdown_to_raw$/m, "MarkItDown workflow is injected");
assert.match(converted, /^source: "Imports\/Quarterly Report\.docx"$/m, "source path is injected as a YAML string");
assert.match(converted, /^tags: \[raw, markitdown\]$/m, "raw MarkItDown tags are injected");
assert.match(converted, /^## Source$/m, "Source section is present");
assert.match(converted, /^## Original Content$/m, "Original Content section is present");
assert.ok(converted.includes("Revenue and operating notes"), "extracted body is preserved under the raw note");

const titleFromFilename = ensureMarkItDownRawMarkdown(
  `# Internal Heading From Document

Body extracted from Word.
`,
  "Imports/PRO-F-054 V01 ADC药物中DMA残留检测方法.docx",
  "general"
);

assert.match(
  titleFromFilename,
  /^title: "PRO-F-054 V01 ADC药物中DMA残留检测方法"$/m,
  "Word imports use the source filename instead of the first markdown heading"
);
assert.match(
  titleFromFilename,
  /^# PRO-F-054 V01 ADC药物中DMA残留检测方法$/m,
  "generated raw note heading uses the source filename"
);
assert.ok(
  titleFromFilename.includes("# Internal Heading From Document"),
  "original MarkItDown heading is preserved inside Original Content"
);

const failed = ensureMarkItDownRawMarkdown(
  `---
title: Broken Import
date: 2026-04-19
source: Imports/Broken.docx
tags: [raw, markitdown]
type: raw
status: failed-extract
---

# Broken Import

## Original Content

  [MarkItDown extraction failed: command not found]
`,
  "Imports/Broken.docx",
  "general"
);

assert.equal(validateNote(failed).level, "PASS", "failed MarkItDown extraction note remains a valid raw note");
assert.match(failed, /^status: failed-extract$/m, "failed extraction status is preserved");
assert.doesNotMatch(failed, /^status: draft$/m, "failed extraction is not rewritten to draft");
assert.match(failed, /^domain: general$/m, "failed extraction receives selected domain");
assert.match(failed, /^workflow: markitdown_to_raw$/m, "failed extraction receives workflow");

assert.equal(
  resolveMarkItDownRawTargetDir("ai"),
  "PARA/03Resources/01Raw/MarkItDown/AI",
  "AI MarkItDown raw output uses existing vault folder casing"
);
assert.equal(
  resolveMarkItDownRawTargetDir("openclaw"),
  "PARA/03Resources/01Raw/MarkItDown/OpenClaw",
  "OpenClaw MarkItDown raw output uses existing vault folder casing"
);
assert.equal(
  resolveMarkItDownRawTargetDir("general"),
  "PARA/03Resources/01Raw/MarkItDown/General",
  "General MarkItDown raw output uses the generic folder"
);
