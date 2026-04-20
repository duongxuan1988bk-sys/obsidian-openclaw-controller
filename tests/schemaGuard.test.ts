import assert from "node:assert/strict";
import { ensureSchemaFrontmatter } from "../src/schema/SchemaGuard";

const aiInsight = ensureSchemaFrontmatter(
  `---
title: AI Raw Insight
domain: ai
tags: [raw, ai]
---

# AI Raw Insight

## Summary

AI workflow notes.
`,
  {
    inferredType: "insight",
    activeNotePath: "PARA/03Resources/02Insight/AI/01 AI Raw Insight.md"
  }
);

assert.match(aiInsight, /^domain: ai$/m, "AI insight keeps AI domain");
assert.doesNotMatch(aiInsight, /^domain: biotech$/m, "AI insight is not rewritten to biotech");
assert.doesNotMatch(aiInsight, /^topic:/m, "non-biotech insight does not receive topic");
assert.match(aiInsight, /^created: \d{4}-\d{2}-\d{2}$/m, "missing created is added as date-only");

const openclawTheory = ensureSchemaFrontmatter(
  `---
title: OpenClaw Theory
domain: openclaw
topic: N_Glycan
tags: [theory, openclaw]
---

# OpenClaw Theory

## Core Principle

OpenClaw architecture notes.
`,
  {
    inferredType: "theory",
    activeNotePath: "PARA/01Projects/02Openclaw/01Theory/OpenClaw Theory.md"
  }
);

assert.match(openclawTheory, /^domain: openclaw$/m, "OpenClaw theory keeps OpenClaw domain");
assert.doesNotMatch(openclawTheory, /^topic:/m, "non-biotech theory does not keep biotech topic");

const biotechTheory = ensureSchemaFrontmatter(
  `---
title: Biotech Theory
tags: [theory]
---

# Biotech Theory

## Core Principle

Biotech SEC notes.
`,
  {
    inferredType: "theory",
    theoryTopic: "SEC",
    activeNotePath: "PARA/03Resources/03Domains/01Biotech/SEC/01Theory/Biotech Theory.md"
  }
);

assert.match(biotechTheory, /^domain: biotech$/m, "Biotech theory infers biotech domain");
assert.match(biotechTheory, /^topic: SEC$/m, "Biotech theory keeps selected topic");

const createdFromDate = ensureSchemaFrontmatter(
  `---
title: Created From Date
date: 2026-04-01
tags: [ai]
---

# Created From Date
`,
  {
    inferredType: "insight",
    activeNotePath: "PARA/03Resources/02Insight/AI/Created From Date.md"
  }
);

assert.match(createdFromDate, /^date: 2026-04-01$/m, "date is preserved");
assert.match(createdFromDate, /^created: 2026-04-01$/m, "missing created follows date");

const createdTimeTrimmed = ensureSchemaFrontmatter(
  `---
title: Created Time Trimmed
date: 2026-04-01
created: 2026-04-01 19:30:12
tags: [ai]
---

# Created Time Trimmed
`,
  {
    inferredType: "insight",
    activeNotePath: "PARA/03Resources/02Insight/AI/Created Time Trimmed.md"
  }
);

assert.match(createdTimeTrimmed, /^created: 2026-04-01$/m, "created time component is removed");

const failedRaw = ensureSchemaFrontmatter(
  `---
title: Failed MarkItDown
date: 2026-04-19
source: failed.docx
tags: [raw, markitdown]
type: raw
status: failed-extract
domain: biotech
workflow: markitdown_to_raw
---

# Failed MarkItDown

## Original Content

[MarkItDown extraction failed]
`,
  {
    inferredType: "raw",
    activeNotePath: "PARA/03Resources/01Raw/MarkItDown/Biotech/Failed MarkItDown.md"
  }
);

assert.match(failedRaw, /^status: failed-extract$/m, "raw schema guard preserves failed extraction status");
assert.doesNotMatch(failedRaw, /^status: raw$/m, "raw schema guard does not rewrite failed extraction to raw");
