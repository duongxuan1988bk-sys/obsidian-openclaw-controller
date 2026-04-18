# OpenClaw Controller

OpenClaw Controller is a desktop-only Obsidian plugin for running AI-assisted
note workflows through a local OpenClaw Gateway. It provides a side-panel UI,
workflow shortcuts, domain-aware note generation, raw source conversion, schema
repair, and related-note organization for a PARA-style vault.

This repository is private and is maintained as the source of truth for the
local Obsidian plugin folder.

## What It Does

- Connects Obsidian to a local OpenClaw Gateway over WebSocket.
- Runs registry-driven workflows for note creation, conversion, rewrite, and
  frontmatter repair.
- Supports domain-aware outputs for `biotech`, `openclaw`, `ai`, and `general`.
- Converts WeChat articles and PDF files into Raw notes through local scripts.
- Validates note frontmatter before writeback.
- Organizes related Insight links automatically.
- Builds a production Obsidian plugin bundle: `main.js`, `styles.css`, and
  `manifest.json`.

## Local Workflow

The expected setup is to map this project folder directly to Obsidian's plugin
directory, for example:

```text
<vault>/.obsidian/plugins/openclaw-controller
```

With that setup, Obsidian runs the local files from this repository. GitHub is
only used for version control and backup. Updating GitHub does not update
Obsidian by itself; Obsidian sees changes after the local plugin bundle is
rebuilt and the plugin is reloaded.

Typical development loop:

```bash
npm install
npm run build
```

Then reload the plugin in Obsidian, or restart Obsidian.

## Commands

```bash
npm run dev        # watch TypeScript bundle for local development
npm run build      # typecheck, run tests, build CSS, build production JS
npm run typecheck  # TypeScript validation only
npm test           # regression tests
```

`npm run build` produces a production `main.js` without inline sourcemaps.

## Runtime Configuration

Obsidian stores plugin settings in `data.json`. This file is intentionally
ignored by git because it may contain:

- OpenClaw gateway bootstrap tokens
- device tokens
- Ed25519 private keys
- local script paths
- personal vault path settings

Use `data.example.json` only as a non-secret reference.

Local raw extraction requires script paths to be configured in the plugin
settings:

- WeChat script path: `wechat_to_obsidian.py`
- PDF script path: `pdf_to_obsidian.py`
- Python executable for each script

The default script paths are empty on purpose, so personal filesystem paths are
not committed.

## Registry System

Workflow behavior is driven by YAML registries in the vault:

| Registry | Purpose |
| --- | --- |
| `workflow_registry.yaml` | Workflow actions and routing rules |
| `schema_registry.yaml` | Required and optional fields per note type |
| `prompt_registry.yaml` | LLM prompts with domain constraints |
| `path_mapping.yaml` | Output directories per type and domain |

## Supported Workflows

| Workflow | biotech | openclaw | ai | general |
| --- | --- | --- | --- | --- |
| `raw_to_insight` | yes | yes | yes | yes |
| `wechat_to_raw` | yes | yes | yes | yes |
| `pdf_to_raw` | yes | yes | yes | yes |
| `note_to_theory` | yes | yes | yes | no |
| `note_to_case` | yes | no | no | no |
| `note_to_method` | yes | no | no | no |
| `note_to_case_by_domain` | no | yes | yes | no |
| `note_to_doc` | no | yes | yes | no |
| `note_to_debug` | no | yes | yes | no |
| `note_to_system` | no | yes | yes | no |
| `rewrite_current_note` | yes | yes | yes | yes |
| `fix_frontmatter` | yes | yes | yes | yes |
| `organize_related_notes` | yes | yes | yes | yes |

## Architecture

```text
src/main.ts
  -> OpenClawView
  -> React UI in src/view.tsx and src/ui/*
  -> WorkflowExecutor
       -> registry workflow resolution
       -> OpenClawClient WebSocket calls
       -> local raw extractors
       -> SchemaGuard / validateNote
       -> ToolManager writeback
```

Important modules:

| Path | Role |
| --- | --- |
| `src/workflows/WorkflowExecutor.ts` | Executes workflow actions and writeback |
| `src/openclaw/OpenClawClient.ts` | WebSocket client and device auth |
| `src/schema/SchemaGuard.ts` | Frontmatter repair and schema inference |
| `src/localScripts/rawExtractors.ts` | WeChat/PDF script bridge |
| `src/linking/NoteLinkOrganizer.ts` | Related-note link organization |
| `src/registry/frontmatterDateRules.ts` | `date` / `created` normalization rules |
| `src/ui/*` | React UI components |

## Repository Hygiene

Do not commit local runtime files:

- `data.json`
- `.hotreload`
- `.tmp-tests/`
- `.DS_Store`
- `node_modules/`

Before pushing, run:

```bash
npm run build
git status --short
```

If credentials ever appear in git history, rewrite the history and rotate the
affected credentials.

## License

Private project. No public license is currently granted.
