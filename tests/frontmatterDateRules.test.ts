import assert from "node:assert/strict";
import { FIX_FRONTMATTER_DATE_RULES } from "../src/registry/frontmatterDateRules";

assert.ok(
  FIX_FRONTMATTER_DATE_RULES.includes("If created is missing and date exists, set created equal to date."),
  "Fix Schema date rules copy date into missing created"
);

assert.ok(
  FIX_FRONTMATTER_DATE_RULES.includes("Do not include a time component in date or created."),
  "Fix Schema date rules require date-only fields"
);
