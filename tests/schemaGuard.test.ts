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
assert.match(aiInsight, /^created: \d{4}-\d{2}-\d{2}$/m, "missing created is added as date-only");

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
domain: general
workflow: markitdown_to_raw
---

# Failed MarkItDown

## Original Content

[MarkItDown extraction failed]
`,
  {
    inferredType: "raw",
    activeNotePath: "PARA/03Resources/01Raw/MarkItDown/General/Failed MarkItDown.md"
  }
);

assert.match(failedRaw, /^status: failed-extract$/m, "raw schema guard preserves failed extraction status");
assert.doesNotMatch(failedRaw, /^status: raw$/m, "raw schema guard does not rewrite failed extraction to raw");
