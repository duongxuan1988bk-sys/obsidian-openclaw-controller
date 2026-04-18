/**
 * planner.ts
 *
 * Natural-language workflow planner v4 (P0: Slot Filling + P1: Active Note Context).
 *
 * Resolves natural language user commands into structured workflow plans without
 * calling any LLM. Uses layered matching:
 *   1. Exact keyword substring match (v2 behavior, preserved)
 *   2. Phrase-pattern regex match (catches natural phrasing)
 *   3. Token-overlap fuzzy match (handles typos, synonyms, partial words)
 *
 * For raw_to_insight, automatically infers domain from note content when possible.
 *
 * Intents supported:
 *   - convert current note → insight / theory / case / doc / debug / system
 *   - rewrite current note
 *   - fix current note frontmatter
 */

import { type TheoryTopic, type CaseTopic, type MethodTopic, type TheoryDomain } from "./registry/insightRegistry";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type InsightDomain = "biotech" | "openclaw" | "ai" | "general";

export type DomainInferenceResult = {
  domain?: InsightDomain;
  confidence: number;        // 0.0 – 1.0
  matchedKeywords: string[];
};

// High-confidence threshold: domain is attached to plan if confidence >= this
const DOMAIN_HIGH_CONFIDENCE = 0.6;

// Low-confidence threshold: domain inference is attempted but may fail
const DOMAIN_LOW_CONFIDENCE = 0.3;

// ---------------------------------------------------------------------------
// Synonym map — expands words into canonical forms
// ---------------------------------------------------------------------------

const SYNONYMS: Record<string, string> = {
  // English → canonical
  "insight": "insight",
  "note": "note",
  "theory": "theory",
  "theories": "theory",
  "theoretical": "theory",
  "case": "case",
  "cases": "case",
  "method": "method",
  "methods": "method",
  "protocol": "method",
  "incident": "case",
  "doc": "doc",
  "docs": "doc",
  "document": "doc",
  "documentation": "doc",
  "debug": "debug",
  "debugging": "debug",
  "troubleshoot": "debug",
  "troubleshooting": "debug",
  "system": "system",
  "rewrite": "rewrite",
  "rewriting": "rewrite",
  "rewrite_current_note": "rewrite",
  "fix": "fix",
  "fix_schema": "fix",
  "fix_frontmatter": "fix",
  "frontmatter": "frontmatter",
  "schema": "schema",
  "convert": "convert",
  "converting": "convert",
  "conversion": "convert",
  "convert_to": "convert",
  "turn": "convert",
  "turn_into": "convert",
  "transform": "convert",
  "transform_to": "convert",
  "change_to": "convert",
  "changing_to": "convert",
  // Chinese → canonical
  "转化": "convert",
  "转成": "convert",
  "转换": "convert",
  "转为": "convert",
  "转化成": "convert",
  "转化为": "convert",
  "理论": "theory",
  "案例": "case",
  "方法": "method",
  "文档": "doc",
  "文件": "doc",
  "调试": "debug",
  "排错": "debug",
  "系统": "system",
  "重写": "rewrite",
  "修复": "fix",
  "修补": "fix",
  "元数据": "frontmatter",
  "笔记": "note",
  "把这篇": "this_note",
  "这篇": "this_note",
  "这个": "this_note",
  "帮我": "please",
  "请": "please",
  "能不能": "please",
  "能不能帮我": "please",
  // Domain synonyms
  "biotech": "biotech",
  "openclaw": "openclaw",
  "open claw": "openclaw",
  "ai": "ai",
  "llm": "ai",
  "general": "general",
  "通用": "general",
};

// ---------------------------------------------------------------------------
// Phrase patterns — regex-based patterns for natural phrasing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Topic canonical normalization
// ---------------------------------------------------------------------------

const TOPIC_NORMALIZATION: Record<string, TheoryTopic | CaseTopic | MethodTopic> = {
  "sec": "SEC",
  "cex": "CEX",
  "n_glycan": "N_Glycan",
  "n-glycan": "N_Glycan",
  "nglycan": "N_Glycan",
  "n glycosylation": "N_Glycan",
  "papers": "Papers",
  "paper": "Papers",
  "antibody": "Antibody",
  "uncategorized": "Uncategorized",
};

// ---------------------------------------------------------------------------
// Target word → workflow mapping (used by multi-slot pattern resolution)
// ---------------------------------------------------------------------------

const WORD_TO_WORKFLOW: Record<string, RunnableWorkflowName> = {
  "theory": "note_to_theory",
  "theories": "note_to_theory",
  "理论": "note_to_theory",
  "case": "note_to_case",
  "案例": "note_to_case",
  "method": "note_to_method",
  "methods": "note_to_method",
  "protocol": "note_to_method",
  "方法": "note_to_method",
  "doc": "note_to_doc",
  "docs": "note_to_doc",
  "document": "note_to_doc",
  "文档": "note_to_doc",
  "debug": "note_to_debug",
  "调试": "note_to_debug",
  "system": "note_to_system",
  "系统": "note_to_system",
  "insight": "raw_to_insight",
};

