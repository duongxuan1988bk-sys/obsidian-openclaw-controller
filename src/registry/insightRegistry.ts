import { normalizePath, parseYaml, TFile, type App } from "obsidian";
import { FIX_FRONTMATTER_DATE_RULES } from "./frontmatterDateRules";

export const WORKFLOW_REGISTRY_PATH = "PARA/03Resources/00System/Workflow Registry/workflow_registry.yaml";
export const SCHEMA_REGISTRY_PATH = "PARA/03Resources/00System/Schema/schema_registry.yaml";
export const PROMPT_REGISTRY_PATH = "PARA/03Resources/00System/Prompts/prompt_registry.yaml";
export const PATH_MAPPING_PATH = "PARA/03Resources/00System/Path Mapping/path_mapping.yaml";

const CONVERT_TO_INSIGHT_ACTION = "convert_to_insight";
const RAW_TO_INSIGHT_WORKFLOW = "raw_to_insight";
const INSIGHT_SCHEMA_PREFIX = "insight_";
const INSIGHT_PROMPT_PREFIX = "insight_";
const INSIGHT_PATH_PREFIX = "insight_";
const CONVERT_TO_THEORY_ACTION = "convert_to_theory";
const NOTE_TO_THEORY_WORKFLOW = "note_to_theory";
const BIOTECH_THEORY_SCHEMA = "biotech_theory_schema";
const BIOTECH_NGLYCAN_THEORY_PROMPT = "biotech_nglycan_theory_prompt";
const BIOTECH_NGLYCAN_THEORY_PATH_KEY = "biotech_nglycan_theory";
const CONVERT_TO_CASE_ACTION = "convert_to_case";
const NOTE_TO_CASE_WORKFLOW = "note_to_case";
const NOTE_TO_CASE_BY_DOMAIN_WORKFLOW = "note_to_case_by_domain";
const BIOTECH_CASE_SCHEMA = "biotech_case_schema";
const BIOTECH_CASE_PROMPT = "biotech_case_prompt";
const BIOTECH_CASE_PATH_KEY = "biotech_case";
const NOTE_TO_METHOD_ACTION = "note_to_method";
const NOTE_TO_METHOD_WORKFLOW = "note_to_method";
const BIOTECH_METHOD_SCHEMA = "biotech_method_schema";
const BIOTECH_METHOD_PROMPT = "biotech_method_prompt";
const BIOTECH_METHOD_PATH_KEY = "biotech_method";
const CONVERT_TO_RAW_ACTION = "convert_to_raw";
const WECHAT_TO_RAW_WORKFLOW = "wechat_to_raw";
const RAW_SCHEMA = "raw_schema";
const WECHAT_TO_RAW_PROMPT = "wechat_to_raw_prompt";
const RAW_WECHAT_PATH_KEY = "raw_wechat";
const REWRITE_CURRENT_NOTE_ACTION = "rewrite_current_note";
const REWRITE_CURRENT_NOTE_WORKFLOW = "rewrite_current_note";
const REWRITE_NOTE_PROMPT = "rewrite_note_prompt";
const REPLACE_CURRENT_NOTE_EXECUTOR = "replace_current_note";
const PRESERVE_CURRENT_SCHEMA_MODE = "preserve_current";
const FIX_FRONTMATTER_ACTION = "fix_frontmatter";
const FIX_FRONTMATTER_WORKFLOW = "fix_frontmatter";
const FIX_FRONTMATTER_PROMPT = "fix_frontmatter_prompt";
const REPAIR_CURRENT_SCHEMA_MODE = "repair_current";
const NOTE_TO_DOC_ACTION = "note_to_doc";
const NOTE_TO_DEBUG_ACTION = "note_to_debug";
const NOTE_TO_SYSTEM_ACTION = "note_to_system";

export type TheoryTopic = "SEC" | "CEX" | "N_Glycan" | "Papers" | "Antibody" | "Uncategorized";
export type CaseTopic = "SEC" | "CEX" | "N_Glycan" | "Antibody" | "Uncategorized";
export type MethodTopic = "SEC" | "CEX" | "N_Glycan" | "Antibody" | "Uncategorized";
export type TheoryDomain = "openclaw" | "ai";
export type DocDomain = "openclaw" | "ai";
export type DebugDomain = "openclaw" | "ai";
export type SystemDomain = "openclaw" | "ai";

type RegistryRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Registry Cache — mtime-based vault revision invalidation
// ---------------------------------------------------------------------------

type CacheEntry<T> = {
  data: T;
  mtime: number;
};

class RegistryCache {
  private workflowRegistry: CacheEntry<RegistryRecord> | null = null;
  private schemaRegistry: CacheEntry<RegistryRecord> | null = null;
  private promptRegistry: CacheEntry<RegistryRecord> | null = null;
  private pathMapping: CacheEntry<RegistryRecord> | null = null;

  private getCandidates(path: string): string[] {
    const normalized = normalizePath(path);
    const candidates = normalized.startsWith("PARA/") ? [normalized, normalized.slice("PARA/".length)] : [normalized];
    return candidates.flatMap((candidate) => {
      if (candidate.includes("/Prompts/prompt_registry.yaml")) {
        return [candidate, candidate.replace("/Prompts/prompt_registry.yaml", "/Prompts/prompts_registry.yaml")];
      }
      if (candidate.includes("/Prompts/prompts_registry.yaml")) {
        return [candidate, candidate.replace("/Prompts/prompts_registry.yaml", "/Prompts/prompt_registry.yaml")];
      }
      return [candidate];
    });
  }

