import assert from "node:assert/strict";
import { promoteToOriginalContent } from "../src/workflows/WorkflowExecutor";

function hasRootLevelHeading(markdown: string, heading: string): boolean {
  const pattern = new RegExp(`^#{2}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  return pattern.test(markdown);
}

function hasSourceSection(markdown: string): boolean {
  return /^##\s+Source\s*$/m.test(markdown);
}

function hasOriginalContentSection(markdown: string): boolean {
  return /^##\s+Original\s+Content\s*$/m.test(markdown);
}

{
  // Basic case: frontmatter + root headings -> demoted to ###/####
  const input = `---
title: Test
type: raw
---

# Title

## Abstract

Some content

## References
`;

  const result = promoteToOriginalContent(input);

  assert.ok(hasOriginalContentSection(result), "should have ## Original Content");
  assert.ok(!hasSourceSection(result), "## Source is NOT added by promoteToOriginalContent");
  // Demoted: # Title -> ### Title, ## Abstract -> #### Abstract
  assert.ok(!hasRootLevelHeading(result, "Abstract"), "## Abstract should be demoted (not root level)");
  assert.ok(!hasRootLevelHeading(result, "References"), "## References should be demoted (not root level)");
  // Positive assertions: verify the demoted forms actually exist
  assert.match(result, /^### Title$/m, "### Title should exist (demoted from # Title)");
  assert.match(result, /^#### Abstract$/m, "#### Abstract should exist (demoted from ## Abstract)");
  assert.match(result, /^#### References$/m, "#### References should exist (demoted from ## References)");
  console.log("  ✓ basic case: root headings demoted to ###/####");
}

{
  // Indented headings should also be demoted with indent preserved
  const input = `---
title: Test
---

   ## Indented Heading

Some content
`;

  const result = promoteToOriginalContent(input);

  assert.ok(!hasRootLevelHeading(result, "Indented Heading"), "indented ## should be demoted (not root level)");
  // The indented heading should be demoted to #### and remain indented
  // We verify it's inside Original Content and not at root level
  assert.ok(hasOriginalContentSection(result), "should have ## Original Content");
  // The demoted form should contain #### (not ##) and be inside Original Content
  assert.ok(result.includes("#### Indented Heading"), "#### Indented Heading should appear (demoted from ##)");
  console.log("  ✓ indented headings demoted");
}

{
  // ``` fenced code block: headings inside should NOT be demoted
  const input = `---
title: Test
---

## Introduction

\`\`\`md
## Example

Some code
\`\`\`

## Conclusion
`;

  const result = promoteToOriginalContent(input);

  // Root headings should be demoted
  assert.ok(!hasRootLevelHeading(result, "Introduction"), "## Introduction should be demoted");
  assert.ok(!hasRootLevelHeading(result, "Conclusion"), "## Conclusion should be demoted");
  // Positive: demoted forms should exist
  assert.match(result, /^#### Introduction$/m, "#### Introduction should exist");
  assert.match(result, /^#### Conclusion$/m, "#### Conclusion should exist");
  // Code block content should be UNCHANGED: ## Example stays ## Example
  assert.match(result, /\`\`\`md\n## Example\n\nSome code\n\`\`\`/,
    "## Example inside ``` fence should remain unchanged (not demoted)");
  console.log("  ✓ ``` fenced code block content preserved unchanged");
}

{
  // ~~~ fenced code blocks also preserved
  const input = `---
title: Test
---

## Methods

~~~python
## setup
def init():
    pass
~~~

## Results
`;

  const result = promoteToOriginalContent(input);

  assert.ok(!hasRootLevelHeading(result, "Methods"), "## Methods should be demoted");
  assert.ok(!hasRootLevelHeading(result, "Results"), "## Results should be demoted");
  // Code block content should be UNCHANGED
  assert.match(result, /~~~python\n## setup\ndef init\(\):\n    pass\n~~~/,
    "## setup inside ~~~ fence should remain unchanged");
  console.log("  ✓ ~~~ fenced code block content preserved unchanged");
}

{
  // Mixed fence types: opening ``` should close with ```, not ~~~
  // Key behavior: ~~~ inside ``` block should NOT close the fence
  const input = `---
title: Test
---

## Intro

\`\`\`js
// code
~~~

// more code
\`\`\`

## Outro
`;

  const result = promoteToOriginalContent(input);

  assert.ok(hasOriginalContentSection(result), "should have ## Original Content");
  // ~~~ inside ``` block should be treated as plain text, not a fence closer
  // Key: ~~~ inside ``` fence should NOT close the fence (different marker)
  // After ~~~ the fence stays open until the matching ``` appears
  // So // more code appears AFTER ~~~ but BEFORE the closing ```
  assert.ok(result.includes("```js\n// code\n~~~\n\n// more code\n```"),
    "~~~ inside ``` fence should not close it; // more code appears before closing ```");
  // ## Outro (after closing ```) should be demoted since it's outside the fence
  assert.ok(!hasRootLevelHeading(result, "Outro"), "## Outro should be demoted");
  assert.match(result, /^#### Outro$/m, "#### Outro should exist");
  // ## Outro should be demoted (outside the fence)
  assert.ok(!hasRootLevelHeading(result, "Outro"), "## Outro should be demoted");
  assert.match(result, /^#### Outro$/m, "#### Outro should exist");
  console.log("  ✓ mixed fence types: ~~~ inside ``` preserved, fence correctly stays open");
}

{
  // No frontmatter fallback: wraps entire body without demotion
  // NOTE: this is a fallback path only — production always has frontmatter from upsertFrontmatterString
  const input = `## Abstract

Some content

## References
`;

  const result = promoteToOriginalContent(input);

  // promoteToOriginalContent does NOT add ## Source or demote in this fallback path
  assert.ok(hasOriginalContentSection(result), "should have ## Original Content");
  assert.ok(!hasSourceSection(result), "## Source is NOT added by promoteToOriginalContent");
  // Fallback behavior: headings remain as ## (not demoted) — this path is NOT for production use
  assert.ok(hasRootLevelHeading(result, "Abstract"), "## Abstract preserved in no-frontmatter fallback");
  console.log("  ✓ no frontmatter fallback (not production-normalized path)");
}

console.log("All promoteToOriginalContent tests passed.");
