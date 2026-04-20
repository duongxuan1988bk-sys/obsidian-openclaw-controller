# OpenClaw Controller — CLAUDE.md

## 1. Project Overview

Obsidian plugin that connects to local OpenClaw Gateway (WebSocket) and provides PARA-aware AI workflow commands (Convert to Insight/Theory/Case/Doc/Debug/System/Raw, Rewrite, Fix Schema, Organize Links) backed by a registry-driven note generation system.

## 2. Core Architecture

```
Plugin (view.tsx UI)
  └─ WorkflowExecutor.runWorkflow()
       ├─ resolveRegistryWorkflow()  ← reads vault YAML registries
       ├─ OpenClaw Gateway (WS)    ← LLM generation
       ├─ validateNote()           ← schema check before writeback
       └─ ToolManager.writeFile()   ← writes to vault
```

**Registry-driven rule:** All workflow behavior (prompt, schema, output path, domain routing) comes from vault YAML files — not from code constants.

**Vault registries:**
- `PARA/03Resources/00System/Workflow Registry/workflow_registry.yaml`
- `PARA/03Resources/00System/Schema/schema_registry.yaml`
- `PARA/03Resources/00System/Prompts/prompt_registry.yaml`
- `PARA/03Resources/00System/Path Mapping/path_mapping.yaml`

## 3. Workflow System

### Entry point
All workflow actions (Convert to Insight/Theory/Case/Doc/Debug/System/Raw, Rewrite, Fix Schema) MUST go through `WorkflowExecutor.runWorkflow()`. Do not create new `convertToXxx` functions outside it.

### Domain routing
- `insight`: `domain_mapping` → `resolveInsightWorkflow(domain)` → registry lookup
- `theory`: openclaw/ai uses `domain_mapping` (no topic); biotech uses `topic_mapping` (SEC/CEX/N_Glycan/Papers/Antibody)
- `case`: openclaw/ai uses `note_to_case_by_domain` (domain_mapping); biotech uses `topic_mapping`
- `method`: biotech-only `topic_mapping` (SEC/CEX/N_Glycan/Antibody/Uncategorized)
- `doc/debug/system`: always `domain_mapping` (openclaw/ai only)

### Resolve order
```
Theory  → domain_mapping (if domain && !topic) → topic_mapping (if topic)
Case    → domain_mapping (if domain && !topic) → topic_mapping (if topic)
Method  → topic_mapping (biotech only)
Doc/Debug/System → domain_mapping (always, domain required)
Insight → domain_mapping → top-level fallback
```

### Local raw extraction
- WeChat: `rawExtractors.runWechatScript()` → `wechat_to_obsidian.py` (AppleScript + Chrome/Safari)
- PDF: `rawExtractors.runPdfScript()` → `pdf_to_obsidian.py` (PyMuPDF + RapidOCR fallback for scanned PDFs)
- MarkItDown: choose domain → `rawExtractors.runMarkItDownScript()` → `markitdown` CLI (DOCX/PPTX/XLSX/HTML/CSV/JSON/XML/ZIP/EPUB/Markdown) → `PARA/03Resources/01Raw/MarkItDown/{Biotech|OpenClaw|AI|General}/`
- PDF is intentionally handled only by the dedicated PDF raw workflow for OCR and vault asset extraction.
- Script paths and Python executables are plugin settings (not hardcoded)

## 4. Registry Rules

### Four registries — each has one job

| Registry | Job | Key naming |
|---|---|---|
| `workflow_registry.yaml` | Defines workflow actions, domain/topic routing, executor | `raw_to_insight`, `note_to_case` |
| `schema_registry.yaml` | Defines required/optional fields, fixed values, body sections per type | `{domain}_{type}_schema` |
| `prompt_registry.yaml` | LLM prompts with domain rules embedded in constraints | `{domain}_raw_to_insight_prompt` |
| `path_mapping.yaml` | Output directory per type+domain | `insight_biotech` → path |

### Schema key format (IMPORTANT)
- Registry keys: `{domain}_insight_schema` (e.g. `ai_insight_schema`, NOT `insight_ai`)
- Prompt keys: `{domain}_raw_to_insight_prompt` (NOT `insight_{domain}_prompt`)
- Path keys: `insight_{domain}` (e.g. `insight_ai`)

### Constraints
- Never bypass registry to get schema/prompt/path — always use `resolveSchema()` / `resolvePrompt()` / `resolveTargetDir()`
- Domain rules are embedded in prompt constraints (not file references)
- All new workflow types require entries in ALL FOUR registries

## 5. Note System

### Note types and status flow
```
raw → insight → theory / method / case / doc / debug / system
         ↓
       draft (after generation)
```

### Method notes
`method` is a first-class note type for reusable analytical or experimental methods. It is not a `theory` note and not a `case` note.

- `theory`: explains principles and variables
- `method`: explains usage, scope, workflow, parameters, acceptance criteria, and troubleshooting
- `case`: records a concrete problem, root cause, solution, and reusable lesson

Biotech method schema key: `biotech_method_schema`

Biotech method workflow: `note_to_method`