  private async getRegistry(app: App, path: string, cache: CacheEntry<RegistryRecord> | null): Promise<RegistryRecord> {
    const candidates = this.getCandidates(path);
    const file = resolveRegistryFile(app, candidates);
    if (!(file instanceof TFile)) {
      throw new Error(`Registry file not found. Tried: ${candidates.flatMap((c) => [c, `${c}.md`]).join(", ")}`);
    }

    // Return cached if mtime matches
    if (cache && cache.mtime === file.stat.mtime) {
      return cache.data;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(await app.vault.cachedRead(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse YAML ${path}: ${message}`);
    }
    return asRecord(parsed, path);
  }

  async getWorkflowRegistry(app: App): Promise<RegistryRecord> {
    this.workflowRegistry = {
      data: await this.getRegistry(app, WORKFLOW_REGISTRY_PATH, this.workflowRegistry),
      mtime: (await this.findFile(app, [WORKFLOW_REGISTRY_PATH]))?.stat.mtime ?? 0
    };
    return this.workflowRegistry.data;
  }

  async getSchemaRegistry(app: App): Promise<RegistryRecord> {
    this.schemaRegistry = {
      data: await this.getRegistry(app, SCHEMA_REGISTRY_PATH, this.schemaRegistry),
      mtime: (await this.findFile(app, [SCHEMA_REGISTRY_PATH]))?.stat.mtime ?? 0
    };
    return this.schemaRegistry.data;
  }

  async getPromptRegistry(app: App): Promise<RegistryRecord> {
    this.promptRegistry = {
      data: await this.getRegistry(app, PROMPT_REGISTRY_PATH, this.promptRegistry),
      mtime: (await this.findFile(app, [PROMPT_REGISTRY_PATH]))?.stat.mtime ?? 0
    };
    return this.promptRegistry.data;
  }

  async getPathMapping(app: App): Promise<RegistryRecord> {
    this.pathMapping = {
      data: await this.getRegistry(app, PATH_MAPPING_PATH, this.pathMapping),
      mtime: (await this.findFile(app, [PATH_MAPPING_PATH]))?.stat.mtime ?? 0
    };
    return this.pathMapping.data;
  }

  private async findFile(app: App, candidates: string[]): Promise<TFile | null> {
    const allCandidates = this.getCandidates(candidates[0] ?? "");
    return resolveRegistryFile(app, allCandidates);
  }

  invalidate() {
    this.workflowRegistry = null;
    this.schemaRegistry = null;
    this.promptRegistry = null;
    this.pathMapping = null;
  }
}

const registryCache = new RegistryCache();

type ResolvedWorkflow = {
  name: string;
  schemaKey: string;
  promptKey: string;
  pathKey: string;
  filenameStrategy?: string;
  backendMode?: string;
  backendSkill?: string;
};

type ResolvedSchema = {
  requiredFrontmatter: unknown;
  fixedValues: unknown;
  optionalFrontmatter?: unknown;
  bodySections: unknown;
};

type ResolvedPrompt = {
  purpose: unknown;
  constraints: unknown;
  outputStyle: unknown;
};

type ResolvedRewriteWorkflowConfig = {
  name: string;
  promptKey: string;
  executorAction: string;
  filenameStrategy?: string;
  schemaMode?: string;
  schemaKey?: string;
};

export type BuildRegistryPromptInput = {
  title: string;
  path: string;
  content: string;
  topic?: string;
  domain?: string;
};

export type BuildInsightPromptInput = BuildRegistryPromptInput;

export type ResolvedRegistryWorkflow = {
  workflow: ResolvedWorkflow;
  targetDir: string;
  prompt: string;
};

export type ResolvedInsightWorkflow = ResolvedRegistryWorkflow;

export type ResolvedRawSkillWorkflow = {
  workflow: ResolvedWorkflow;
  targetDir: string;
  backendSkill: string;
};

export type ResolvedRewriteWorkflow = {
  workflow: ResolvedRewriteWorkflowConfig;
  prompt: string;
};

export type ResolvedFixFrontmatterWorkflow = {
  workflow: ResolvedRewriteWorkflowConfig;
  schemaKey: string;
  prompt: string;
};

export type WorkflowSpec = {
  action: string;
  fallbackWorkflow: string;
  schemaKey: string;
  promptKey: string;
  pathKey: string;
  role: string;
  task: string;
  targetLabel: string;
  requiredFixedValues: Record<string, string>;
  blockedTags: string[];
};

export type InsightDomain = "biotech" | "openclaw" | "ai" | "general";

function createInsightSpec(domain: InsightDomain): WorkflowSpec {
  return {
    action: CONVERT_TO_INSIGHT_ACTION,
    fallbackWorkflow: RAW_TO_INSIGHT_WORKFLOW,
    schemaKey: `${INSIGHT_SCHEMA_PREFIX}${domain}`,
    promptKey: `${INSIGHT_PROMPT_PREFIX}${domain}`,
    pathKey: `${INSIGHT_PATH_PREFIX}${domain}`,
    role: `${domain} insight assistant`,
    task: "Convert the current raw note into an insight markdown note.",
    targetLabel: "insight",
    requiredFixedValues: {
      type: "insight",
      status: "draft",
      domain,
      workflow: "raw_to_insight"
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createTheorySpec(topic: string): WorkflowSpec {
  return {
    action: CONVERT_TO_THEORY_ACTION,
    fallbackWorkflow: NOTE_TO_THEORY_WORKFLOW,
    schemaKey: BIOTECH_THEORY_SCHEMA,
    promptKey: BIOTECH_NGLYCAN_THEORY_PROMPT,
    pathKey: BIOTECH_NGLYCAN_THEORY_PATH_KEY,
    role: "biotech theory assistant",
    task: `Convert the current insight note into a new theory markdown note for the selected topic ${topic}.`,
    targetLabel: "theory",
    requiredFixedValues: {
      type: "theory",
      status: "draft",
      domain: "biotech",
      workflow: "note_to_theory",
      topic
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createTheoryByDomainSpec(domain: TheoryDomain): WorkflowSpec {
  return {
    action: CONVERT_TO_THEORY_ACTION,
    fallbackWorkflow: NOTE_TO_THEORY_WORKFLOW,
    schemaKey: `${domain}_theory_schema`,
    promptKey: `${domain}_theory_prompt`,
    pathKey: `${domain}_theory`,
    role: `${domain} theory assistant`,
    task: `Convert the current note into a new ${domain} theory markdown note.`,
    targetLabel: "theory",
    requiredFixedValues: {
      type: "theory",
      status: "draft",
      domain,
      workflow: NOTE_TO_THEORY_WORKFLOW
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createCaseSpec(topic: string): WorkflowSpec {
  return {
    action: CONVERT_TO_CASE_ACTION,
    fallbackWorkflow: NOTE_TO_CASE_WORKFLOW,
    schemaKey: BIOTECH_CASE_SCHEMA,
    promptKey: BIOTECH_CASE_PROMPT,
    pathKey: BIOTECH_CASE_PATH_KEY,
    role: "biotech case assistant",
    task: `Convert the current note into a new biotech case note for the selected topic ${topic}.`,
    targetLabel: "case",
    requiredFixedValues: {
      type: "case",
      status: "draft",
      domain: "biotech",
      workflow: "note_to_case",
      topic
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createMethodSpec(topic: string): WorkflowSpec {
  return {
    action: NOTE_TO_METHOD_ACTION,
    fallbackWorkflow: NOTE_TO_METHOD_WORKFLOW,
    schemaKey: BIOTECH_METHOD_SCHEMA,
    promptKey: BIOTECH_METHOD_PROMPT,
    pathKey: BIOTECH_METHOD_PATH_KEY,
    role: "biotech method assistant",
    task: `Convert the current note into a structured biotech method note for the selected topic ${topic}.`,
    targetLabel: "method",
    requiredFixedValues: {
      type: "method",
      status: "draft",
      domain: "biotech",
      workflow: NOTE_TO_METHOD_WORKFLOW,
      topic
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createDocSpec(domain: DocDomain): WorkflowSpec {
  return {
    action: NOTE_TO_DOC_ACTION,
    fallbackWorkflow: NOTE_TO_DOC_ACTION,
    schemaKey: `${domain}_doc_schema`,
    promptKey: `${domain}_doc_prompt`,
    pathKey: `${domain}_doc`,
    role: `${domain} doc assistant`,
    task: `Convert one or more ${domain} notes into a structured technical reference document.`,
    targetLabel: "doc",
    requiredFixedValues: {
      type: "doc",
      status: "draft",
      domain,
      workflow: NOTE_TO_DOC_ACTION
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createDebugSpec(domain: DebugDomain): WorkflowSpec {
  return {
    action: NOTE_TO_DEBUG_ACTION,
    fallbackWorkflow: NOTE_TO_DEBUG_ACTION,
    schemaKey: `${domain}_debug_schema`,
    promptKey: `${domain}_debug_prompt`,
    pathKey: `${domain}_debug`,
    role: `${domain} debug assistant`,
    task: `Convert a ${domain} note into a structured troubleshooting debug document.`,
    targetLabel: "debug",
    requiredFixedValues: {
      type: "debug",
      status: "draft",
      domain,
      workflow: NOTE_TO_DEBUG_ACTION
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createSystemSpec(domain: SystemDomain): WorkflowSpec {
  return {
    action: NOTE_TO_SYSTEM_ACTION,
    fallbackWorkflow: NOTE_TO_SYSTEM_ACTION,
    schemaKey: `${domain}_system_schema`,
    promptKey: `${domain}_system_prompt`,
    pathKey: `${domain}_system`,
    role: `${domain} system assistant`,
    task: `Synthesize multiple ${domain} notes into a system architecture overview document.`,
    targetLabel: "system",
    requiredFixedValues: {
      type: "system",
      status: "draft",
      domain,
      workflow: NOTE_TO_SYSTEM_ACTION
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

function createOpenClawCaseSpec(domain: DocDomain | DebugDomain): WorkflowSpec {
  return {
    action: CONVERT_TO_CASE_ACTION,
    fallbackWorkflow: NOTE_TO_CASE_BY_DOMAIN_WORKFLOW,
    schemaKey: `${domain}_case_schema`,
    promptKey: `${domain}_case_prompt`,
    pathKey: `${domain}_case`,
    role: `${domain} case assistant`,
    task: `Convert the current note into a new ${domain} case note.`,
    targetLabel: "case",
    requiredFixedValues: {
      type: "case",
      status: "draft",
      domain,
      workflow: NOTE_TO_CASE_BY_DOMAIN_WORKFLOW
    },
    blockedTags: ["raw", "Obsidian"]
  };
}

const RAW_SKILL_SPEC: WorkflowSpec = {
  action: CONVERT_TO_RAW_ACTION,
  fallbackWorkflow: WECHAT_TO_RAW_WORKFLOW,
  schemaKey: RAW_SCHEMA,
  promptKey: WECHAT_TO_RAW_PROMPT,
  pathKey: RAW_WECHAT_PATH_KEY,
  role: "wechat raw note importer",
  task: "Convert a WeChat URL into a raw Obsidian markdown note using the configured OpenClaw skill.",
  targetLabel: "raw",
  requiredFixedValues: {
    type: "raw",
    status: "raw",
    source: "wechat",
    workflow: "wechat_to_raw"
  },
  blockedTags: []
};

function asRecord(value: unknown, label: string): RegistryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML object`);
  }
  return value as RegistryRecord;
}

function isRecord(value: unknown): value is RegistryRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Resolve a domain entry from a domain_mapping and build a partial ResolvedWorkflow.
 * Returns null if domain is not found in the mapping.
 */
function resolveDomainEntry(
  workflowEntry: RegistryRecord,
  domain: string,
  workflowName: string,
  opts?: { optional?: boolean }
): ResolvedWorkflow | null {
  const domainMapping = workflowEntry.domain_mapping ?? workflowEntry.domainMapping;
  if (!isRecord(domainMapping)) return null;
  const domainEntry = findRegistryEntry(domainMapping, domain);
  if (!isRecord(domainEntry)) return null;

  const schemaField = getOptionalStringField(domainEntry, ["schema", "schema_key", "schemaKey"]);
  const promptField = getOptionalStringField(domainEntry, ["prompt", "prompt_key", "promptKey"]);
  const pathField = getOptionalStringField(domainEntry, ["path_key", "pathKey", "target_path_key", "targetPathKey", "path"]);

  if (opts?.optional) {
    // Return null if any required field is missing (don't throw)
    if (!schemaField || !promptField || !pathField) return null;
  } else {
    // Throw on missing required fields
    if (!schemaField) throw new Error(`Schema missing for domain "${domain}" in workflow ${workflowName}. Add schema_key to domain_mapping.`);
    if (!promptField) throw new Error(`Prompt missing for domain "${domain}" in workflow ${workflowName}. Add prompt_key to domain_mapping.`);
    if (!pathField) throw new Error(`Path key missing for domain "${domain}" in workflow ${workflowName}. Add path_key to domain_mapping.`);
  }

  return {
    name: workflowName,
    schemaKey: schemaField,
    promptKey: promptField,
    pathKey: pathField,
    filenameStrategy: getOptionalStringField(domainEntry, ["filename_strategy", "filenameStrategy"]) ?? getOptionalStringField(workflowEntry, ["filename_strategy", "filenameStrategy"]),
    backendMode: getOptionalStringField(domainEntry, ["backend_mode", "backendMode"]) ?? getOptionalStringField(workflowEntry, ["backend_mode", "backendMode"]),
    backendSkill: getOptionalStringField(domainEntry, ["backend_skill", "backendSkill"]) ?? getOptionalStringField(workflowEntry, ["backend_skill", "backendSkill"])
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function isInsightSchemaKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("insight") && k.includes("schema");
}

function isInsightPromptKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("insight");
}

function isInsightPathKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.startsWith("insight_") || k.includes("insight");
}

function isDocSchemaKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("doc") && k.includes("schema");
}

function isDocPromptKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("doc") && !k.includes("debug");
}

function isDocPathKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("doc") && !k.includes("debug");
}

function isDebugSchemaKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("debug") && k.includes("schema");
}

function isDebugPromptKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("debug");
}

function isDebugPathKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("debug");
}

function isSystemSchemaKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("system") && k.includes("schema");
}

function isSystemPromptKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("system");
}

function isSystemPathKey(key: string): boolean {
  const k = normalizeKey(key);
  return k.includes("system");
}

function findRegistryEntry(root: RegistryRecord, key: string): unknown {
  const normalized = normalizeKey(key);
  const direct = root[key] ?? root[normalized];
  if (direct !== undefined) return direct;

  for (const containerKey of ["actions", "workflows", "schemas", "prompts", "paths", "mappings", "entries", "registry"]) {
    const container = root[containerKey];
    if (isRecord(container)) {
      const nested = container[key] ?? container[normalized];
      if (nested !== undefined) return nested;
    }
    if (Array.isArray(container)) {
      const found = container.find((item) => {
        if (!isRecord(item)) return false;
        const id = item.id ?? item.key ?? item.name ?? item.action ?? item.workflow;
        return typeof id === "string" && normalizeKey(id) === normalized;
      });
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

function getStringField(record: RegistryRecord, keys: string[], label: string): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  throw new Error(`Missing ${label}`);
}

function getOptionalStringField(record: RegistryRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function getOptionalField(record: RegistryRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function requireField(record: RegistryRecord, keys: string[], label: string): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  throw new Error(`Missing ${label}`);
}

function formatYamlish(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "- none";
    return value
      .map((item) => {
        if (typeof item === "string") return `- ${item}`;
        return `- ${JSON.stringify(item)}`;
      })
      .join("\n");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => {
        if (Array.isArray(item)) return `${key}: [${item.map((v) => JSON.stringify(v)).join(", ")}]`;
        if (isRecord(item)) return `${key}: ${JSON.stringify(item)}`;
        return `${key}: ${String(item)}`;
      })
      .join("\n");
  }
  return String(value ?? "");
}

function basenameOfPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function normalizePathForLookup(path: string): string {
  return normalizePath(path).replace(/^\/+/, "").toLowerCase();
}

function parseSourceFrontmatter(content: string): RegistryRecord | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return null;

  try {
    const parsed = parseYaml(match[1]);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function collectSchemaFieldNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (isRecord(item)) {
        const id = item.name ?? item.key ?? item.field ?? item.id;
        return typeof id === "string" ? [id] : Object.keys(item);
      }
      return [];
    });
  }
  if (isRecord(value)) return Object.keys(value);
  return [];
}

