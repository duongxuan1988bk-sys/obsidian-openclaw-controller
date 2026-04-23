# Obsidian to OpenClaw

Open-source Obsidian plugin repository:
`duongxuan1988bk-sys/obsidian-openclaw-controller`

`Obsidian to OpenClaw` is a desktop-only Obsidian plugin that connects your vault
to a local OpenClaw node. It provides a side-panel chat UI, `@note` references,
session controls, note write-back, and a small set of basic workflows designed
to be portable across different vaults.

This repository contains the open-source controller layer of the plugin, with
the reusable Obsidian and OpenClaw integration kept intact and private
domain-specific workflows removed.

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

Configure these settings in Obsidian:

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

The repository includes helper scripts here:

- `scripts/wechat_to_obsidian.py`
- `scripts/pdf_to_obsidian.py`

For OpenClaw node pairing, the usual values are:

- `Client ID`: `node-host`
- `Client mode`: `node`

The `Gateway token` field accepts either:

- a raw node/bootstrap token
- a full setup code produced by `openclaw qr --setup-code-only`

After successful pairing, the plugin stores device credentials locally.

If you install from this repository source, the usual script path values are:

```text
<repo>/scripts/wechat_to_obsidian.py
<repo>/scripts/pdf_to_obsidian.py
```

## Default Workflows

### WeChat Raw

Converts a WeChat article URL into a raw note using your configured local
`wechat_to_obsidian.py` script.

Output path:

```text
PARA/03Resources/01Raw/WeChat/
```

Requirements and notes:

- Best on `macOS`
- Browser automation uses AppleScript via `osascript`
- The included script supports `Google Chrome` and `Safari`
- In `stdout` mode the bundled script skips image download unless you extend it with `--assets-dir`
- If browser extraction fails, the script falls back to plain HTTP fetching, which may return an incomplete article or a WeChat anti-bot page

Chrome permission notes:

1. Open the article in Chrome at least once and confirm you are already logged in if the page requires it.
2. When macOS prompts for automation, allow Terminal, iTerm, or Obsidian to control `Google Chrome`.
3. In Chrome, enable `View -> Developer -> Allow JavaScript from Apple Events` if AppleScript extraction is blocked.

Safari notes:

1. Enable `Develop -> Allow JavaScript from Apple Events`.
2. Allow automation permission when macOS asks.

### PDF Raw

Converts a PDF in the vault into one or more raw notes using your configured
`pdf_to_obsidian.py` script.

Output path:

```text
PARA/03Resources/01Raw/PDF/<PDF filename>/
```

Requirements and notes:

- Python `3.10+` recommended
- Install `PyMuPDF` for the included script:

```bash
pip install PyMuPDF
```

- Optional OCR for scanned PDFs:

```bash
pip install rapidocr_onnxruntime
```

- Without OCR, the script works best for text-based PDFs
- In `stdout` mode the bundled script skips figure extraction unless you extend it with `--assets-dir`
- If you want extracted figures in Obsidian, the simplest approach is to customize the script or wrap it so `--assets-dir` points into your vault
- Very large or scan-heavy PDFs will be slower and may still need a separate OCR workflow

### MarkItDown

Converts supported files such as `docx`, `pptx`, `xlsx`, `html`, `csv`, `json`,
`xml`, `zip`, `epub`, and `md` into raw notes using the `markitdown` CLI.

`markitdown` is not bundled with this plugin. You must install it yourself and
set the command path in plugin settings.

Output path:

```text
PARA/03Resources/01Raw/MarkItDown/
```

Example:

```bash
pip install markitdown
```

You must then set `MarkItDown command` in plugin settings to either:

- `markitdown`
- the full path to the installed CLI

### Rewrite Note

Rewrites the current note into a clearer, more structured version while keeping
it in place.

### Fix Schema

Repairs the current note's frontmatter so it matches the target schema.

### Note Links

Scans the vault and updates related-note suggestions for the active note.

## Registry System

The plugin uses registry files, and the open-source version is designed to work
with a smaller, generic set of defaults.

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

## Security Notes

Do not commit runtime secrets such as:

- `data.json`
- node tokens
- device tokens
- private keys
- personal script paths

An example settings file is included as `data.example.json`.

## License

This repository is released under the MIT License. See [LICENSE](LICENSE).
