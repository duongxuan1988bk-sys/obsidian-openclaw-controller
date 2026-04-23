import { normalizePath, parseYaml, TFile, type App } from "obsidian";
import { FIX_FRONTMATTER_DATE_RULES } from "./frontmatterDateRules";

export const WORKFLOW_REGISTRY_PATH = "PARA/03Resources/00System/Workflow Registry/workflow_registry.yaml";
export const SCHEMA_REGISTRY_PATH = "PARA/03Resources/00System/Schema/schema_registry.yaml";
export const PROMPT_REGISTRY_PATH = "PARA/03Resources/00System/Prompts/prompt_registry.yaml";
export const PATH_MAPPING_PATH = "PARA/03Resources/00System/Path Mapping/path_mapping.yaml";

type RegistryRecord = Record<string, unknown>;

const DEFAULT_WORKFLOW_REGISTRY: RegistryRecord = {
  workflows: {
    wechat_to_raw: {
      input_types: ["wechat_url"],
      output_type: "raw",
      schema: "raw_schema",
      prompt: "wechat_to_raw_prompt",
      path_key: "raw_wechat",
      executor_action: "create_new_note",
      filename_strategy: "source_based",
      backend_mode: "local_script",
      backend_skill: "wechat-to-obsidian"
    },
    rewrite_current_note: {
      input_types: ["current_note"],
      output_type: "updated_note",
      prompt: "rewrite_note_prompt",
      executor_action: "replace_current_note",
      filename_strategy: "keep_current",
      schema_mode: "preserve_current"
    },
    fix_frontmatter: {
      input_types: ["current_note"],
      output_type: "updated_note",
      prompt: "fix_frontmatter_prompt",
      executor_action: "replace_current_note",
      filename_strategy: "keep_current",
      schema_mode: "repair_current"
    }
  }
};

const DEFAULT_SCHEMA_REGISTRY: RegistryRecord = {
  schemas: {
    raw_schema: {
      required_frontmatter: ["type", "status", "date", "tags", "source", "domain", "workflow"],
      fixed_values: { type: "raw", status: "draft" },
      optional_frontmatter: ["title"],
      body_sections: ["Source", "Original Content"]
    },
    general_insight_schema: {
      required_frontmatter: ["type", "status", "date", "tags", "source", "domain", "workflow"],
      fixed_values: { type: "insight", status: "draft", workflow: "raw_to_insight" },
      optional_frontmatter: ["title"],
      body_sections: ["Summary", "Key Points", "Notes", "Related Notes"]
    },
    openclaw_insight_schema: {
      required_frontmatter: ["type", "status", "date", "tags", "source", "domain", "workflow"],
      fixed_values: { type: "insight", status: "draft", domain: "openclaw", workflow: "raw_to_insight" },
      optional_frontmatter: ["title"],
      body_sections: ["Summary", "Key Points", "Notes", "Related Notes"]
    },
    ai_insight_schema: {
      required_frontmatter: ["type", "status", "date", "tags", "source", "domain", "workflow"],
      fixed_values: { type: "insight", status: "draft", domain: "ai", workflow: "raw_to_insight" },
      optional_frontmatter: ["title"],
      body_sections: ["Summary", "Key Points", "Notes", "Related Notes"]
    }
  }
};

const DEFAULT_PROMPT_REGISTRY: RegistryRecord = {
  prompts: {
    wechat_to_raw_prompt: {
      purpose: "convert a WeChat URL into a raw Obsidian note using the local extraction script",
      constraints: [
        "preserve the original source content as much as possible",
        "output a raw note only",
        "do not add analysis beyond minimal structure"
      ],
      output_style: "raw_capture"
    },
    rewrite_note_prompt: {
      purpose: "rewrite the current note into a clearer, more structured version",
      constraints: [
        "preserve factual meaning",
        "improve clarity and organization",
        "do not invent unsupported details"
      ],
      output_style: "structured_rewrite"
    },
    fix_frontmatter_prompt: {
      purpose: "repair the current note so its frontmatter matches the target schema",
      constraints: [
        "focus on schema compliance",
        "do not rewrite the body unless required for structural validity",
        "preserve existing meaning"
      ],
      output_style: "schema_repair"
    }
  }
};

const DEFAULT_PATH_MAPPING: RegistryRecord = {
  paths: {
    raw_wechat: "PARA/03Resources/01Raw/WeChat/"
  }
};