function schemaAllowedFrontmatterFields(schema: ResolvedSchema): string[] {
  const names = new Set<string>();
  for (const name of collectSchemaFieldNames(schema.requiredFrontmatter)) names.add(name);
  for (const name of collectSchemaFieldNames(schema.optionalFrontmatter)) names.add(name);
  for (const name of collectSchemaFieldNames(schema.fixedValues)) names.add(name);
  names.add("created");
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function inferNoteType(input: BuildRegistryPromptInput): string | undefined {
  const frontmatter = parseSourceFrontmatter(input.content);
  const type = frontmatter?.type;
  if (typeof type === "string" && type.trim()) {
    const normalized = normalizeKey(type);
    // Known types
    if (
      normalized === "raw" ||
      normalized === "insight" ||
      normalized === "theory" ||
      normalized === "case" ||
      normalized === "method" ||
      normalized === "doc" ||
      normalized === "debug" ||
      normalized === "system"
    ) return normalized;
    // Legacy manual note types used before OpenClaw's schema taxonomy.
    if (
      normalized === "method" ||
      normalized === "method_overview" ||
      normalized === "protocol" ||
      normalized === "resource" ||
      normalized === "reference" ||
      normalized === "guide"
    ) return "method";
    if (
      normalized === "experiment" ||
      normalized === "experiment_note" ||
      normalized === "case_note" ||
      normalized === "case_study"
    ) return "case";
    // module/entry/note → treat as raw (unstructured notes awaiting conversion)
    if (normalized === "module" || normalized === "entry" || normalized === "note") return "raw";
  }

  const normalizedPath = normalizePathForLookup(input.path);
  if (normalizedPath.includes("/01raw/")) return "raw";
  if (normalizedPath.includes("/02insight/") || normalizedPath.includes("/insight/")) return "insight";
  if (normalizedPath.includes("/07doc/") || normalizedPath.includes("/doc/")) return "doc";
  if (normalizedPath.includes("/04debug/") || normalizedPath.includes("/debug/")) return "debug";
  if (normalizedPath.includes("/00system/") || normalizedPath.includes("/system/")) return "system";
  if (normalizedPath.includes("/01theory/") || normalizedPath.includes("/theory/")) return "theory";
  if (normalizedPath.includes("/case/") || normalizedPath.includes("/cases/") || normalizedPath.includes("/issue")) return "case";
  // PARA project notes (01Projects/) often contain module/entry-level notes → treat as raw
  if (normalizedPath.includes("/01projects/") || normalizedPath.includes("/hplc_uplc/")) return "raw";

  const fileName = normalizedPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  if (/(^|[\s._-])raw($|[\s._-]|\d)/.test(fileName)) return "raw";
  if (/(^|[\s._-])insight($|[\s._-]|\d)/.test(fileName)) return "insight";
  if (/(^|[\s._-])theory($|[\s._-]|\d)/.test(fileName)) return "theory";
  if (/(^|[\s._-])case($|[\s._-]|\d)/.test(fileName)) return "case";
  if (/(^|[\s._-])method($|[\s._-]|\d)/.test(fileName)) return "method";
  if (/(^|[\s._-])protocol($|[\s._-]|\d)/.test(fileName)) return "method";
  if (/(^|[\s._-])resource($|[\s._-]|\d)/.test(fileName)) return "method";
  if (/(^|[\s._-])doc($|[\s._-]|\d)/.test(fileName)) return "doc";
  if (/(^|[\s._-])debug($|[\s._-]|\d)/.test(fileName)) return "debug";
  if (/(^|[\s._-])system($|[\s._-]|\d)/.test(fileName)) return "system";

  return undefined;
}

function inferInsightDomain(input: BuildRegistryPromptInput): string {
  const frontmatter = parseSourceFrontmatter(input.content);
  const domain = frontmatter?.domain;
  if (typeof domain === "string" && domain.trim()) {
    return normalizeKey(domain.trim());
  }
  // Fallback: infer from path
  const normalizedPath = normalizePathForLookup(input.path);
  if (normalizedPath.includes("/biotech/")) return "biotech";
  if (normalizedPath.includes("/openclaw/")) return "openclaw";
  if (normalizedPath.includes("/ai/")) return "ai";
  return "general";
}

function inferDomainFromPath(path: string): "biotech" | "openclaw" | "ai" | "general" | undefined {
  const normalizedPath = normalizePathForLookup(path);
  if (normalizedPath.includes("biotech")) return "biotech";
  if (normalizedPath.includes("openclaw")) return "openclaw";
  if (normalizedPath.includes("/ai/") || normalizedPath.includes("02ai")) return "ai";
  if (normalizedPath.includes("general")) return "general";
  return undefined;
}

function schemaDomain(input: BuildRegistryPromptInput): "biotech" | "openclaw" | "ai" | "general" {
  const pathDomain = inferDomainFromPath(input.path);
  if (pathDomain) return pathDomain;
  const inferred = normalizeKey(inferInsightDomain(input));
  if (inferred === "biotech" || inferred === "openclaw" || inferred === "ai" || inferred === "general") return inferred;
  return "general";
}

function inferFixFrontmatterSchemaKey(input: BuildRegistryPromptInput, workflow: ResolvedRewriteWorkflowConfig): string {
  if (workflow.schemaKey?.trim()) return workflow.schemaKey.trim();

  const noteType = inferNoteType(input);
  const domain = schemaDomain(input);
  if (noteType === "raw") return RAW_SCHEMA;
  if (noteType === "insight") return `${domain}_insight_schema`;
  if (noteType === "theory") return domain === "biotech" ? BIOTECH_THEORY_SCHEMA : `${domain}_theory_schema`;
  if (noteType === "case") return domain === "biotech" ? BIOTECH_CASE_SCHEMA : `${domain}_case_schema`;
  if (noteType === "method") return domain === "biotech" ? BIOTECH_METHOD_SCHEMA : `${domain}_method_schema`;
  if (noteType === "doc") return `${domain}_doc_schema`;
  if (noteType === "debug") return `${domain}_debug_schema`;
  if (noteType === "system") return `${domain}_system_schema`;

  throw new Error("Unable to infer target schema for Fix Schema. Add schema to fix_frontmatter workflow or ensure the note has a recognizable type/path.");
}

function resolveRegistryFile(app: App, candidates: string[]): TFile | null {
  const expandedCandidates = candidates.flatMap((candidate) => {
    const normalized = normalizePath(candidate);
    return normalized.endsWith(".md") ? [normalized] : [normalized, `${normalized}.md`];
  });

  for (const candidate of expandedCandidates) {
    const direct = app.vault.getAbstractFileByPath(candidate);
    if (direct instanceof TFile) return direct;
  }

  const normalizedCandidates = expandedCandidates.map(normalizePathForLookup);
  const candidateNames = new Set(expandedCandidates.map((candidate) => basenameOfPath(candidate).toLowerCase()));
  const files = app.vault.getFiles();

  // Obsidian's tree display and internal paths can diverge subtly when vaults
  // are mounted from iCloud or when folders were renamed. Fall back to suffix
  // matching before giving up, but keep it constrained to YAML registry names.
  return (
    files.find((file) => {
      const filePath = normalizePathForLookup(file.path);
      return normalizedCandidates.some((candidate) => filePath === candidate || filePath.endsWith(`/${candidate}`));
    }) ??
    files.find((file) => {
      if (!candidateNames.has(file.name.toLowerCase())) return false;
      return normalizePathForLookup(file.path).includes("/00system/");
    }) ??
    null
  );
}

export async function loadYamlFromVault(app: App, path: string): Promise<RegistryRecord> {
  const normalized = normalizePath(path);
  // Some vaults are rooted at the PARA folder itself. In that case registry
  // files live at 03Resources/... rather than PARA/03Resources/....
  const baseCandidates = normalized.startsWith("PARA/") ? [normalized, normalized.slice("PARA/".length)] : [normalized];
  const candidates = baseCandidates.flatMap((candidate) => {
    // The prompt registry has appeared as both prompt_registry and
    // prompts_registry in local vaults. Treat them as aliases for MVP safety.
    if (candidate.includes("/Prompts/prompt_registry.yaml")) {
      return [candidate, candidate.replace("/Prompts/prompt_registry.yaml", "/Prompts/prompts_registry.yaml")];
    }
    if (candidate.includes("/Prompts/prompts_registry.yaml")) {
      return [candidate, candidate.replace("/Prompts/prompts_registry.yaml", "/Prompts/prompt_registry.yaml")];
    }
    return [candidate];
  });
  const file = resolveRegistryFile(app, candidates);
  if (!(file instanceof TFile)) {
    throw new Error(`Registry file not found. Tried: ${candidates.flatMap((candidate) => [candidate, `${candidate}.md`]).join(", ")}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(await app.vault.cachedRead(file));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML ${normalized}: ${message}`);
  }

  return asRecord(parsed, normalized);
}

function resolveWorkflowName(workflowRegistry: RegistryRecord, spec: WorkflowSpec): string {
  const actionEntry = findRegistryEntry(workflowRegistry, spec.action);
  if (typeof actionEntry === "string" && actionEntry.trim()) return actionEntry.trim();
  if (isRecord(actionEntry)) {
    const workflow = actionEntry.workflow ?? actionEntry.workflow_name ?? actionEntry.workflowName;
    if (typeof workflow === "string" && workflow.trim()) return workflow.trim();
  }

  // MVP fallback allowed by the workflow brief: action mapping may be absent.
  return spec.fallbackWorkflow;
}

function resolveWorkflow(workflowRegistry: RegistryRecord, spec: WorkflowSpec, topic?: string, domain?: string): ResolvedWorkflow {
  const workflowName = resolveWorkflowName(workflowRegistry, spec);
  if (normalizeKey(workflowName) !== normalizeKey(spec.fallbackWorkflow)) {
    throw new Error(`Unsupported workflow for ${spec.action}: ${workflowName}`);
  }

  const workflowEntry = findRegistryEntry(workflowRegistry, workflowName);
  if (!isRecord(workflowEntry)) {
    throw new Error(`Workflow not found in registry: ${workflowName}`);
  }

  // Theory: domain-based (openclaw/ai) takes priority over topic-based (biotech)
  if (spec.action === CONVERT_TO_THEORY_ACTION) {
    // Domain-based theory: openclaw/ai with domain_mapping (no topic needed)
    if (domain && !topic) {
      const resolved = resolveDomainEntry(workflowEntry, domain, workflowName);
      if (resolved) return resolved;
      // Domain was explicitly set but not found in domain_mapping — throw, don't fall through
      const domainMapping = workflowEntry.domain_mapping ?? workflowEntry.domainMapping;
      const available = isRecord(domainMapping) ? Object.keys(domainMapping).join(", ") : "none";
      throw new Error(`Domain "${domain}" is not available for ${spec.action}. Available: ${available}.`);
    }
    // Topic-based theory: biotech SEC/CEX/N_Glycan/etc.
    const selectedTopic = topic?.trim();
    if (!selectedTopic) throw new Error(`Missing topic for ${spec.action}.`);
    const mapping = workflowEntry.topic_mapping ?? workflowEntry.topicMapping;
    if (!isRecord(mapping)) {
      throw new Error(`Workflow ${workflowName} is missing topic_mapping.`);
    }
    const topicEntry = findRegistryEntry(mapping, selectedTopic);
    if (!isRecord(topicEntry)) {
      throw new Error(`Topic mapping not found for ${selectedTopic} in workflow ${workflowName}.`);
    }

    return {
      name: workflowName,
      schemaKey: getStringField(topicEntry, ["schema", "schema_key", "schemaKey"], `schema for topic ${selectedTopic}`),
      promptKey: getStringField(topicEntry, ["prompt", "prompt_key", "promptKey"], `prompt for topic ${selectedTopic}`),
      pathKey: getStringField(topicEntry, ["path_key", "pathKey", "target_path_key", "targetPathKey", "path"], `path_key for topic ${selectedTopic}`),
      filenameStrategy: getOptionalStringField(topicEntry, ["filename_strategy", "filenameStrategy"]) ?? getOptionalStringField(workflowEntry, ["filename_strategy", "filenameStrategy"]),
      backendMode: getOptionalStringField(topicEntry, ["backend_mode", "backendMode"]) ?? getOptionalStringField(workflowEntry, ["backend_mode", "backendMode"]),
      backendSkill: getOptionalStringField(topicEntry, ["backend_skill", "backendSkill"]) ?? getOptionalStringField(workflowEntry, ["backend_skill", "backendSkill"])
    };
  }

  // Case/method: domain-based case (openclaw/ai) takes priority over topic-based;
  // method is currently biotech-only and topic-based.
  if (spec.action === CONVERT_TO_CASE_ACTION || spec.action === NOTE_TO_METHOD_ACTION) {
    // Domain-based case: openclaw/ai with domain_mapping (no topic needed)
    if (spec.action === CONVERT_TO_CASE_ACTION && domain && !topic) {
      const resolved = resolveDomainEntry(workflowEntry, domain, workflowName);
      if (resolved) return resolved;
      // Domain was explicitly set but not found in domain_mapping — throw, don't fall through
      const domainMapping = workflowEntry.domain_mapping ?? workflowEntry.domainMapping;
      const available = isRecord(domainMapping) ? Object.keys(domainMapping).join(", ") : "none";
      throw new Error(`Domain "${domain}" is not available for ${spec.action}. Available: ${available}.`);
    }
    // Topic-based case/method: biotech SEC/CEX/N_Glycan/Uncategorized
    const selectedTopic = topic?.trim();
    if (!selectedTopic) throw new Error(`Missing topic for ${spec.action}.`);
    const mapping = workflowEntry.topic_mapping ?? workflowEntry.topicMapping;
    if (!isRecord(mapping)) {
      throw new Error(`Workflow ${workflowName} is missing topic_mapping.`);
    }
    const topicEntry = findRegistryEntry(mapping, selectedTopic);
    if (!isRecord(topicEntry)) {
      throw new Error(`Topic mapping not found for ${selectedTopic} in workflow ${workflowName}.`);
    }

    return {
      name: workflowName,
      schemaKey: getStringField(topicEntry, ["schema", "schema_key", "schemaKey"], `schema for topic ${selectedTopic}`),
      promptKey: getStringField(topicEntry, ["prompt", "prompt_key", "promptKey"], `prompt for topic ${selectedTopic}`),
      pathKey: getStringField(topicEntry, ["path_key", "pathKey", "target_path_key", "targetPathKey", "path"], `path_key for topic ${selectedTopic}`),
      filenameStrategy: getOptionalStringField(topicEntry, ["filename_strategy", "filenameStrategy"]) ?? getOptionalStringField(workflowEntry, ["filename_strategy", "filenameStrategy"]),
      backendMode: getOptionalStringField(topicEntry, ["backend_mode", "backendMode"]) ?? getOptionalStringField(workflowEntry, ["backend_mode", "backendMode"]),
      backendSkill: getOptionalStringField(topicEntry, ["backend_skill", "backendSkill"]) ?? getOptionalStringField(workflowEntry, ["backend_skill", "backendSkill"])
    };
  }

  // doc/debug/system: use domain_mapping
  if (spec.action === NOTE_TO_DOC_ACTION || spec.action === NOTE_TO_DEBUG_ACTION || spec.action === NOTE_TO_SYSTEM_ACTION) {
    if (!domain) {
      throw new Error(
        `Domain is required for ${spec.action}. ` +
        `Add a domain (openclaw or ai) to the workflow invocation context.`
      );
    }
    const resolved = resolveDomainEntry(workflowEntry, domain, workflowName);
    if (!resolved) {
      const domainMapping = workflowEntry.domain_mapping ?? workflowEntry.domainMapping;
      const available = isRecord(domainMapping) ? Object.keys(domainMapping).join(", ") : "none";
      throw new Error(
        `Domain mapping not found for "${domain}" in workflow ${workflowName}. ` +
        `Available domains: ${available}. ` +
        `Add an entry for "${domain}" in workflow_registry.yaml.`
      );
    }
    return resolved;
  }

  // Insight: check for domain_mapping first, then fall back to top-level fields
  if (spec.action === CONVERT_TO_INSIGHT_ACTION) {
    const resolvedDomain = domain ?? "biotech";
    const resolved = resolveDomainEntry(workflowEntry, resolvedDomain, workflowName);
    if (resolved) return resolved;
    // Fall back to top-level fields (backward compatibility)
  }

  return {
    name: workflowName,
    schemaKey: getStringField(workflowEntry, ["schema", "schema_key", "schemaKey"], `schema for workflow ${workflowName}`),
    promptKey: getStringField(workflowEntry, ["prompt", "prompt_key", "promptKey"], `prompt for workflow ${workflowName}`),
    pathKey: getStringField(workflowEntry, ["path_key", "pathKey", "target_path_key", "targetPathKey", "path"], `path_key for workflow ${workflowName}`),
    filenameStrategy: getOptionalStringField(workflowEntry, ["filename_strategy", "filenameStrategy"]),
    backendMode: getOptionalStringField(workflowEntry, ["backend_mode", "backendMode"]),
    backendSkill: getOptionalStringField(workflowEntry, ["backend_skill", "backendSkill"])
  };
}

function resolveSchema(schemaRegistry: RegistryRecord, schemaKey: string, spec: WorkflowSpec): ResolvedSchema {
  if (spec.action === CONVERT_TO_INSIGHT_ACTION) {
    if (isInsightSchemaKey(schemaKey)) return resolveSchemaDetails(schemaRegistry, schemaKey);
    throw new Error(`Unsupported insight schema: ${schemaKey}. Expected a schema key containing "insight" and "schema".`);
  }
  if (spec.action === NOTE_TO_DOC_ACTION) {
    if (isDocSchemaKey(schemaKey)) return resolveSchemaDetails(schemaRegistry, schemaKey);
    throw new Error(`Unsupported doc schema: ${schemaKey}. Expected a schema key containing "doc" and "schema".`);
  }
  if (spec.action === NOTE_TO_DEBUG_ACTION) {
    if (isDebugSchemaKey(schemaKey)) return resolveSchemaDetails(schemaRegistry, schemaKey);
    throw new Error(`Unsupported debug schema: ${schemaKey}. Expected a schema key containing "debug" and "schema".`);
  }
  if (spec.action === NOTE_TO_SYSTEM_ACTION) {
    if (isSystemSchemaKey(schemaKey)) return resolveSchemaDetails(schemaRegistry, schemaKey);
    throw new Error(`Unsupported system schema: ${schemaKey}. Expected a schema key containing "system" and "schema".`);
  }
  // For theory/case/method, schemaKey comes from topic_mapping and differs per topic.
  // Skip spec.schemaKey validation since spec only carries a fallback/default value.
  // resolveSchemaDetails will throw if the key doesn't exist in schema_registry.
  if (spec.action !== CONVERT_TO_THEORY_ACTION && spec.action !== CONVERT_TO_CASE_ACTION && spec.action !== NOTE_TO_METHOD_ACTION) {
    if (normalizeKey(schemaKey) !== normalizeKey(spec.schemaKey)) {
      throw new Error(`Unsupported schema for ${spec.action}: ${schemaKey}`);
    }
  }
  return resolveSchemaDetails(schemaRegistry, schemaKey);
}

function resolveSchemaDetails(schemaRegistry: RegistryRecord, schemaKey: string): ResolvedSchema {
  const schemaEntry = findRegistryEntry(schemaRegistry, schemaKey);
  if (!isRecord(schemaEntry)) throw new Error(`Schema not found in registry: ${schemaKey}`);

  return {
    requiredFrontmatter: requireField(schemaEntry, ["required_frontmatter", "requiredFrontmatter"], `required_frontmatter for schema ${schemaKey}`),
    fixedValues: requireField(schemaEntry, ["fixed_values", "fixedValues"], `fixed_values for schema ${schemaKey}`),
    optionalFrontmatter: getOptionalField(schemaEntry, ["optional_frontmatter", "optionalFrontmatter", "optional_fields", "optionalFields"]),
    bodySections: requireField(schemaEntry, ["body_sections", "bodySections", "sections"], `body_sections for schema ${schemaKey}`)
  };
}

function resolvePrompt(promptRegistry: RegistryRecord, promptKey: string, spec: WorkflowSpec): ResolvedPrompt {
  if (spec.action === CONVERT_TO_INSIGHT_ACTION) {
    if (isInsightPromptKey(promptKey)) return resolvePromptDetails(promptRegistry, promptKey);
    throw new Error(`Unsupported insight prompt: ${promptKey}. Expected a prompt key containing "insight".`);
  }
  if (spec.action === NOTE_TO_DOC_ACTION) {
    if (isDocPromptKey(promptKey)) return resolvePromptDetails(promptRegistry, promptKey);
    throw new Error(`Unsupported doc prompt: ${promptKey}. Expected a prompt key containing "doc".`);
  }
  if (spec.action === NOTE_TO_DEBUG_ACTION) {
    if (isDebugPromptKey(promptKey)) return resolvePromptDetails(promptRegistry, promptKey);
    throw new Error(`Unsupported debug prompt: ${promptKey}. Expected a prompt key containing "debug".`);
  }
  if (spec.action === NOTE_TO_SYSTEM_ACTION) {
    if (isSystemPromptKey(promptKey)) return resolvePromptDetails(promptRegistry, promptKey);
    throw new Error(`Unsupported system prompt: ${promptKey}. Expected a prompt key containing "system".`);
  }
  // For theory/case/method, promptKey comes from topic_mapping and differs per topic.
  // Skip spec.promptKey validation since spec only carries a fallback/default value.
  // resolvePromptDetails will throw if the key doesn't exist in prompt_registry.
  if (spec.action !== CONVERT_TO_THEORY_ACTION && spec.action !== CONVERT_TO_CASE_ACTION && spec.action !== NOTE_TO_METHOD_ACTION) {
    if (normalizeKey(promptKey) !== normalizeKey(spec.promptKey)) {
      throw new Error(`Unsupported prompt for ${spec.action}: ${promptKey}`);
    }
  }
  return resolvePromptDetails(promptRegistry, promptKey);
}

function resolvePromptDetails(promptRegistry: RegistryRecord, promptKey: string): ResolvedPrompt {
  const promptEntry = findRegistryEntry(promptRegistry, promptKey);
  if (!isRecord(promptEntry)) throw new Error(`Prompt not found in registry: ${promptKey}`);
  return {
    purpose: requireField(promptEntry, ["purpose"], `purpose for prompt ${promptKey}`),
    constraints: requireField(promptEntry, ["constraints"], `constraints for prompt ${promptKey}`),
    outputStyle: requireField(promptEntry, ["output_style", "outputStyle"], `output_style for prompt ${promptKey}`)
  };
}

function resolveTargetDir(pathMapping: RegistryRecord, pathKey: string, spec: WorkflowSpec): string {
  if (spec.action === CONVERT_TO_INSIGHT_ACTION) {
    if (isInsightPathKey(pathKey)) return resolvePathEntry(pathMapping, pathKey);
    throw new Error(`Unsupported insight path_key: ${pathKey}. Expected a path key starting with "insight_".`);
  }
  if (spec.action === NOTE_TO_DOC_ACTION) {
    if (isDocPathKey(pathKey)) return resolvePathEntry(pathMapping, pathKey);
    throw new Error(`Unsupported doc path_key: ${pathKey}. Expected a path key containing "doc".`);
  }
  if (spec.action === NOTE_TO_DEBUG_ACTION) {
    if (isDebugPathKey(pathKey)) return resolvePathEntry(pathMapping, pathKey);
    throw new Error(`Unsupported debug path_key: ${pathKey}. Expected a path key containing "debug".`);
  }
  if (spec.action === NOTE_TO_SYSTEM_ACTION) {
    if (isSystemPathKey(pathKey)) return resolvePathEntry(pathMapping, pathKey);
    throw new Error(`Unsupported system path_key: ${pathKey}. Expected a path key containing "system".`);
  }
  // For theory/case/method, pathKey comes from topic_mapping and differs per topic.
  // Skip spec.pathKey validation since spec only carries a fallback/default value.
  // resolvePathEntry will throw if the key doesn't exist in path_mapping.
  if (spec.action !== CONVERT_TO_THEORY_ACTION && spec.action !== CONVERT_TO_CASE_ACTION && spec.action !== NOTE_TO_METHOD_ACTION) {
    if (normalizeKey(pathKey) !== normalizeKey(spec.pathKey)) {
      throw new Error(`Unsupported path_key for ${spec.action}: ${pathKey}`);
    }
  }
  return resolvePathEntry(pathMapping, pathKey);
}

function resolvePathEntry(pathMapping: RegistryRecord, pathKey: string): string {
  const entry = findRegistryEntry(pathMapping, pathKey);
  const rawPath =
    typeof entry === "string"
      ? entry
      : isRecord(entry)
        ? getStringField(entry, ["path", "target", "target_path", "targetPath", "base", "base_path", "basePath"], `target path for ${pathKey}`)
        : "";

  const targetDir = normalizePath(rawPath.trim());
  if (!targetDir) throw new Error(`Missing target path for ${pathKey}`);
  return targetDir.replace(/\/$/, "");
}

function resolveRewriteWorkflowConfig(workflowRegistry: RegistryRecord): ResolvedRewriteWorkflowConfig {
  const actionEntry = findRegistryEntry(workflowRegistry, REWRITE_CURRENT_NOTE_ACTION);
  const workflowName =
    typeof actionEntry === "string"
      ? actionEntry.trim()
      : isRecord(actionEntry) && typeof (actionEntry.workflow ?? actionEntry.workflow_name ?? actionEntry.workflowName) === "string"
        ? String(actionEntry.workflow ?? actionEntry.workflow_name ?? actionEntry.workflowName).trim()
        : REWRITE_CURRENT_NOTE_WORKFLOW;

  if (normalizeKey(workflowName) !== normalizeKey(REWRITE_CURRENT_NOTE_WORKFLOW)) {
    throw new Error(`Unsupported workflow for ${REWRITE_CURRENT_NOTE_ACTION}: ${workflowName}`);
  }

  const workflowEntry = findRegistryEntry(workflowRegistry, workflowName);
  if (!isRecord(workflowEntry)) {
    throw new Error(`Workflow not found in registry: ${workflowName}`);
  }

  const executorAction = getOptionalStringField(workflowEntry, ["executor_action", "executorAction"]) ?? REPLACE_CURRENT_NOTE_EXECUTOR;
  if (executorAction !== REPLACE_CURRENT_NOTE_EXECUTOR) {
    throw new Error(`Workflow ${workflowName} must use executor_action: ${REPLACE_CURRENT_NOTE_EXECUTOR}.`);
  }

  const schemaMode = getOptionalStringField(workflowEntry, ["schema_mode", "schemaMode"]) ?? PRESERVE_CURRENT_SCHEMA_MODE;
  if (schemaMode !== PRESERVE_CURRENT_SCHEMA_MODE) {
    throw new Error(`Workflow ${workflowName} must use schema_mode: ${PRESERVE_CURRENT_SCHEMA_MODE}.`);
  }

  return {
    name: workflowName,
    promptKey: getStringField(workflowEntry, ["prompt", "prompt_key", "promptKey"], `prompt for workflow ${workflowName}`),
    executorAction,
    filenameStrategy: getOptionalStringField(workflowEntry, ["filename_strategy", "filenameStrategy"]),
    schemaMode,
    schemaKey: getOptionalStringField(workflowEntry, ["schema", "schema_key", "schemaKey"])
  };
}

function resolveFixFrontmatterWorkflowConfig(workflowRegistry: RegistryRecord): ResolvedRewriteWorkflowConfig {
  const actionEntry = findRegistryEntry(workflowRegistry, FIX_FRONTMATTER_ACTION);
  const workflowName =
    typeof actionEntry === "string"
      ? actionEntry.trim()
      : isRecord(actionEntry) && typeof (actionEntry.workflow ?? actionEntry.workflow_name ?? actionEntry.workflowName) === "string"
        ? String(actionEntry.workflow ?? actionEntry.workflow_name ?? actionEntry.workflowName).trim()
        : FIX_FRONTMATTER_WORKFLOW;

  if (normalizeKey(workflowName) !== normalizeKey(FIX_FRONTMATTER_WORKFLOW)) {
    throw new Error(`Unsupported workflow for ${FIX_FRONTMATTER_ACTION}: ${workflowName}`);
  }

  const workflowEntry = findRegistryEntry(workflowRegistry, workflowName);
  if (!isRecord(workflowEntry)) {
    throw new Error(`Workflow not found in registry: ${workflowName}`);
  }

  const executorAction = getOptionalStringField(workflowEntry, ["executor_action", "executorAction"]) ?? REPLACE_CURRENT_NOTE_EXECUTOR;
  if (executorAction !== REPLACE_CURRENT_NOTE_EXECUTOR) {
    throw new Error(`Workflow ${workflowName} must use executor_action: ${REPLACE_CURRENT_NOTE_EXECUTOR}.`);
  }

  const schemaMode = getOptionalStringField(workflowEntry, ["schema_mode", "schemaMode"]) ?? REPAIR_CURRENT_SCHEMA_MODE;
  if (schemaMode !== REPAIR_CURRENT_SCHEMA_MODE) {
    throw new Error(`Workflow ${workflowName} must use schema_mode: ${REPAIR_CURRENT_SCHEMA_MODE}.`);
  }

  return {
    name: workflowName,
    promptKey: getStringField(workflowEntry, ["prompt", "prompt_key", "promptKey"], `prompt for workflow ${workflowName}`),
    executorAction,
    filenameStrategy: getOptionalStringField(workflowEntry, ["filename_strategy", "filenameStrategy"]),
    schemaMode,
    schemaKey: getOptionalStringField(workflowEntry, ["schema", "schema_key", "schemaKey"])
  };
}

function formatFixedValueRules(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
}

export function buildRegistryPrompt(input: BuildRegistryPromptInput, workflow: ResolvedWorkflow, schema: ResolvedSchema, prompt: ResolvedPrompt, spec: WorkflowSpec): string {
  if (!input.content.trim()) throw new Error("Current note content is empty");

  return [
    `Role: ${spec.role}`,
    "",
    `Task: ${spec.task}`,
    "",
    `Workflow: ${workflow.name}`,
    "",
    "Purpose:",
    formatYamlish(prompt.purpose),
    "",
    "Constraints:",
    formatYamlish(prompt.constraints),
    "",
    "Output style:",
    formatYamlish(prompt.outputStyle),
    "",
    "Required frontmatter:",
    formatYamlish(schema.requiredFrontmatter),
    "",
    "Fixed frontmatter values:",
    formatYamlish(schema.fixedValues),
    "",
    "Frontmatter rewrite rules:",
    "- Do not copy or inherit the source note frontmatter.",
    `- Generate a new frontmatter block for the target ${spec.targetLabel} note.`,
    "- The final frontmatter must include these exact fixed values:",
    formatFixedValueRules(spec.requiredFixedValues),
    `- Tags must not include: ${spec.blockedTags.join(", ")}.`,
    "- Do not add source-note system tags unless the generated note is actually about that topic.",
    "",
    "Required body sections:",
    formatYamlish(schema.bodySections),
    "",
    "Input note:",
    `Title: ${input.title}`,
    `Path: ${input.path}`,
    ...(input.domain ? [`Domain: ${input.domain}`] : []),
    ...(input.topic ? [`Topic: ${input.topic}`] : []),
    "",
    "Content:",
    input.content,
    "",
    "Return only the final markdown document. Do not include explanations outside the markdown."
  ].join("\n");
}

export function buildRewritePrompt(input: BuildRegistryPromptInput, workflow: ResolvedRewriteWorkflowConfig, prompt: ResolvedPrompt): string {
  if (!input.content.trim()) throw new Error("Current note content is empty");

  return [
    "System Instruction:",
    "Rewrite the current Obsidian note into a clearer, more structured, more professional version.",
    "This is an edit-in-place workflow, not a create-new-note workflow.",
    "",
    `Workflow: ${workflow.name}`,
    `Executor action: ${workflow.executorAction}`,
    `Schema mode: ${workflow.schemaMode ?? PRESERVE_CURRENT_SCHEMA_MODE}`,
    "",
    "Purpose:",
    formatYamlish(prompt.purpose),
    "",
    "Constraints:",
    formatYamlish(prompt.constraints),
    "",
    "Output style:",
    formatYamlish(prompt.outputStyle),
    "",
    "Rewrite rules:",
    "- Return the full rewritten markdown document.",
    "- Preserve valid YAML frontmatter unless it is clearly malformed.",
    "- Do not change the note type unless the user explicitly asks for that.",
    "- Preserve the core meaning of the source note.",
    "- Improve clarity, structure, headings, flow, and professional wording.",
    "- Do not include explanations outside the final markdown.",
    "",
    "Current note metadata:",
    `Title: ${input.title}`,
    `Path: ${input.path}`,
    "",
    "Current note markdown:",
    input.content,
    "",
    "Return only the complete rewritten markdown."
  ].join("\n");
}

export function buildFixFrontmatterPrompt(
  input: BuildRegistryPromptInput,
  workflow: ResolvedRewriteWorkflowConfig,
  prompt: ResolvedPrompt,
  schemaKey: string,
  schema: ResolvedSchema
): string {
  if (!input.content.trim()) throw new Error("Current note content is empty");
  const allowedFields = schemaAllowedFrontmatterFields(schema);

  return [
    "System Instruction:",
    "Strictly repair the current Obsidian note so that its YAML frontmatter conforms to the target schema.",
    "This is an edit-in-place workflow, not a create-new-note workflow.",
    "The goal is schema compliance, not general metadata enrichment.",
    "",
    `Workflow: ${workflow.name}`,
    `Executor action: ${workflow.executorAction}`,
    `Schema mode: ${workflow.schemaMode ?? REPAIR_CURRENT_SCHEMA_MODE}`,
    `Target schema: ${schemaKey}`,
    "",
    "Purpose:",
    formatYamlish(prompt.purpose),
    "",
    "Constraints:",
    formatYamlish(prompt.constraints),
    "",
    "Output style:",
    formatYamlish(prompt.outputStyle),
    "",
    "Target schema required_frontmatter:",
    formatYamlish(schema.requiredFrontmatter),
    "",
    "Target schema fixed_values:",
    formatYamlish(schema.fixedValues),
    "",
    "Target schema optional_frontmatter:",
    schema.optionalFrontmatter === undefined ? "- none" : formatYamlish(schema.optionalFrontmatter),
    "- created",
    "",
    "Allowed frontmatter fields:",
    allowedFields.length ? allowedFields.map((field) => `- ${field}`).join("\n") : "- Use only fields listed in required_frontmatter, fixed_values, and optional_frontmatter.",
    "",
    "Strict schema repair rules:",
    "- Only use fields that are defined by the target schema.",
    "- Do not invent new frontmatter fields.",
    "- Do not add aliases unless aliases is explicitly part of the target schema allowed fields.",
    "- Remove schema-external frontmatter fields unless the target schema explicitly allows them.",
    "- Add missing required fields when inferable with high confidence.",
    "- Apply schema fixed values when appropriate.",
    "- Keep existing valid metadata when possible.",
    "- Correct inconsistent metadata when it is clearly inferable from the note path, body, or target schema.",
    "- If the note path clearly indicates a domain such as AI, OpenClaw, Biotech, or General, prefer that domain over stale frontmatter.",
    "- Do not add topic unless the target schema explicitly requires topic; non-biotech theory/case schemas should not receive biotech topic metadata.",
    ...FIX_FRONTMATTER_DATE_RULES.map((rule) => `- ${rule}`),
    "- Preserve the body content as much as possible.",
    "- Do not rewrite the note body unless strictly necessary.",
    "- Return the full corrected markdown note, including frontmatter and body.",
    "- Do not include explanations outside the final markdown.",
    "",
    "Current note metadata:",
    `Title: ${input.title}`,
    `Path: ${input.path}`,
    "",
    "Current note markdown:",
    input.content,
    "",
    "Return only the complete corrected markdown."
  ].join("\n");
}

export function buildInsightPrompt(input: BuildInsightPromptInput, workflow: ResolvedWorkflow, schema: ResolvedSchema, prompt: ResolvedPrompt, domain: InsightDomain = "biotech"): string {
  return buildRegistryPrompt(input, workflow, schema, prompt, createInsightSpec(domain));
}

async function resolveRegistryWorkflow(app: App, input: BuildRegistryPromptInput, spec: WorkflowSpec): Promise<ResolvedRegistryWorkflow> {
  const [workflowRegistry, schemaRegistry, promptRegistry, pathMapping] = await Promise.all([
    registryCache.getWorkflowRegistry(app),
    registryCache.getSchemaRegistry(app),
    registryCache.getPromptRegistry(app),
    registryCache.getPathMapping(app)
  ]);

  // Domain may come from input (BuildInsightPromptInput) or spec.requiredFixedValues (createOpenClawCaseSpec)
  const inputDomain = (input as BuildInsightPromptInput).domain;
  const specDomain = typeof spec.requiredFixedValues === "object" && spec.requiredFixedValues !== null
    ? (spec.requiredFixedValues as Record<string, unknown>).domain as string | undefined
    : undefined;
  const domain = inputDomain ?? specDomain;
  const workflow = resolveWorkflow(workflowRegistry, spec, input.topic, domain);
  const schema = resolveSchema(schemaRegistry, workflow.schemaKey, spec);
  const promptConfig = resolvePrompt(promptRegistry, workflow.promptKey, spec);
  const targetDir = resolveTargetDir(pathMapping, workflow.pathKey, spec);

  return {
    workflow,
    targetDir,
    prompt: buildRegistryPrompt(input, workflow, schema, promptConfig, spec)
  };
}

export async function resolveInsightWorkflow(app: App, input: BuildInsightPromptInput, domain: InsightDomain = "biotech"): Promise<ResolvedInsightWorkflow> {
  return resolveRegistryWorkflow(app, input, createInsightSpec(domain));
}

export async function resolveTheoryWorkflow(app: App, input: BuildRegistryPromptInput, topic: TheoryTopic | string): Promise<ResolvedRegistryWorkflow> {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) throw new Error("Missing theory topic.");
  return resolveRegistryWorkflow(app, { ...input, topic: normalizedTopic }, createTheorySpec(normalizedTopic));
}

