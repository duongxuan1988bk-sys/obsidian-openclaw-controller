import { PluginSettingTab, Setting } from "obsidian";
import type OpenClawControllerPlugin from "./main";
import {
  DEFAULT_GATEWAY_URL,
  DEFAULT_MARKITDOWN_TIMEOUT_MS,
  DEFAULT_MARKITDOWN_PATH,
  DEFAULT_PDF_PYTHON_PATH,
  DEFAULT_PDF_SCRIPT_PATH,
  DEFAULT_PYTHON_PATH,
  DEFAULT_WECHAT_SCRIPT_PATH
} from "./settings";

export class OpenClawSettingTab extends PluginSettingTab {
  plugin: OpenClawControllerPlugin;

  constructor(plugin: OpenClawControllerPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian to OpenClaw" });

    new Setting(containerEl)
      .setName("UI skin")
      .setDesc("Switch the controller visual style without changing OpenClaw behavior.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("claude", "Claude")
          .addOption("apple", "Apple")
          .setValue(this.plugin.settings.uiSkin ?? "claude")
          .onChange(async (value) => {
            this.plugin.settings.uiSkin = value === "apple" ? "apple" : "claude";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gateway URL")
      .setDesc("OpenClaw Gateway WebSocket URL.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_GATEWAY_URL)
          .setValue(this.plugin.settings.gatewayUrl)
          .onChange(async (v) => {
            this.plugin.settings.gatewayUrl = v.trim() || DEFAULT_GATEWAY_URL;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Gateway node client.id. For node pairing, use node-host.")
      .addText((t) =>
        t.setPlaceholder("node-host")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (v) => {
            this.plugin.settings.clientId = v.trim() || "node-host";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Client mode")
      .setDesc("Gateway node mode. For node pairing, use node.")
      .addText((t) =>
        t.setPlaceholder("node")
          .setValue(this.plugin.settings.clientMode)
          .onChange(async (v) => {
            this.plugin.settings.clientMode = v.trim() || "node";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gateway token")
      .setDesc("Paste either a raw bootstrap token or the full setup code from `openclaw qr --setup-code-only`. After pairing, the plugin will store its own device token automatically.")
      .addText((t) => {
        t.setPlaceholder("paste token…").setValue(this.plugin.settings.token).onChange(async (v) => {
          this.plugin.settings.token = v.trim();
          await this.plugin.saveSettings();
        });
        (t.inputEl as HTMLInputElement).type = "password";
      });

    containerEl.createEl("h3", { text: "Local raw extraction" });

    new Setting(containerEl)
      .setName("WeChat script path")
      .setDesc("Filesystem path to wechat_to_obsidian.py. Required for WeChat raw extraction.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_WECHAT_SCRIPT_PATH)
          .setValue(this.plugin.settings.wechatScriptPath)
          .onChange(async (v) => {
            this.plugin.settings.wechatScriptPath = v.trim() || DEFAULT_WECHAT_SCRIPT_PATH;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("WeChat Python")
      .setDesc("Python executable used for the WeChat extraction script.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_PYTHON_PATH)
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async (v) => {
            this.plugin.settings.pythonPath = v.trim() || DEFAULT_PYTHON_PATH;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PDF script path")
      .setDesc("Filesystem path to pdf_to_obsidian.py. Required for PDF raw extraction.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_PDF_SCRIPT_PATH)
          .setValue(this.plugin.settings.pdfScriptPath)
          .onChange(async (v) => {
            this.plugin.settings.pdfScriptPath = v.trim() || DEFAULT_PDF_SCRIPT_PATH;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PDF Python")
      .setDesc("Python executable used for PDF extraction. Use the interpreter with PyMuPDF installed.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_PDF_PYTHON_PATH)
          .setValue(this.plugin.settings.pdfPythonPath)
          .onChange(async (v) => {
            this.plugin.settings.pdfPythonPath = v.trim() || DEFAULT_PDF_PYTHON_PATH;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "MarkItDown" });

    new Setting(containerEl)
      .setName("MarkItDown command")
      .setDesc("Command or path to markitdown CLI. Supports DOCX, PPTX, XLSX, HTML, CSV, JSON, XML, ZIP, and more.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_MARKITDOWN_PATH)
          .setValue(this.plugin.settings.markItDownPath)
          .onChange(async (v) => {
            this.plugin.settings.markItDownPath = v.trim() || DEFAULT_MARKITDOWN_PATH;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("MarkItDown timeout")
      .setDesc("Maximum MarkItDown extraction time in milliseconds.")
      .addText((t) =>
        t
          .setPlaceholder(String(DEFAULT_MARKITDOWN_TIMEOUT_MS))
          .setValue(String(this.plugin.settings.markItDownTimeoutMs ?? DEFAULT_MARKITDOWN_TIMEOUT_MS))
          .onChange(async (v) => {
            const parsed = Number(v.trim());
            this.plugin.settings.markItDownTimeoutMs = Number.isFinite(parsed) && parsed > 0
              ? parsed
              : DEFAULT_MARKITDOWN_TIMEOUT_MS;
            await this.plugin.saveSettings();
          })
      );

    // PARA path routing is now registry-driven from the vault YAML files, so the
    // old manual base-path controls are intentionally hidden from settings.
  }
}
