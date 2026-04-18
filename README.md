# OpenClaw Controller

Obsidian plugin that connects to local OpenClaw Gateway via WebSocket and provides PARA-aware AI workflow commands for note generation, conversion, and organization.

## Features

- **Workflow-driven note generation** backed by a registry system
- **Multi-domain support**: biotech, openclaw, ai, general
- **Note type conversions**: Insight, Theory, Case, Method, Doc, Debug, System, Raw
- **Raw extraction**: WeChat articles and PDF documents
- **Schema validation** before writeback
- **PARA-based vault organization**

## Registry System

All workflow behavior is driven by vault YAML registries:

| Registry | Purpose |
|---|---|
| `workflow_registry.yaml` | Workflow actions and routing rules |
| `schema_registry.yaml` | Required/optional fields per note type |
| `prompt_registry.yaml` | LLM prompts with domain constraints |
| `path_mapping.yaml` | Output directories per type+domain |

## Supported Workflows

| Workflow | biotech | openclaw | ai | general |
|---|---|---|---|---|
| `raw_to_insight` | ✅ | ✅ | ✅ | ✅ |
| `wechat_to_raw` | ✅ | ✅ | ✅ | ✅ |
| `pdf_to_raw` | ✅ | ✅ | ✅ | ✅ |
| `note_to_theory` | ✅ | ✅ | ✅ | — |
| `note_to_case` | ✅ | — | — | — |
| `note_to_method` | ✅ | — | — | — |
| `note_to_case_by_domain` | — | ✅ | ✅ | — |
| `note_to_doc` | — | ✅ | ✅ | — |
| `note_to_debug` | — | ✅ | ✅ | — |
| `note_to_system` | — | ✅ | ✅ | — |
| `rewrite_current_note` | ✅ | ✅ | ✅ | ✅ |
| `fix_frontmatter` | ✅ | ✅ | ✅ | ✅ |
| `organize_related_notes` | ✅ | ✅ | ✅ | ✅ |

## Setup

```bash
npm install
npm run dev
```

`data.json` is local Obsidian plugin state and may contain gateway tokens,
device tokens, and private keys. Do not commit it. Use `data.example.json` as
a reference for non-secret defaults.

## Development

```bash
npm run build    # typecheck → test → CSS → bundle
npm run typecheck
npm test
```

## Architecture

```
Plugin (view.tsx UI)
  └─ WorkflowExecutor.runWorkflow()
       ├─ resolveRegistryWorkflow()  ← reads vault YAML registries
       ├─ OpenClaw Gateway (WS)    ← LLM generation
       ├─ validateNote()           ← schema check before writeback
       └─ ToolManager.writeFile()  ← writes to vault
```

## License

MIT