// openclaw/ai theory use domain_mapping, no topic needed
export async function resolveTheoryByDomainWorkflow(app: App, input: BuildRegistryPromptInput, domain: TheoryDomain): Promise<ResolvedRegistryWorkflow> {
  return resolveRegistryWorkflow(app, input, createTheoryByDomainSpec(domain));
}

export async function resolveCaseWorkflow(app: App, input: BuildRegistryPromptInput, topic: CaseTopic | string): Promise<ResolvedRegistryWorkflow> {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) throw new Error("Missing case topic.");
  return resolveRegistryWorkflow(app, { ...input, topic: normalizedTopic }, createCaseSpec(normalizedTopic));
}

export async function resolveMethodWorkflow(app: App, input: BuildRegistryPromptInput, topic: MethodTopic | string): Promise<ResolvedRegistryWorkflow> {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) throw new Error("Missing method topic.");
  return resolveRegistryWorkflow(app, { ...input, topic: normalizedTopic }, createMethodSpec(normalizedTopic));
}

// openclaw/ai cases use domain_mapping, no topic needed
export async function resolveCaseByDomainWorkflow(app: App, input: BuildRegistryPromptInput, domain: DocDomain | DebugDomain): Promise<ResolvedRegistryWorkflow> {
  return resolveRegistryWorkflow(app, input, createOpenClawCaseSpec(domain));
}