// ---------------------------------------------------------------------------
// Phrase patterns — regex-based patterns for natural phrasing
// ---------------------------------------------------------------------------

type PhrasePattern = {
  regex: RegExp;
  workflow: RunnableWorkflowName;
  /** Capture group 1 = topic (SEC/CEX/N_Glycan/Papers) */
  capturesTopic?: boolean;
  /** Capture group 1 = domain (openclaw/ai) */
  capturesDomain?: boolean;
  /** Index of capture group that contains the target word (case/doc/debug/system/insight/theory) */
  targetCaptureIndex?: number;
};

const PHRASE_PATTERNS: PhrasePattern[] = [
  // ── Multi-slot: topic explicit → target conversion ──
  // "帮我把 SEC theory 转成 case" → topic=SEC, target=case → note_to_case
  { regex: /帮我把\s*(SEC|CEX|N_Glycan|Papers|Antibody|UNCATEGORIZED)\s*(?:theory|案例|理论)\s*转成\s*(case|doc|debug|system|insight)/i, workflow: "note_to_case", capturesTopic: true, targetCaptureIndex: 2 },
  // "SEC theory to case"
  { regex: /(SEC|CEX|N_Glycan|Papers|Antibody)\s+theory\s+to\s+(case|doc|debug|system|insight)/i, workflow: "note_to_case", capturesTopic: true, targetCaptureIndex: 2 },
  // "帮我把 SEC 转成 case" → topic=SEC, target=case → note_to_case
  { regex: /帮我把\s*(SEC|CEX|N_Glycan|Papers|Antibody|UNCATEGORIZED)\s*转成\s*(case|doc|debug|system|insight)/i, workflow: "note_to_case", capturesTopic: true, targetCaptureIndex: 2 },
  // "SEC to case" / "SEC 转成 case"
  { regex: /^(SEC|CEX|N_Glycan|Papers|Antibody)\s*转成\s*(case|doc|debug|system|insight)$/i, workflow: "note_to_case", capturesTopic: true, targetCaptureIndex: 2 },

  // ── Multi-slot: domain explicit → target conversion ──
  // "帮我把 openclaw theory 转成 case" → domain=openclaw, target=case → note_to_case_by_domain
  { regex: /帮我把\s*(openclaw|ai)\s*(?:theory|案例|理论)\s*转成\s*(case|doc|debug|system)/i, workflow: "note_to_case_by_domain", capturesDomain: true, targetCaptureIndex: 2 },
  // "openclaw theory to case"
  { regex: /(openclaw|ai)\s+theory\s+to\s+(case|doc|debug|system)/i, workflow: "note_to_case_by_domain", capturesDomain: true, targetCaptureIndex: 2 },
  // "帮我把 openclaw 转成 case"
  { regex: /帮我把\s*(openclaw|ai)\s*转成\s*(case|doc|debug|system)/i, workflow: "note_to_case_by_domain", capturesDomain: true, targetCaptureIndex: 2 },
  // "openclaw to case"
  { regex: /^(openclaw|ai)\s*转成\s*(case|doc|debug|system)$/i, workflow: "note_to_case_by_domain", capturesDomain: true, targetCaptureIndex: 2 },

  // ── Topic → single target (no explicit "转成 target") ──
  // "帮我把这个转成 SEC theory" → topic=SEC, target implicit by workflow
  { regex: /帮我把?(?:这个|这篇|一个|)\s*转成?\s*(SEC|CEX|N_Glycan|Papers|Antibody|UNCATEGORIZED)\s*(?:theory|案例|理论)/i, workflow: "note_to_theory", capturesTopic: true },
  // "convert to SEC theory"
  { regex: /(?:convert to|转成|转化成|变为)\s*(SEC|CEX|N_Glycan|Papers|Antibody)\s*(?:theory|案例|理论)/i, workflow: "note_to_theory", capturesTopic: true },
  // "SEC case" / "SEC theory" standalone
  { regex: /^(SEC|CEX|N_Glycan|Papers|Antibody)\s*(theory|case)$/i, workflow: "note_to_theory", capturesTopic: true },

  // ── Domain → single target ──
  // "openclaw theory" / "ai theory"
  { regex: /^(openclaw|ai)\s+(theory|case|doc|debug|system)$/i, workflow: "note_to_theory", capturesDomain: true },

  // ── Generic single-slot (target word captured, normalized to topic/domain) ──
  // "帮我把这个转成 insight"
  { regex: /帮我把?(?:这个|这篇|一个|)\s*转成?\s*([a-z]+)/i, workflow: "raw_to_insight" },
  // "turn this into a doc"
  { regex: /turn this (?:note |)into(?: a |)([a-z]+)/i, workflow: "raw_to_insight" },
  // "convert this note to theory"
  { regex: /convert this (?:note |)to(?: a |)([a-z]+)/i, workflow: "note_to_theory" },
  // "i want to debug this"
  { regex: /i want to ([a-z]+) this/i, workflow: "note_to_debug", capturesDomain: true },
  // "make this a debug case"
  { regex: /make this (?:note |)a ([a-z]+)(?: case|)/i, workflow: "note_to_debug", capturesDomain: true },
  // "记录一下这个 case"
  { regex: /(?:帮我|)记(?:录|)一下(?:这个|)(?: |)([a-z]+)/i, workflow: "raw_to_insight" },
  // "fix the frontmatter of this note"
  { regex: /fix (?:the |)(?:frontmatter|schema) (?:of |of this |)(?:note |)/i, workflow: "fix_frontmatter" },
  // "帮我修复一下 frontmatter"
  { regex: /(?:帮我|)修复一下?(?:这个|)(?:笔记|)(?: |)(?:frontmatter|schema|元数据|)/i, workflow: "fix_frontmatter" },
  // "帮我重写一下"
  { regex: /(?:帮我|)重写一下?(?:这个|)(?:笔记|)/i, workflow: "rewrite_current_note" },
  // "rewrite this note for me"
  { regex: /rewrite (?:this |)(?:note |)for me/i, workflow: "rewrite_current_note" },
  // "帮我把这个变成 theory"
  { regex: /帮我把?(?:这个|这篇|)\s*变成?\s*([a-z]+)/i, workflow: "note_to_theory" },
  // "转成 system 文档"
  { regex: /转成(?: |)([a-z]+)(?:文档|)/i, workflow: "note_to_doc", capturesDomain: true },
  // "debug this issue"
  { regex: /debug(?:ging|) this (?:note|issue|problem)/i, workflow: "note_to_debug", capturesDomain: true },
  // "this is a debug case"
  { regex: /this is (?:a |)([a-z]+) case/i, workflow: "note_to_case_by_domain", capturesDomain: true },
  // "i need to document this"
  { regex: /i need to ([a-z]+) this/i, workflow: "note_to_doc", capturesDomain: true },
  // "帮我把这个问题转成 case"
  { regex: /(?:帮我|)把这个(?:问题|笔记|)\s*转成?\s*([a-z]+)/i, workflow: "note_to_case_by_domain" },
  // "转成 theory"
  { regex: /^转成([a-z]+)$/i, workflow: "note_to_theory" },
  // "转成 case" (standalone)
  { regex: /^转成([a-z]+)$/i, workflow: "note_to_case_by_domain" },
];