type ResolvedWorkflow = {
  name: string;
  schemaKey: string;
  promptKey: string;
  pathKey: string;
  filenameStrategy?: string;
  backendMode?: string;
  backendSkill?: string;
};

type ResolvedPrompt = {
  purpose: unknown;
  constraints: unknown;
  outputStyle: unknown;
};

export type BuildRegistryPromptInput = {
  title: string;
  path: string;
  content: string;
  topic?: string;
  domain?: string;
};

export type ResolvedRawSkillWorkflow = {
  workflow: ResolvedWorkflow;
  targetDir: string;
  backendSkill: string;
};

export type ResolvedRewriteWorkflowConfig = {
  name: string;
  promptKey: string;
  executorAction: string;
  filenameStrategy?: string;
  schemaMode?: string;
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

function isRecord(value: unknown): value is RegistryRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function getOptionalStringField(record: RegistryRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function getStringField(record: RegistryRecord, keys: string[], label: string): string {
  const value = getOptionalStringField(record, keys);
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function getField(record: RegistryRecord, keys: string[], label: string): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  throw new Error(`Missing ${label}`);
}

function findRegistryEntry(root: RegistryRecord, key: string): unknown {
  const normalized = normalizeKey(key);
  const direct = root[key] ?? root[normalized];
  if (direct !== undefined) return direct;

  for (const containerKey of ["workflows", "schemas", "prompts", "paths"]) {
    const container = root[containerKey];
    if (!isRecord(container)) continue;
    const nested = container[key] ?? container[normalized];
    if (nested !== undefined) return nested;
  }

  return undefined;
}

function formatYamlish(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => `- ${String(item)}`).join("\n") : "- none";
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join("\n");
  }
  return String(value ?? "");
}

function resolveRegistryFile(app: App, path: string): TFile | null {
  const normalized = normalizePath(path);
  const candidates = normalized.startsWith("PARA/")
    ? [normalized, normalized.slice("PARA/".length)]
    : [normalized];

  for (const candidate of candidates) {
    const direct = app.vault.getAbstractFileByPath(candidate);
    if (direct instanceof TFile) return direct;
    const markdown = app.vault.getAbstractFileByPath(`${candidate}.md`);
    if (markdown instanceof TFile) return markdown;
  }
  return null;
}

async function loadRegistry(app: App, path: string): Promise<RegistryRecord> {
  const file = resolveRegistryFile(app, path);
  if (!file) {
    if (path === WORKFLOW_REGISTRY_PATH) return DEFAULT_WORKFLOW_REGISTRY;
    if (path === SCHEMA_REGISTRY_PATH) return DEFAULT_SCHEMA_REGISTRY;
    if (path === PROMPT_REGISTRY_PATH) return DEFAULT_PROMPT_REGISTRY;
    if (path === PATH_MAPPING_PATH) return DEFAULT_PATH_MAPPING;
    throw new Error(`Registry file not found: ${path}`);
  }

  const parsed = parseYaml(await app.vault.cachedRead(file));
  if (!isRecord(parsed)) {
    throw new Error(`Registry must be a YAML object: ${path}`);
  }
  return parsed;
}

function resolveRawWorkflow(workflowRegistry: RegistryRecord): ResolvedWorkflow {
  const entry = findRegistryEntry(workflowRegistry, "wechat_to_raw");
  if (!isRecord(entry)) throw new Error("Workflow not found: wechat_to_raw");
  return {
    name: "wechat_to_raw",
    schemaKey: getStringField(entry, ["schema", "schema_key", "schemaKey"], "schema for wechat_to_raw"),
    promptKey: getStringField(entry, ["prompt", "prompt_key", "promptKey"], "prompt for wechat_to_raw"),
    pathKey: getStringField(entry, ["path_key", "pathKey", "target_path_key", "targetPathKey"], "path_key for wechat_to_raw"),
    filenameStrategy: getOptionalStringField(entry, ["filename_strategy", "filenameStrategy"]),
    backendMode: getOptionalStringField(entry, ["backend_mode", "backendMode"]),
    backendSkill: getOptionalStringField(entry, ["backend_skill", "backendSkill"])
  };
}