export async function resolveDocWorkflow(app: App, input: BuildRegistryPromptInput, domain: DocDomain): Promise<ResolvedRegistryWorkflow> {
  return resolveRegistryWorkflow(app, input, createDocSpec(domain));
}

export async function resolveDebugWorkflow(app: App, input: BuildRegistryPromptInput, domain: DebugDomain): Promise<ResolvedRegistryWorkflow> {
  return resolveRegistryWorkflow(app, input, createDebugSpec(domain));
}

export async function resolveSystemWorkflow(app: App, input: BuildRegistryPromptInput, domain: SystemDomain): Promise<ResolvedRegistryWorkflow> {
  return resolveRegistryWorkflow(app, input, createSystemSpec(domain));
}

export async function resolveRawSkillWorkflow(app: App): Promise<ResolvedRawSkillWorkflow> {
  const [workflowRegistry, pathMapping] = await Promise.all([
    registryCache.getWorkflowRegistry(app),
    registryCache.getPathMapping(app)
  ]);

  const workflow = resolveWorkflow(workflowRegistry, RAW_SKILL_SPEC);
  // backendMode is now either openclaw_skill (legacy) or local_script (wechat-to-obsidian.py)
  if (!workflow.backendSkill?.trim()) {
    throw new Error(`Workflow ${workflow.name} is missing backend_skill.`);
  }

  return {
    workflow,
    targetDir: resolveTargetDir(pathMapping, workflow.pathKey, RAW_SKILL_SPEC),
    backendSkill: workflow.backendSkill
  };
}

