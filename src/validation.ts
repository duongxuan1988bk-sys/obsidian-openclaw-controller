/**
 * validation.ts
 *
 * Pure validation functions for OpenClaw workflow inputs and note content.
 * No side effects: no file I/O, no Obsidian API, no UI, no logging.
 *
 * Two exported functions:
 *   - validateInput(context)  — validates a workflow invocation context
 *   - validateNote(content)  — validates a markdown note's frontmatter & sections
 */

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Result of validateInput */
export type InputValidationResult =
  | { level: "PASS"; reason: string }
  | { level: "WARNING"; reason: string }
  | { level: "FAIL"; reason: string };

/** Result of validateNote */
export type NoteValidationResult =
  | { level: "PASS"; missingFields: []; missingSections: []; message: string; parsedType?: undefined }
  | { level: "WARNING"; missingFields: string[]; missingSections: string[]; message: string; parsedType: string }
  | { level: "FAIL"; missingFields: string[]; missingSections: string[]; message: string; parsedType?: string };

/** Context passed to validateInput */
export type ValidationContext = {
  workflowName: string;
  currentNoteContent?: string;
  url?: string;
  inputPath?: string;
  topic?: string;
  domain?: string;
};

// ---------------------------------------------------------------------------
// Content size thresholds (characters)
// ---------------------------------------------------------------------------

/** Warn but allow processing for content above this size */
const CONTENT_SIZE_WARNING_THRESHOLD = 30000;
/** Reject content above this size */
const CONTENT_SIZE_ERROR_THRESHOLD = 80000;

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

type Frontmatter = Record<string, unknown>;

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns null if no frontmatter found or YAML is invalid.
 */