// ---------------------------------------------------------------------------
// Fuzzy token scorer
// ---------------------------------------------------------------------------

/**
 * Tokenize input: split on whitespace/punctuation, lowercase, filter empty.
 * Applies synonym expansion so each token maps to its canonical form.
 */
function tokenize(input: string): string[] {
  const tokens = input
    .toLowerCase()
    .split(/[\s\-_\/.,!?;:()（）【】""''""'']+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Expand each token through synonym map (one level only)
  return tokens.map((t) => SYNONYMS[t] ?? t);
}

/**
 * Compute overlap score between user tokens and keyword tokens.
 * Score = (matched_unique_keywords / total_keywords) * (matched_user_tokens / total_user_tokens)
 * This penalizes keywords that are too short or too broad.
 */
function tokenOverlapScore(userTokens: string[], keywordTokens: string[]): number {
  if (keywordTokens.length === 0 || userTokens.length === 0) return 0;

  const userSet = new Set(userTokens);
  const kwSet = new Set(keywordTokens);

  // Count how many keyword tokens appear in user tokens (after synonym expansion)
  const matchedKwTokens = [...kwSet].filter((kt) =>
    [...userSet].some((ut) => ut === kt || ut.includes(kt) || kt.includes(ut))
  );

  if (matchedKwTokens.length === 0) return 0;

  const kwCoverage = matchedKwTokens.length / kwSet.size;
  // User token coverage — bonus for focusing on the keyword vs long rambling input
  const userCoverage = Math.min(1, kwSet.size / userTokens.length);

  return kwCoverage * (0.7 + 0.3 * userCoverage);
}

/**
 * Check if a keyword (or its synonym-expanded form) appears as a substring of the user input.
 */
function keywordSubstringMatch(input: string, keyword: string): boolean {
  const normalized = input.toLowerCase();
  const kwLower = keyword.toLowerCase();
  if (normalized.includes(kwLower)) return true;

  // Also try synonym-expanded version
  const expandedKw = SYNONYMS[kwLower] ?? kwLower;
  if (expandedKw !== kwLower && normalized.includes(expandedKw)) return true;

  return false;
}

/**
 * Match user input against an intent using layered matching.
 * Returns { score, matchedVia, capturedTopic?, capturedDomain? }
 */
function matchIntent(
  userInput: string,
  intent: Intent,
): { score: number; matchedVia: "exact" | "pattern" | "fuzzy"; capturedTopic?: TheoryTopic | CaseTopic; capturedDomain?: InsightDomain; resolvedWorkflow?: RunnableWorkflowName } | null {
  const lowerInput = userInput.toLowerCase();
  const userTokens = tokenize(userInput);

  // Layer 1: exact keyword substring match (preserves v2 behavior)
  for (const kw of intent.keywords) {
    if (keywordSubstringMatch(lowerInput, kw)) {
      return { score: 1.0, matchedVia: "exact" };
    }
  }

  // Layer 2: phrase pattern match
  for (const pattern of PHRASE_PATTERNS) {
    if (pattern.workflow !== intent.workflow) continue;
    const match = lowerInput.match(pattern.regex);
    if (match) {
      // If pattern has targetCaptureIndex, use it to override the workflow
      let resolvedWorkflow = intent.workflow;
      if (pattern.targetCaptureIndex != null) {
        const targetWord = match[pattern.targetCaptureIndex]?.toLowerCase().trim();
        if (targetWord) {
          const targetWorkflow = WORD_TO_WORKFLOW[targetWord];
          if (targetWorkflow) resolvedWorkflow = targetWorkflow;
        }
      }

      // Capture topic or domain from capture group 1
      const captured = match[1]?.trim();
      let capturedTopic: TheoryTopic | CaseTopic | undefined;
      let capturedDomain: InsightDomain | undefined;

      if (pattern.capturesTopic && captured) {
        const normalized = captured.toLowerCase().replace(/[_\- ]/g, "");
        capturedTopic = TOPIC_NORMALIZATION[normalized] as TheoryTopic | CaseTopic | undefined;
        if (!capturedTopic && ["SEC", "CEX", "N_Glycan", "Papers", "Antibody", "Uncategorized"].includes(captured)) {
          capturedTopic = captured as TheoryTopic | CaseTopic;
        }
      } else if (pattern.capturesDomain && captured) {
        const normalized = captured.toLowerCase().replace(/[_\- ]/g, "");
        if (normalized === "openclaw" || normalized === "ai" || normalized === "general" || normalized === "biotech") {
          capturedDomain = normalized as InsightDomain;
        }
      } else if (captured) {
        // Ambiguous single capture: try topic normalization first, then domain
        const normalized = captured.toLowerCase().replace(/[_\- ]/g, "");
        capturedTopic = TOPIC_NORMALIZATION[normalized] as TheoryTopic | CaseTopic | undefined;
        if (!capturedTopic) {
          const domainCandidates = ["openclaw", "ai", "general", "biotech"];
          const matchedDomain = domainCandidates.find((d) => normalized.includes(d.replace(" ", "")));
          if (matchedDomain) capturedDomain = matchedDomain as InsightDomain;
        }
      }

      return { score: 0.9, matchedVia: "pattern", capturedTopic, capturedDomain, resolvedWorkflow };
    }
  }

  // Layer 3: token-overlap fuzzy match
  let bestScore = 0;
  for (const kw of intent.keywords) {
    const kwTokens = tokenize(kw);
    const score = tokenOverlapScore(userTokens, kwTokens);
    if (score > bestScore) bestScore = score;
  }

  if (bestScore >= 0.5) {
    return { score: bestScore * 0.85, matchedVia: "fuzzy" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Domain keyword rules
// ---------------------------------------------------------------------------

const BIOTECH_KEYWORDS = [
  "抗体", "antibody", "蛋白", "protein", "糖基化", "glycosylation",
  "n-glycan", "n-glycosylation", "sec", "cex", "chromatography",
  "hplc", "up lc", "purity", "aggregate", "charge variant",
  "glycan", "monoclonal", "therapeutic", "biopharmaceutical",
];

const OPENCLAW_KEYWORDS = [
  "openclaw", "obsidian", "plugin", "workflow", "registry",
  "schema", "prompt", "vault", "writeback", "skill", "handler",
  "gateway", "node.invoke", "itemview", "framer-motion",
  "tailwind", "lucide", "wechat", "raw note",
];

const AI_KEYWORDS = [
  "llm", "rag", "embedding", "vector", "prompt engineering",
  "model", "inference", "agent", "retrieval", "evaluation",
  "chatgpt", "claude", "gpt", "mistral", "chunk", "index",
  "similarity", " cosine", " rag ", " llm ",
];

// General is fallback only — no explicit keywords needed

// ---------------------------------------------------------------------------
// Domain inference
// ---------------------------------------------------------------------------

/**
 * Infer domain from note text using keyword matching.
 * Returns a DomainInferenceResult with matched keywords and confidence score.
 *
 * Confidence calculation:
 * - Each matched keyword in a domain adds to that domain's score
 * - Normalized by total keywords found across all domains
 * - If only one domain has matches, confidence is boosted
 * - If multiple domains have significant matches, confidence is lowered
 */
export function inferDomainFromText(text: string): DomainInferenceResult {
  if (!text || !text.trim()) {
    return { domain: undefined, confidence: 0, matchedKeywords: [] };
  }

  const lowerText = text.toLowerCase();
  const allMatched: Array<{ domain: InsightDomain; keyword: string }> = [];

  const recordMatches = (keywords: readonly string[], domain: InsightDomain) => {
    for (const kw of keywords) {
      // Use word boundary-aware matching for short keywords to avoid false positives
      if (kw.length <= 3) {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        if (regex.test(lowerText)) {
          allMatched.push({ domain, keyword: kw });
        }
      } else {
        if (lowerText.includes(kw.toLowerCase())) {
          allMatched.push({ domain, keyword: kw });
        }
      }
    }
  };

  recordMatches(BIOTECH_KEYWORDS, "biotech");
  recordMatches(OPENCLAW_KEYWORDS, "openclaw");
  recordMatches(AI_KEYWORDS, "ai");

  if (allMatched.length === 0) {
    return { domain: undefined, confidence: 0, matchedKeywords: [] };
  }

  // Count matches per domain
  const domainScores: Record<InsightDomain, number> = {
    biotech: 0,
    openclaw: 0,
    ai: 0,
    general: 0,
  };

  for (const match of allMatched) {
    domainScores[match.domain]++;
  }

  const totalMatches = allMatched.length;
  const maxDomainScore = Math.max(domainScores.biotech, domainScores.openclaw, domainScores.ai);

  // Determine dominant domain(s)
  const dominantDomains = (Object.entries(domainScores) as [InsightDomain, number][])
    .filter(([, score]) => score === maxDomainScore && score > 0)
    .map(([domain]) => domain);

  if (dominantDomains.length === 1) {
    const dominant = dominantDomains[0];
    // Confidence = proportion of matches for dominant domain, scaled
    // More matches = higher confidence, up to a point
    const proportion = maxDomainScore / totalMatches;
    const rawConfidence = proportion * Math.min(1, maxDomainScore / 3); // 3 matches = max boost
    const confidence = Math.min(1, Math.max(DOMAIN_LOW_CONFIDENCE, rawConfidence + 0.4));

    return {
      domain: dominant,
      confidence,
      matchedKeywords: allMatched.filter((m) => m.domain === dominant).map((m) => m.keyword),
    };
  }

  // Multiple domains competing — low confidence, signal domain picker
  const totalScore = domainScores.biotech + domainScores.openclaw + domainScores.ai;
  const confidence = totalScore > 0 ? DOMAIN_LOW_CONFIDENCE * (totalMatches / 3) : 0;

  return {
    domain: undefined,
    confidence: Math.min(confidence, DOMAIN_LOW_CONFIDENCE),
    matchedKeywords: allMatched.map((m) => m.keyword),
  };
}

// ---------------------------------------------------------------------------
// Workflow types
// ---------------------------------------------------------------------------

type RunnableWorkflowName = "raw_to_insight" | "note_to_theory" | "note_to_case" | "note_to_method" | "note_to_doc" | "note_to_debug" | "note_to_system" | "note_to_case_by_domain" | "rewrite_current_note" | "fix_frontmatter";

export type WorkflowPlan = {
  action: "convert" | "rewrite" | "fix";
  workflow: RunnableWorkflowName;
  topic?: string;
  domain?: InsightDomain;           // v2: inferred domain for raw_to_insight; required for doc/debug/system/case_by_domain
  confidence: number;               // 0.0 – 1.0; plans below 0.5 are rejected
  needsDomainSelection?: boolean;   // v2: true if domain should be chosen by user (for doc/debug/system/case_by_domain)
};

export type PlannerContext = {
  hasActiveFile: boolean;
  activeFileIsMarkdown: boolean;
  isConnected: boolean;
  activeNoteContent?: string;       // v2: content of active note for domain inference
};

// ---------------------------------------------------------------------------
// Intent definitions
// ---------------------------------------------------------------------------

type Intent = {
  action: WorkflowPlan["action"];
  workflow: RunnableWorkflowName;
  keywords: readonly string[];
  topicNeeded: boolean;
  confidenceBoost: number;
  needsDomainSelection?: boolean;  // v2: domain selection required (doc/debug/system/case_by_domain)
  domainExplicitKeywords?: readonly string[]; // v2: keywords that explicitly set domain
};

const INTENTS: Intent[] = [
  {
    action: "convert",
    workflow: "raw_to_insight",
    keywords: [
      "convert to insight", "insight", "to insight",
      "转 insight", "转化为 insight", "转化成 insight",
      "把这篇笔记转化成 insight", "把这篇笔记转为 insight", "转化成 insight",
      "转化 insight", "转成 insight",
    ],
    topicNeeded: false,
    confidenceBoost: 1.0,
    domainExplicitKeywords: [
      "biotech", "openclaw", "ai", "general",
      "biotech insight", "openclaw insight", "ai insight", "general insight",
    ],
  },
  {
    action: "convert",
    workflow: "note_to_theory",
    keywords: [
      "theory",
      "convert to theory", "to theory",
      "转化 theory", "转成 theory", "转为 theory", "转换 theory",
      "把这篇笔记转化成 theory", "把这篇笔记转为 theory",
      "转化为 theory", "转化成 theory",
      "biotech theory", "SEC theory", "CEX theory", "N_Glycan theory", "Antibody theory",
      "ai theory", "openclaw theory",
      "ai 理论", "openclaw 理论",
    ],
    topicNeeded: true,
    confidenceBoost: 1.0,
    domainExplicitKeywords: [
      "biotech theory", "SEC theory", "CEX theory", "N_Glycan theory", "Papers theory",
      "openclaw theory", "ai theory",
      "biotech 理论", "SEC 理论", "CEX 理论", "N_Glycan 理论",
    ],
  },
  {
    action: "convert",
    workflow: "note_to_case",
    keywords: [
      "convert to case", "to case",
      "转化 case", "转成 case",
      "把这篇笔记转化成 case", "把这篇笔记转为 case",
      "转化为 case", "转化成 case",
      "biotech case", "SEC case", "CEX case", "N_Glycan case",
    ],
    topicNeeded: true,
    confidenceBoost: 1.0,
    domainExplicitKeywords: [
      "biotech case", "SEC case", "CEX case", "N_Glycan case",
      "biotech 案例", "SEC 案例", "CEX 案例", "N_Glycan 案例",
    ],
  },
  {
    action: "convert",
    workflow: "note_to_method",
    keywords: [
      "convert to method", "to method", "method", "protocol",
      "转 method", "转成 method", "转化为 method", "转化成 method",
      "转方法", "转成方法", "转化成方法", "方法笔记",
      "SEC method", "CEX method", "N_Glycan method", "Antibody method",
    ],
    topicNeeded: true,
    confidenceBoost: 1.0,
    domainExplicitKeywords: [
      "biotech method", "SEC method", "CEX method", "N_Glycan method",
      "biotech 方法", "SEC 方法", "CEX 方法", "N_Glycan 方法",
    ],
  },
  {
    action: "rewrite",
    workflow: "rewrite_current_note",
    keywords: [
      "rewrite note", "rewrite current note", "rewrite",
      "重写笔记", "重写", "Rewrite",
      "把这篇笔记重写",
    ],
    topicNeeded: false,
    confidenceBoost: 1.0,
  },
  {
    action: "fix",
    workflow: "fix_frontmatter",
    keywords: [
      "fix schema", "fix frontmatter", "fix note",
      "修复 schema", "修复 frontmatter", "修复笔记",
      "修复笔记 schema", "Fix schema",
    ],
    topicNeeded: false,
    confidenceBoost: 1.0,
  },
  {
    action: "convert",
    workflow: "note_to_doc",
    keywords: [
      "convert to doc", "to doc", "doc",
      "转 doc", "转化为 doc", "转化成 doc",
      "把这篇笔记转化成 doc", "把这篇笔记转为 doc",
      "转化 doc", "转成 doc",
    ],
    topicNeeded: false,
    needsDomainSelection: true,
    confidenceBoost: 1.0,
    domainExplicitKeywords: ["openclaw doc", "ai doc"],
  },
  {
    action: "convert",
    workflow: "note_to_debug",
    keywords: [
      "convert to debug", "to debug", "debug",
      "转 debug", "转化为 debug", "转化成 debug",
      "把这篇笔记转化成 debug", "把这篇笔记转为 debug",
      "转化 debug", "转成 debug",
    ],
    topicNeeded: false,
    needsDomainSelection: true,
    confidenceBoost: 1.0,
    domainExplicitKeywords: ["openclaw debug", "ai debug"],
  },
  {
    action: "convert",
    workflow: "note_to_system",
    keywords: [
      "convert to system", "to system", "system",
      "转 system", "转化为 system", "转化成 system",
      "把这篇笔记转化成 system", "把这篇笔记转为 system",
      "转化 system", "转成 system",
    ],
    topicNeeded: false,
    needsDomainSelection: true,
    confidenceBoost: 1.0,
    domainExplicitKeywords: ["openclaw system", "ai system"],
  },
  {
    action: "convert",
    workflow: "note_to_case_by_domain",
    keywords: [
      "convert to case", "ai case", "openclaw case",
      "ai troubleshooting", "openclaw troubleshooting",
      "ai 问题", "openclaw 问题",
      "转 case", "转化 case", "转成 case",
      "把这篇笔记转化成 case", "把这篇笔记转为 case",
    ],
    topicNeeded: false,
    needsDomainSelection: true,
    confidenceBoost: 1.0,
    domainExplicitKeywords: ["openclaw", "ai", "openclaw case", "ai case"],
  },
];

// ---------------------------------------------------------------------------
// Explicit domain keywords mapping
// ---------------------------------------------------------------------------

const EXPLICIT_DOMAIN_MAP: Record<string, InsightDomain> = {
  "biotech": "biotech",
  "openclaw": "openclaw",
  "ai": "ai",
  "general": "general",
  "biotech insight": "biotech",
  "openclaw insight": "openclaw",
  "ai insight": "ai",
  "general insight": "general",
  "openclaw doc": "openclaw",
  "ai doc": "ai",
  "openclaw debug": "openclaw",
  "ai debug": "ai",
  "openclaw system": "openclaw",
  "ai system": "ai",
  "openclaw theory": "openclaw",
  "ai theory": "ai",
};

// ---------------------------------------------------------------------------
// Planner result
// ---------------------------------------------------------------------------

export type PlannerResult =
  | { valid: true; plan: WorkflowPlan }
  | { valid: false; reason: string };

// ---------------------------------------------------------------------------
// Note frontmatter parsing (P1)
// ---------------------------------------------------------------------------

type NoteFrontmatter = {
  type?: string;
  domain?: string;
  topic?: string;
};

/**
 * Extract key fields from note frontmatter. Returns null if no frontmatter found.
 */
function parseNoteFrontmatter(content: string): NoteFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    // Minimal YAML parse — just extract key: value lines
    const frontmatter: NoteFrontmatter = {};
    for (const line of match[1].split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx < 0) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key === "type" || key === "domain" || key === "topic") {
        frontmatter[key as keyof NoteFrontmatter] = value;
      }
    }
    return frontmatter;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// P1: Preflight check — validate plan against active note state
// ---------------------------------------------------------------------------

/**
 * Check if the plan makes sense given the active note's current frontmatter.
 * Returns a PlannerResult (valid=false) if the plan should be rejected/warned.
 */
function preflightPlan(
  workflow: RunnableWorkflowName,
  frontmatter: NoteFrontmatter,
  userInput: string,
): PlannerResult | undefined {
  const currentType = frontmatter.type?.toLowerCase();
  const currentDomain = frontmatter.domain?.toLowerCase();

  // Map note.type to the workflow it would be in
  const TYPE_TO_WORKFLOW: Record<string, RunnableWorkflowName> = {
    "raw": "raw_to_insight",
    "insight": "raw_to_insight",
    "theory": "note_to_theory",
    "case": "note_to_case",
    "method": "note_to_method",
    "case_by_domain": "note_to_case_by_domain",
    "doc": "note_to_doc",
    "debug": "note_to_debug",
    "system": "note_to_system",
  };

  const currentWorkflow = currentType ? (TYPE_TO_WORKFLOW[currentType] ?? "raw_to_insight") : undefined;

  // Same workflow → no-op
  if (currentWorkflow === workflow) {
    const typeLabel = frontmatter.type ?? currentType ?? "unknown";
    return { valid: false, reason: `Note is already type '${typeLabel}'. No conversion needed.` };
  }

  // raw → raw (no conversion needed)
  if (currentType === "raw" && workflow === "raw_to_insight") {
    return { valid: false, reason: "This note is already a raw note. Use 'convert to insight' to transform it." };
  }

  // If user is trying to convert to the type they already have → suggest alternatives
  if (currentWorkflow && currentWorkflow !== workflow) {
    // Contextual suggestions based on what the note currently is
    const TYPE_SUGGESTIONS: Record<string, string> = {
      "raw": "convert to insight",
      "insight": "convert to theory / case / doc / debug / system",
      "theory": "convert to case / doc",
      "case": "convert to doc / debug / system",
    };
    const suggestion = TYPE_SUGGESTIONS[currentType ?? ""] ?? "a different conversion";
    return {
      valid: false,
      reason: `Note is already type '${frontmatter.type}'. Did you mean '${suggestion}'?`,
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Core resolution
// ---------------------------------------------------------------------------

/**
 * Check if user explicitly mentioned a domain in their input.
 * Returns the domain if found, undefined otherwise.
 */
function extractExplicitDomain(userInput: string): InsightDomain | undefined {
  const lower = userInput.toLowerCase();
  for (const [kw, domain] of Object.entries(EXPLICIT_DOMAIN_MAP)) {
    if (lower.includes(kw)) {
      return domain;
    }
  }
  return undefined;
}

/**
 * Resolve a user input string into a WorkflowPlan using lightweight
 * keyword matching. Returns PlannerResult — caller must validate before use.
 *
 * @param userInput       - raw text from the user
 * @param context         - current app state (presence of active file, connection)
 * @param activeNoteContent - (optional) content of active note for domain inference
 */
export function resolveWorkflowPlan(
  userInput: string,
  context: PlannerContext,
  activeNoteContent?: string
): PlannerResult {
  const normalized = userInput.trim().toLowerCase();

  if (!normalized) {
    return { valid: false, reason: "Empty input." };
  }

  if (!context.isConnected) {
    return { valid: false, reason: "OpenClaw is not connected." };
  }

  // Find the best matching intent using layered matching
  let bestMatch: Intent | null = null;
  let bestResult: ReturnType<typeof matchIntent> | null = null;

  for (const intent of INTENTS) {
    const result = matchIntent(userInput, intent);
    if (result && (!bestResult || result.score > bestResult.score)) {
      bestResult = result;
      bestMatch = intent;
    }
  }

  if (!bestMatch || !bestResult) {
    return { valid: false, reason: "No matching workflow found." };
  }

  // Minimum score thresholds by match layer
  const minScore = bestResult.matchedVia === "exact" ? 0.05 :
                    bestResult.matchedVia === "pattern" ? 0.5 : 0.5;

  if (bestResult.score < minScore) {
    return { valid: false, reason: "Confidence too low." };
  }

  if (!context.hasActiveFile) {
    return { valid: false, reason: "No active note is open." };
  }

  if (!context.activeFileIsMarkdown) {
    return { valid: false, reason: "Active note is not a Markdown file." };
  }

  // P0: Resolve workflow — pattern may have overridden it via targetCaptureIndex
  const resolvedWorkflow = bestResult.resolvedWorkflow ?? bestMatch.workflow;

  // P0: Extract topic captured by pattern
  const capturedTopic = bestResult.capturedTopic;

  // P1: Preflight — check active note frontmatter for conflicts
  if (activeNoteContent || context.activeNoteContent) {
    const content = activeNoteContent ?? context.activeNoteContent!;
    const frontmatter = parseNoteFrontmatter(content);
    if (frontmatter) {
      const preflight = preflightPlan(resolvedWorkflow, frontmatter, userInput);
      if (preflight) return preflight;
    }
  }

  // v2: Domain inference for raw_to_insight
  let domain: InsightDomain | undefined;
  let needsDomainSelection = bestMatch.needsDomainSelection ?? false;

  if (resolvedWorkflow === "raw_to_insight") {
    // P0: Pattern captured domain from the input word (e.g. "openclaw" in the input)
    if (bestResult.capturedDomain) {
      domain = bestResult.capturedDomain;
    } else {
      const explicitDomain = extractExplicitDomain(userInput);
      if (explicitDomain) {
        domain = explicitDomain;
      } else {
        const contentToAnalyze = activeNoteContent ?? context.activeNoteContent;
        if (contentToAnalyze && contentToAnalyze.trim()) {
          const inference = inferDomainFromText(contentToAnalyze);
          if (inference.domain && inference.confidence >= DOMAIN_HIGH_CONFIDENCE) {
            domain = inference.domain;
          } else if (inference.confidence >= DOMAIN_LOW_CONFIDENCE && inference.domain) {
            domain = inference.domain;
            needsDomainSelection = true;
          } else {
            needsDomainSelection = true;
          }
        } else {
          needsDomainSelection = true;
        }
      }
    }
  } else if (resolvedWorkflow === "note_to_theory" || resolvedWorkflow === "note_to_case_by_domain") {
    if (bestResult.capturedDomain) {
      domain = bestResult.capturedDomain;
      needsDomainSelection = false;
    } else {
      const explicitDomain = extractExplicitDomain(userInput);
      if (explicitDomain) {
        domain = explicitDomain;
        needsDomainSelection = false;
      } else if (resolvedWorkflow === "note_to_case_by_domain") {
        needsDomainSelection = true;
      }
    }
  } else if (resolvedWorkflow === "note_to_doc" || resolvedWorkflow === "note_to_debug" || resolvedWorkflow === "note_to_system") {
    if (bestResult.capturedDomain) {
      domain = bestResult.capturedDomain;
      needsDomainSelection = false;
    }
  }

  return {
    valid: true,
    plan: {
      action: bestMatch.action,
      workflow: resolvedWorkflow,
      topic: capturedTopic,
      domain,
      confidence: Math.min(1.0, bestResult.score),
      needsDomainSelection,
    },
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a WorkflowPlan before passing it to runWorkflow.
 * Returns the plan if valid, throws if not.
 *
 * Note: For raw_to_insight with needsDomainSelection=true, caller should
 * not execute the workflow automatically — instead, prompt domain selection first.
 */
export function validatePlan(plan: unknown, context: PlannerContext): asserts plan is WorkflowPlan {
  if (!isPlan(plan)) {
    throw new Error(`Invalid plan: ${JSON.stringify(plan)}`);
  }
  if (plan.confidence < 0.5) {
    throw new Error(`Plan confidence too low: ${plan.confidence}`);
  }
  if (!["convert", "rewrite", "fix"].includes(plan.action)) {
    throw new Error(`Invalid action: ${plan.action}`);
  }
  if (plan.action === "convert" && !["raw_to_insight", "note_to_theory", "note_to_case", "note_to_method", "note_to_doc", "note_to_debug", "note_to_system", "note_to_case_by_domain"].includes(plan.workflow)) {
    throw new Error(`Invalid workflow for convert: ${plan.workflow}`);
  }
  // v2: doc/debug/system/case_by_domain require domain selection
  // Skip this check when needsDomainSelection=true — domain picker will shown in convertCurrentNoteWithRegistry
  if (["note_to_doc", "note_to_debug", "note_to_system", "note_to_case_by_domain"].includes(plan.workflow) && !plan.domain && !plan.needsDomainSelection) {
    throw new Error(`Domain selection required for ${plan.workflow} but no domain provided.`);
  }
  // Biotech theory requires topic; openclaw/ai theory do not
  if (plan.workflow === "note_to_theory" && plan.domain === "biotech" && !plan.topic) {
    throw new Error(`Topic is required for biotech theory.`);
  }
  if (plan.workflow === "note_to_method" && !plan.topic) {
    throw new Error(`Topic is required for method.`);
  }
  if (!context.hasActiveFile || !context.activeFileIsMarkdown) {
    throw new Error("No active Markdown note.");
  }
}

/**
 * Type guard for WorkflowPlan.
 */
export function isPlan(value: unknown): value is WorkflowPlan {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.action === "string" &&
    typeof p.workflow === "string" &&
    typeof p.confidence === "number" &&
    p.confidence >= 0 &&
    p.confidence <= 1 &&
    ["convert", "rewrite", "fix"].includes(p.action)
  );
}

/** The plan type returned by resolveWorkflowPlan when valid. */
export type PlannerWorkflowPlan = WorkflowPlan;
