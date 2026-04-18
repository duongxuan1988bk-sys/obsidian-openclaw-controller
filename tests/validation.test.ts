import assert from "node:assert/strict";
import { validateInput, validateNote } from "../src/validation";

const longContent = "x".repeat(120);

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
  validateInput({ workflowName: "note_to_theory", currentNoteContent: longContent, domain: "openclaw" }).level,
  "PASS",
  "openclaw theory can use domain_mapping without topic"
);

assert.equal(
  validateInput({ workflowName: "note_to_theory", currentNoteContent: longContent, domain: "biotech" }).level,
  "FAIL",
  "biotech theory still requires topic"
);

assert.equal(
  validateInput({ workflowName: "note_to_doc", currentNoteContent: longContent, domain: "ai" }).level,
  "PASS",
  "doc workflows require content and domain"
);

assert.equal(
  validateInput({ workflowName: "note_to_case_by_domain", currentNoteContent: longContent }).level,
  "FAIL",
  "domain case workflow rejects missing domain"
);

const validRaw = `---
type: raw
status: new
date: 2026-04-17
tags: [raw]
source: test
domain: biotech
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
domain: biotech
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
