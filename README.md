# Obsidian to OpenClaw

Open-source Obsidian plugin repository:
`duongxuan1988bk-sys/obsidian-openclaw-controller`

`Obsidian to OpenClaw` is a desktop-only Obsidian plugin that connects your vault
to a local OpenClaw node. It provides a side-panel chat UI, `@note` references,
session controls, note write-back, and a small set of basic workflows designed
to be portable across different vaults.

This repository is the public core extracted from a larger private plugin. The
goal is to keep the reusable controller layer and remove personal domain
workflows.

## What It Includes

- OpenClaw WebSocket connection from inside Obsidian
- Side-panel chat UI
- `@note` context references
- `Settings`, `New Chat`, and `History` controls
- Write latest reply back into the current note
- Basic workflows:
  `WeChat Raw`, `PDF Raw`, `MarkItDown`, `Rewrite Note`, `Fix Schema`, `Note Links`

## What It Does Not Include

- Personal biotech workflows
- Domain-specific `theory`, `case`, `method`, `doc`, `debug`, or `system` menus
- Private prompt packs
- Private path routing conventions beyond the default sample registry

## Install

### Manual install for local development

Copy or link this folder into your Obsidian plugin directory, for example:

```text
<your-vault>/.obsidian/plugins/obsidian-to-openclaw
```

Then build the plugin:

```bash
npm install
npm run build
```

Reload the plugin in Obsidian after each rebuild.

### Release install

Once releases are published, copy these files into:

```text
<your-vault>/.obsidian/plugins/obsidian-to-openclaw/
```

- `manifest.json`
- `main.js`
- `styles.css`

## Settings

The plugin expects these settings in Obsidian:

- `Gateway URL`
- `Client ID`
- `Client mode`
- `Gateway token`
- `WeChat script path`
- `WeChat Python`
- `PDF script path`
- `PDF Python`
- `MarkItDown command`
- `MarkItDown timeout`

For OpenClaw node pairing, the usual values are:

- `Client ID`: `node-host`
- `Client mode`: `node`

The `Gateway token` field accepts either:

- a raw node/bootstrap token
- a full setup code produced by `openclaw qr --setup-code-only`

After successful pairing, the plugin stores device credentials locally.

## Default Workflows

### WeChat Raw

Converts a WeChat article URL into a raw note using your configured local
`wechat_to_obsidian.py` script.

Output path:

```text
PARA/03Resources/01Raw/WeChat/
```

### PDF Raw

Converts a PDF in the vault into one or more raw notes using your configured
`pdf_to_obsidian.py` script.

Output path:

```text
PARA/03Resources/01Raw/PDF/<PDF filename>/
```

### MarkItDown

Converts supported files such as `docx`, `pptx`, `xlsx`, `html`, `csv`, `json`,
`xml`, `zip`, `epub`, and `md` into raw notes using the `markitdown` CLI.

Output path:

```text
PARA/03Resources/01Raw/MarkItDown/
```

### Rewrite Note

Rewrites the current note into a clearer, more structured version while keeping
it in place.

### Fix Schema

Repairs the current note's frontmatter so it matches the target schema.

### Note Links

Scans the vault and updates related-note suggestions for the active note.

## Registry System

The plugin still uses registry files, but the open-source version is designed to
work with a smaller, generic set of defaults.

Expected vault registry paths:

- `PARA/03Resources/00System/Workflow Registry/workflow_registry.yaml`
- `PARA/03Resources/00System/Schema/schema_registry.yaml`
- `PARA/03Resources/00System/Prompts/prompt_registry.yaml`
- `PARA/03Resources/00System/Path Mapping/path_mapping.yaml`

If these files do not exist in the vault, the plugin falls back to the bundled
sample registry included in this repository:

- [default-registry/workflow_registry.yaml.md](default-registry/workflow_registry.yaml.md)
- [default-registry/schema_registry.yaml.md](default-registry/schema_registry.yaml.md)
- [default-registry/prompt_registry.yaml.md](default-registry/prompt_registry.yaml.md)
- [default-registry/path_mapping.yaml.md](default-registry/path_mapping.yaml.md)

This gives open-source users a working baseline while still letting advanced
users replace the registries with their own.

## Development

Commands:

```bash
npm run dev
npm run build
npm run typecheck
npm test
```

Build output:

- `main.js`
- `styles.css`
- `manifest.json`

## Repository Notes

Do not commit runtime secrets such as:

- `data.json`
- node tokens
- device tokens
- private keys
- personal script paths

The example settings file is `data.example.json`.

## License

This local draft now includes an MIT license. Change it before publishing if
you want different terms.