export async function resolveRewriteWorkflow(app: App, input: BuildRegistryPromptInput): Promise<ResolvedRewriteWorkflow> {
  const [workflowRegistry, promptRegistry] = await Promise.all([
    registryCache.getWorkflowRegistry(app),
    registryCache.getPromptRegistry(app)
  ]);

  const workflow = resolveRewriteWorkflowConfig(workflowRegistry);
  if (normalizeKey(workflow.promptKey) !== normalizeKey(REWRITE_NOTE_PROMPT)) {
    throw new Error(`Unsupported prompt for ${REWRITE_CURRENT_NOTE_ACTION}: ${workflow.promptKey}`);
  }
  const promptConfig = resolvePrompt(promptRegistry, workflow.promptKey, {
    action: REWRITE_CURRENT_NOTE_ACTION,
    fallbackWorkflow: REWRITE_CURRENT_NOTE_WORKFLOW,
    schemaKey: "",
    promptKey: REWRITE_NOTE_PROMPT,
    pathKey: "",
    role: "rewrite assistant",
    task: "Rewrite current note",
    targetLabel: "updated_note",
    requiredFixedValues: {},
    blockedTags: []
  });

  return {
    workflow,
    prompt: buildRewritePrompt(input, workflow, promptConfig)
  };
}