Biotech method path keys:
- `biotech_sec_method` → `PARA/03Resources/03Domains/01Biotech/01HPLC_UPLC/01SEC/02Method/`
- `biotech_cex_method` → `PARA/03Resources/03Domains/01Biotech/01HPLC_UPLC/02CEX/02Method/`
- `biotech_nglycan_method` → `PARA/03Resources/03Domains/01Biotech/01HPLC_UPLC/03N-Glycan/02Method/`
- `biotech_antibody_method` → `PARA/03Resources/03Domains/01Biotech/03Antibody/03Method/`
- `biotech_uncategorized_method` → `PARA/03Resources/03Domains/01Biotech/04还未分类/02Method/`

### Required frontmatter (per schema)
Every generated note must have: `type`, `status`, `date`, `tags`, `source`, `domain`, `workflow`. Missing required fields → FAIL before writeback.

### Naming
- Title from frontmatter `title` field or first H1
- Sequential prefix (01, 02, 03…) via `getNextSeqPrefix(targetDir)` + `resolveOutputPath()`
- File collision: append ` 2`, ` 3`, etc.

### Frontmatter rules
- Generated notes: `date: YYYY-MM-DD`, `created: YYYY-MM-DD` (date-only, no time)
- Fix Schema: do NOT override user-set domain/topic/type/workflow even if path appears inconsistent
- WeChat/PDF raw: `date` only (no `created`)

## 6. Development Rules

### Unifying pattern
All new Convert-to actions MUST:
1. Add `RunnableWorkflowName` in `main.ts`
2. Use `runWorkflow()` in `WorkflowExecutor` — not a standalone function
3. Add `validateInput` case in `validation.ts`
4. Add entries in all four vault registries

### File organization
- `src/main.ts` — command registration only
- `src/view.tsx` — UI state and orchestration only (no business logic)
- `src/workflows/WorkflowExecutor.ts` — all execution logic
- `src/registry/insightRegistry.ts` — registry resolution (do not import view.tsx)
- `src/validation.ts` — pure functions, no Obsidian API
- `src/localScripts/rawExtractors.ts` — Python script execution
- `src/utils/notePaths.ts` — path resolution and collision handling

### Backward compatibility
- Do not change `schemaKey`/`promptKey`/`pathKey` formats after they ship
- Add new domains/topics in registries, not in code conditionals

## 7. Validation & Safety

### Pre-write validation
`validateNote()` runs after LLM generation and before `writeFile()`:
- **FAIL** → throw, log to Error Log, cancel writeback
- **WARNING** → append to Review Queue.md, continue writeback

### Schema Guard
`SchemaGuard.repair()` is called on every writeback. It:
- Adds missing required frontmatter from fixed_values
- Preserves existing valid metadata
- Does NOT infer new domain values from paths for existing notes

### Monitoring
All executions logged with Beijing time (CST, UTC+8), `YYYY-MM-DD HH:mm:ss` format. Entries trimmed to 3-day retention.

## 8. What NOT to Do

- **Do NOT** create new `convertToXxx` functions outside `WorkflowExecutor`
- **Do NOT** hardcode paths — use `resolveTargetDir()` from registry
- **Do NOT** hardcode schema/prompt names — use registry lookups
- **Do NOT** write files directly — always go through `ToolManager.writeFile()`
- **Do NOT** import view.tsx into registry modules (circular dependency)
- **Do NOT** infer domain from note path in Fix Schema (overwrites user-set domain)
- **Do NOT** validate in modules with Obsidian API dependencies (keep `validation.ts` pure)
- **Do NOT** skip `validateNote()` for new workflows without good reason
- **Do NOT** change registry key naming conventions after deployment

## 9. System Support Matrix

| Workflow | biotech | openclaw | ai | general |
|----------|:-------:|:--------:|:--:|:-------:|
| `raw_to_insight` | ✅ | ✅ | ✅ | ✅ |
| `wechat_to_raw` | ✅ | ✅ | ✅ | ✅ |
| `pdf_to_raw` | ✅ | ✅ | ✅ | ✅ |
| `markitdown_to_raw` | ✅ | ✅ | ✅ | ✅ |
| `note_to_theory` | ✅ (topic) | ✅ | ✅ | — |
| `note_to_case` | ✅ (topic) | — | — | — |
| `note_to_method` | ✅ (topic) | — | — | — |
| `note_to_case_by_domain` | — | ✅ | ✅ | — |
| `note_to_doc` | — | ✅ | ✅ | — |
| `note_to_debug` | — | ✅ | ✅ | — |
| `note_to_system` | — | ✅ | ✅ | — |
| `rewrite_current_note` | ✅ | ✅ | ✅ | ✅ |
| `fix_frontmatter` | ✅ | ✅ | ✅ | ✅ |
| `organize_related_notes` | ✅ | ✅ | ✅ | ✅ |

## 10. Build & Test

```bash
npm run build    # typecheck → test → CSS → bundle
npm run typecheck
npm test
```

## 11. Pending

- Planner v4 — disabled; button-based action is primary entry
- Note link organization v2 — body insertion before trailing source/reference sections
- Note link organization v3 — periodic reminder (future)
