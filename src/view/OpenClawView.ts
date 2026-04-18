import { ItemView, WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import type OpenClawControllerPlugin from "../main";
import { OpenClawViewReact } from "../view";

export const OPENCLAW_VIEW_TYPE = "openclaw-controller-view";

export class OpenClawView extends ItemView {
  private root: Root | null = null;
  private plugin: OpenClawControllerPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: OpenClawControllerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return OPENCLAW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "OpenClaw Controller";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("oc-root");
    this.root = createRoot(container);
    this.root.render(React.createElement(OpenClawViewReact, { app: this.app, plugin: this.plugin }));
  }

  async onClose() {
    this.root?.unmount();
    this.root = null;
  }
}