export async function resolveFixFrontmatterWorkflow(app: App, input: BuildRegistryPromptInput): Promise<ResolvedFixFrontmatterWorkflow> {
  const [workflowRegistry, schemaRegistry, promptRegistry] = await Promise.all([
    registryCache.getWorkflowRegistry(app),
    registryCache.getSchemaRegistry(app),
    registryCache.getPromptRegistry(app)
  ]);

  const workflow = resolveFixFrontmatterWorkflowConfig(workflowRegistry);
  if (normalizeKey(workflow.promptKey) !== normalizeKey(FIX_FRONTMATTER_PROMPT)) {
    throw new Error(`Unsupported prompt for ${FIX_FRONTMATTER_ACTION}: ${workflow.promptKey}`);
  }
  const schemaKey = inferFixFrontmatterSchemaKey(input, workflow);
  // Fix Schema is intentionally schema-driven: the prompt receives the exact
  // target field list so the model repairs metadata instead of inventing
  // generic Obsidian fields such as aliases.
  const schema = resolveSchemaDetails(schemaRegistry, schemaKey);
  const promptConfig = resolvePrompt(promptRegistry, workflow.promptKey, {
    action: FIX_FRONTMATTER_ACTION,
    fallbackWorkflow: FIX_FRONTMATTER_WORKFLOW,
    schemaKey,
    promptKey: FIX_FRONTMATTER_PROMPT,
    pathKey: "",
    role: "frontmatter repair assistant",
    task: "Repair current note frontmatter",
    targetLabel: "updated_note",
    requiredFixedValues: {},
    blockedTags: []
  });

  return {
    workflow,
    schemaKey,
    prompt: buildFixFrontmatterPrompt(input, workflow, promptConfig, schemaKey, schema)
  };
}
