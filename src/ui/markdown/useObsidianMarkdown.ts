import type { App, Component } from "obsidian";
import { MarkdownRenderer } from "obsidian";
import { useEffect } from "react";

export function useObsidianMarkdown(app: App, el: HTMLElement | null, markdown: string, component: Component) {
  useEffect(() => {
    if (!el) return;
    let cancelled = false;
    el.empty();
    (async () => {
      try {
        await MarkdownRenderer.renderMarkdown(markdown, el, "", component);
      } catch (e) {
        if (!cancelled) {
          el.setText(`Markdown render error: ${String(e)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app, el, markdown, component]);
}