function resolveRewriteWorkflowConfig(workflowRegistry: RegistryRecord): ResolvedRewriteWorkflowConfig {
  const entry = findRegistryEntry(workflowRegistry, "rewrite_current_note");
  if (!isRecord(entry)) throw new Error("Workflow not found: rewrite_current_note");
  return {
    name: "rewrite_current_note",
    promptKey: getStringField(entry, ["prompt", "prompt_key", "promptKey"], "prompt for rewrite_current_note"),
    executorAction: getStringField(entry, ["executor_action", "executorAction"], "executor_action for rewrite_current_note"),
    filenameStrategy: getOptionalStringField(entry, ["filename_strategy", "filenameStrategy"]),
    schemaMode: getOptionalStringField(entry, ["schema_mode", "schemaMode"])
  };
}

function resolveFixWorkflowConfig(workflowRegistry: RegistryRecord): ResolvedRewriteWorkflowConfig {
  const entry = findRegistryEntry(workflowRegistry, "fix_frontmatter");
  if (!isRecord(entry)) throw new Error("Workflow not found: fix_frontmatter");
  return {
    name: "fix_frontmatter",
    promptKey: getStringField(entry, ["prompt", "prompt_key", "promptKey"], "prompt for fix_frontmatter"),
    executorAction: getStringField(entry, ["executor_action", "executorAction"], "executor_action for fix_frontmatter"),
    filenameStrategy: getOptionalStringField(entry, ["filename_strategy", "filenameStrategy"]),
    schemaMode: getOptionalStringField(entry, ["schema_mode", "schemaMode"])
  };
}

function resolvePrompt(promptRegistry: RegistryRecord, promptKey: string): ResolvedPrompt {
  const entry = findRegistryEntry(promptRegistry, promptKey);
  if (!isRecord(entry)) throw new Error(`Prompt not found in registry: ${promptKey}`);
  return {
    purpose: getField(entry, ["purpose"], `purpose for prompt ${promptKey}`),
    constraints: getField(entry, ["constraints"], `constraints for prompt ${promptKey}`),
    outputStyle: getField(entry, ["output_style", "outputStyle"], `output_style for prompt ${promptKey}`)
  };
}