function parseFrontmatter(markdown: string): Frontmatter | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;

  try {
    // naive YAML parse for simple key: value pairs
    const lines = match[1].split("\n");
    const result: Frontmatter = {};

    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1).trim();

      if (!key) continue;

      // bare value (no quotes)
      if (!rawValue) {
        result[key] = "";
        continue;
      }

      // quoted string
      const doubleQuoteMatch = rawValue.match(/^"([^"]*)"$/);
      if (doubleQuoteMatch) {
        result[key] = doubleQuoteMatch[1];
        continue;
      }
      const singleQuoteMatch = rawValue.match(/^'([^']*)'$/);
      if (singleQuoteMatch) {
        result[key] = singleQuoteMatch[1];
        continue;
      }

      // array
      if (rawValue.startsWith("[")) {
        result[key] = rawValue
          .slice(1, rawValue.lastIndexOf("]"))
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        continue;
      }

      // plain value
      result[key] = rawValue.replace(/^["']|["']$/g, "");
    }

    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------

/**
 * Return true if the markdown contains a section whose heading matches
 * `heading` (case-insensitive, with or without the leading #).
 */
function hasSection(markdown: string, heading: string): boolean {
  const normalised = heading.replace(/^#+\s*/, "").toLowerCase();
  const pattern = new RegExp(`^#{1,6}\\s+${normalised.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  return pattern.test(markdown);
}

/**
 * Return the names of all top-level sections (## heading text) present in
 * the markdown, with headings normalised to lowercase.
 */
function extractSections(markdown: string): Set<string> {
  const headings = markdown.matchAll(/^#{2}\s+(.+)$/gm);
  const sections = new Set<string>();
  for (const m of headings) {
    sections.add(m[1].trim().toLowerCase());
  }
  return sections;
}

// ---------------------------------------------------------------------------
// validateInput
// ---------------------------------------------------------------------------

/**
 * Validate a workflow invocation context.
 *
 * Returns PASS when all rules for the given workflowName are satisfied,
 * FAIL with a human-readable reason otherwise.
 */
export function validateInput(context: ValidationContext): InputValidationResult {
  const { workflowName, currentNoteContent, url, inputPath, topic, domain } = context;

  // --- Global rules ---

  if (currentNoteContent === undefined && url === undefined && inputPath === undefined) {
    return { level: "FAIL", reason: "Input is required: no content, URL, or file path was provided." };
  }

  const hasContentString =
    typeof currentNoteContent === "string" && currentNoteContent.trim().length > 0;
  const hasUrlString = typeof url === "string" && url.trim().length > 0;
  const hasInputPathString = typeof inputPath === "string" && inputPath.trim().length > 0;

  if (currentNoteContent !== undefined && typeof currentNoteContent !== "string") {
    return { level: "FAIL", reason: "currentNoteContent must be a string." };
  }

  if (url !== undefined && typeof url !== "string") {
    return { level: "FAIL", reason: "url must be a string." };
  }

  if (inputPath !== undefined && typeof inputPath !== "string") {
    return { level: "FAIL", reason: "inputPath must be a string." };
  }

  // --- Workflow-specific rules ---

  switch (workflowName) {
    case "wechat_to_raw": {
      if (!hasUrlString) {
        return { level: "FAIL", reason: "wechat_to_raw requires a url field." };
      }
      if (!url!.toLowerCase().startsWith("http")) {
        return { level: "FAIL", reason: "wechat_to_raw url must start with http." };
      }
      return { level: "PASS", reason: "Input is valid for wechat_to_raw." };
    }

    case "markitdown_to_raw": {
      if (!hasInputPathString) {
        return { level: "FAIL", reason: "markitdown_to_raw requires an inputPath field." };
      }
      if (/\.pdf$/i.test(inputPath!)) {
        return { level: "FAIL", reason: "markitdown_to_raw does not accept PDF files. Use pdf_to_raw for PDFs." };
      }
      return { level: "PASS", reason: "Input is valid for markitdown_to_raw." };
    }

    case "raw_to_insight": {
      if (!hasContentString) {
        return { level: "FAIL", reason: "raw_to_insight requires a non-empty currentNoteContent." };
      }
      const charCount = currentNoteContent!.length;
      if (charCount > CONTENT_SIZE_ERROR_THRESHOLD) {
        return {
          level: "FAIL",
          reason: `Content is very large (${charCount} characters). Please split into smaller Raw notes before converting to Insight.`
        };
      }
      if (charCount > CONTENT_SIZE_WARNING_THRESHOLD) {
        return {
          level: "WARNING",
          reason: `Content is large (${charCount} characters). Processing may take longer than usual.`
        };
      }
      return { level: "PASS", reason: "Input is valid for raw_to_insight." };
    }

    case "raw_to_translated": {
      if (!hasContentString) {
        return { level: "FAIL", reason: "raw_to_translated requires a non-empty currentNoteContent." };
      }
      const charCount = currentNoteContent!.length;
      if (charCount > CONTENT_SIZE_ERROR_THRESHOLD) {
        return {
          level: "FAIL",
          reason: `Content is very large (${charCount} characters). Please split into smaller notes before translating.`
        };
      }
      if (charCount > CONTENT_SIZE_WARNING_THRESHOLD) {
        return {
          level: "WARNING",
          reason: `Content is large (${charCount} characters). Translation may take longer than usual.`
        };
      }
      return { level: "PASS", reason: "Input is valid for raw_to_translated." };
    }

    case "note_to_theory": {
      if (!hasContentString) {
        return { level: "FAIL", reason: "note_to_theory requires a non-empty currentNoteContent." };
      }
      if ((currentNoteContent?.length ?? 0) <= 100) {
        return {
          level: "FAIL",
          reason: "note_to_theory currentNoteContent must be longer than 100 characters."
        };
      }
      // Biotech theory requires topic; openclaw/ai theory use domain_mapping and don't need topic
      if (!topic && (!domain || domain === "biotech")) {
        return { level: "FAIL", reason: "note_to_theory requires a topic." };
      }
      return { level: "PASS", reason: "Input is valid for note_to_theory." };
    }

    case "note_to_case": {
      if (!hasContentString) {
        return { level: "FAIL", reason: "note_to_case requires a non-empty currentNoteContent." };
      }
      // Biotech case requires topic; openclaw/ai case use domain_mapping and don't need topic
      if (!topic && (!domain || domain === "biotech")) {
        return { level: "FAIL", reason: "note_to_case requires a topic." };
      }
      return { level: "PASS", reason: "Input is valid for note_to_case." };
    }

    case "note_to_method": {
      if (!hasContentString) {
        return { level: "FAIL", reason: "note_to_method requires a non-empty currentNoteContent." };
      }
      if (!topic) {
        return { level: "FAIL", reason: "note_to_method requires a topic." };
      }
      return { level: "PASS", reason: "Input is valid for note_to_method." };
    }

    case "rewrite_current_note": {
      if (!hasContentString) {
        return { level: "FAIL", reason: "rewrite_current_note requires a non-empty currentNoteContent." };
      }
      return { level: "PASS", reason: "Input is valid for rewrite_current_note." };
    }

    case "fix_frontmatter": {
      if (!hasContentString) {
        return { level: "FAIL", reason: "fix_frontmatter requires a non-empty currentNoteContent." };
      }
      return { level: "PASS", reason: "Input is valid for fix_frontmatter." };
    }

    case "note_to_doc":
    case "note_to_debug":
    case "note_to_system":
    case "note_to_case_by_domain": {
      if (!hasContentString) {
        return { level: "FAIL", reason: `${workflowName} requires a non-empty currentNoteContent.` };
      }
      if (!domain) {
        return { level: "FAIL", reason: `${workflowName} requires a domain (openclaw or ai).` };
      }
      return { level: "PASS", reason: `Input is valid for ${workflowName}.` };
    }

    default:
      return { level: "FAIL", reason: `Unknown workflowName: "${workflowName}".` };
  }
}

// ---------------------------------------------------------------------------
// Known note types
// ---------------------------------------------------------------------------

type NoteType = "raw" | "insight" | "theory" | "case" | "method";

const NOTE_TYPES: readonly NoteType[] = ["raw", "insight", "theory", "case", "method"];

function isKnownNoteType(value: string): value is NoteType {
  return NOTE_TYPES.includes(value as NoteType);
}

// ---------------------------------------------------------------------------
// Required field definitions per note type
// ---------------------------------------------------------------------------

/** Fields required in frontmatter for each note type. */
const REQUIRED_FIELDS: Record<NoteType, readonly string[]> = {
  raw: ["type", "status", "date", "tags", "source", "domain", "workflow"],
  insight: ["type", "status", "date", "tags", "source", "domain", "workflow"],
  theory: ["type", "status", "date", "tags", "source", "domain", "workflow", "topic"],
  case: ["type", "status", "date", "tags", "source", "domain", "workflow", "topic", "problem_type"],
  method: ["type", "status", "date", "tags", "source", "domain", "workflow", "topic", "method_family"],
};

/** Section headings required (or warned) per note type. */
const REQUIRED_SECTIONS: Record<NoteType, { required: readonly string[]; warned: readonly string[] }> = {
  raw: {
    required: ["source", "original content"],
    warned: [],
  },
  insight: {
    required: ["summary", "key points"],
    warned: ["experimental relevance", "potential directions", "related notes"],
  },
  theory: {
    required: ["core principle", "analytical meaning"],
    warned: ["common pitfalls", "related notes"],
  },
  case: {
    required: ["root cause", "solution"],
    warned: ["reusable lessons", "related notes"],
  },
  method: {
    required: ["purpose", "scope", "workflow", "key parameters"],
    warned: ["principle", "acceptance criteria", "troubleshooting", "related notes"],
  },
};

// ---------------------------------------------------------------------------
// validateNote
// ---------------------------------------------------------------------------

/**
 * Validate a markdown note's frontmatter and section structure.
 *
 * Returns a NoteValidationResult:
 *   - PASS   — note is fully conformant
 *   - WARNING — note has optional sections missing (no hard failures)
 *   - FAIL   — one or more required fields or sections are missing
 */
export function validateNote(noteContent: string): NoteValidationResult {
  const missingFields: string[] = [];
  const missingSections: string[] = [];

  // --- YAML parse ---
  const fm = parseFrontmatter(noteContent);

  if (fm === null) {
    return {
      level: "FAIL",
      missingFields: [],
      missingSections: [],
      message: "Could not parse frontmatter: no YAML block found or YAML is malformed.",
    };
  }

  // --- type check ---
  const rawType = fm["type"];
  if (rawType === undefined || rawType === null || String(rawType).trim() === "") {
    return {
      level: "FAIL",
      missingFields: ["type"],
      missingSections: [],
      message: "Frontmatter is missing the required 'type' field.",
    };
  }

  const typeString = String(rawType).trim().toLowerCase();

  if (!isKnownNoteType(typeString)) {
    return {
      level: "FAIL",
      missingFields: ["type"],
      missingSections: [],
      message: `Unknown note type "${typeString}". Expected one of: ${NOTE_TYPES.join(", ")}.`,
    };
  }

  const noteType = typeString as NoteType;

  // --- Field validation ---
  const requiredFields = REQUIRED_FIELDS[noteType];
  for (const field of requiredFields) {
    const value = fm[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      missingFields.push(field);
    }
  }

  // --- Section validation ---
  const sections = extractSections(noteContent);
  const { required: requiredSections, warned: warnedSections } = REQUIRED_SECTIONS[noteType];

  for (const heading of requiredSections) {
    if (!hasSection(noteContent, heading)) {
      missingSections.push(heading);
    }
  }

  // --- Determine level ---
  if (missingFields.length > 0 || missingSections.length > 0) {
    const msgs: string[] = [];
    if (missingFields.length > 0) {
      msgs.push(`Missing frontmatter fields: ${missingFields.join(", ")}.`);
    }
    if (missingSections.length > 0) {
      msgs.push(`Missing required sections: ${missingSections.join(", ")}.`);
    }
    return {
      level: "FAIL",
      missingFields,
      missingSections,
      message: msgs.join(" "),
      parsedType: noteType,
    };
  }

  // No hard failures — check warnings
  const warnedMissing: string[] = [];
  for (const heading of warnedSections) {
    if (!hasSection(noteContent, heading)) {
      warnedMissing.push(heading);
    }
  }

  if (warnedMissing.length > 0) {
    return {
      level: "WARNING",
      missingFields: [],
      missingSections: warnedMissing,
      message: `Optional sections are missing: ${warnedMissing.join(", ")}.`,
      parsedType: noteType,
    };
  }

  return {
    level: "PASS",
    missingFields: [],
    missingSections: [],
    message: `Note is valid (type: ${noteType}).`,
  };
}