function resolveTargetDir(pathMapping: RegistryRecord, pathKey: string): string {
  const entry = findRegistryEntry(pathMapping, pathKey);
  if (typeof entry === "string" && entry.trim()) return normalizePath(entry.trim());
  throw new Error(`Path mapping not found: ${pathKey}`);
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

function inferFixFrontmatterSchemaKey(input: BuildRegistryPromptInput): string {
  const frontmatter = parseSourceFrontmatter(input.content);
  const rawType = typeof frontmatter?.type === "string" ? frontmatter.type.trim().toLowerCase() : "";
  const rawDomain = typeof frontmatter?.domain === "string" ? frontmatter.domain.trim().toLowerCase() : "";
  const path = normalizePath(input.path).toLowerCase();
  const domain = rawDomain || (
    path.includes("openclaw") ? "openclaw" :
    path.includes("/ai/") ? "ai" :
    "general"
  );

  if (rawType === "insight") {
    if (domain === "openclaw") return "openclaw_insight_schema";
    if (domain === "ai") return "ai_insight_schema";
    return "general_insight_schema";
  }
  return "raw_schema";
}

function resolveSchema(schemaRegistry: RegistryRecord, schemaKey: string): RegistryRecord {
  const entry = findRegistryEntry(schemaRegistry, schemaKey);
  if (!isRecord(entry)) throw new Error(`Schema not found in registry: ${schemaKey}`);
  return entry;
}

function schemaAllowedFrontmatterFields(schema: RegistryRecord): string[] {
  const required = Array.isArray(schema.required_frontmatter) ? schema.required_frontmatter : [];
  const optional = Array.isArray(schema.optional_frontmatter) ? schema.optional_frontmatter : [];
  const fixedValues = isRecord(schema.fixed_values) ? Object.keys(schema.fixed_values) : [];
  return [...new Set([...required, ...optional, ...fixedValues, "created"].map((item) => String(item).trim()).filter(Boolean))];
}

function buildRewritePrompt(
  input: BuildRegistryPromptInput,
  workflow: ResolvedRewriteWorkflowConfig,
  prompt: ResolvedPrompt
): string {
  return [
    "System Instruction:",
    "Rewrite the current Obsidian note into a clearer, more structured, more professional version.",
    "This is an edit-in-place workflow, not a create-new-note workflow.",
    "",
    `Workflow: ${workflow.name}`,
    `Executor action: ${workflow.executorAction}`,
    `Schema mode: ${workflow.schemaMode ?? "preserve_current"}`,
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
    "- Improve clarity, structure, headings, flow, and wording.",
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

function buildFixFrontmatterPrompt(
  input: BuildRegistryPromptInput,
  workflow: ResolvedRewriteWorkflowConfig,
  prompt: ResolvedPrompt,
  schemaKey: string,
  schema: RegistryRecord
): string {
  const allowedFields = schemaAllowedFrontmatterFields(schema);

  return [
    "System Instruction:",
    "Strictly repair the current Obsidian note so that its YAML frontmatter conforms to the target schema.",
    "This is an edit-in-place workflow, not a create-new-note workflow.",
    "The goal is schema compliance, not metadata expansion.",
    "",
    `Workflow: ${workflow.name}`,
    `Executor action: ${workflow.executorAction}`,
    `Schema mode: ${workflow.schemaMode ?? "repair_current"}`,
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
    formatYamlish(schema.required_frontmatter),
    "",
    "Target schema fixed_values:",
    formatYamlish(schema.fixed_values),
    "",
    "Target schema optional_frontmatter:",
    schema.optional_frontmatter === undefined ? "- none" : formatYamlish(schema.optional_frontmatter),
    "- created",
    "",
    "Allowed frontmatter fields:",
    allowedFields.length ? allowedFields.map((field) => `- ${field}`).join("\n") : "- none",
    "",
    "Strict schema repair rules:",
    "- Only use fields that are defined by the target schema.",
    "- Do not invent new frontmatter fields.",
    "- Remove schema-external frontmatter fields unless the target schema explicitly allows them.",
    "- Add missing required fields when inferable with high confidence.",
    "- Apply schema fixed values when appropriate.",
    "- Keep existing valid metadata when possible.",
    "- Preserve the body content as much as possible.",
    "- Do not rewrite the note body unless strictly necessary.",
    ...FIX_FRONTMATTER_DATE_RULES.map((rule) => `- ${rule}`),
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

export async function resolveRawSkillWorkflow(app: App): Promise<ResolvedRawSkillWorkflow> {
  const [workflowRegistry, pathMapping] = await Promise.all([
    loadRegistry(app, WORKFLOW_REGISTRY_PATH),
    loadRegistry(app, PATH_MAPPING_PATH)
  ]);

  const workflow = resolveRawWorkflow(workflowRegistry);
  if (!workflow.backendSkill?.trim()) {
    throw new Error(`Workflow ${workflow.name} is missing backend_skill.`);
  }

  return {
    workflow,
    targetDir: resolveTargetDir(pathMapping, workflow.pathKey),
    backendSkill: workflow.backendSkill
  };
}

export async function resolveRewriteWorkflow(app: App, input: BuildRegistryPromptInput): Promise<ResolvedRewriteWorkflow> {
  const [workflowRegistry, promptRegistry] = await Promise.all([
    loadRegistry(app, WORKFLOW_REGISTRY_PATH),
    loadRegistry(app, PROMPT_REGISTRY_PATH)
  ]);
  const workflow = resolveRewriteWorkflowConfig(workflowRegistry);
  const prompt = resolvePrompt(promptRegistry, workflow.promptKey);
  return { workflow, prompt: buildRewritePrompt(input, workflow, prompt) };
}

export async function resolveFixFrontmatterWorkflow(app: App, input: BuildRegistryPromptInput): Promise<ResolvedFixFrontmatterWorkflow> {
  const [workflowRegistry, schemaRegistry, promptRegistry] = await Promise.all([
    loadRegistry(app, WORKFLOW_REGISTRY_PATH),
    loadRegistry(app, SCHEMA_REGISTRY_PATH),
    loadRegistry(app, PROMPT_REGISTRY_PATH)
  ]);
  const workflow = resolveFixWorkflowConfig(workflowRegistry);
  const schemaKey = inferFixFrontmatterSchemaKey(input);
  const schema = resolveSchema(schemaRegistry, schemaKey);
  const prompt = resolvePrompt(promptRegistry, workflow.promptKey);
  return {
    workflow,
    schemaKey,
    prompt: buildFixFrontmatterPrompt(input, workflow, prompt, schemaKey, schema)
  };
}
