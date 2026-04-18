import { MarkdownView, TAbstractFile, TFolder, type App, type MarkdownFileInfo, type TFile } from "obsidian";

export type LocalPrompt = {
  path: string;
  name: string;
};

function isFolder(f: TAbstractFile): f is TFolder {
  return (f as TFolder).children != null;
}

function isFileLike(f: TAbstractFile): f is TFile {
  return (f as any).extension != null;
}

export async function loadLocalPrompts(app: App, folderPath = "_templates/prompts"): Promise<LocalPrompt[]> {
  const root = app.vault.getAbstractFileByPath(folderPath);
  if (!root || !isFolder(root)) return [];

  const out: LocalPrompt[] = [];
  const stack: TAbstractFile[] = [...root.children];

  while (stack.length) {
    const cur = stack.pop()!;
    if (isFolder(cur)) {
      stack.push(...cur.children);
      continue;
    }
    if (!isFileLike(cur)) continue;
    if (cur.extension !== "md") continue;
    out.push({ path: cur.path, name: cur.basename });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function getActiveSelection(app: App): string {
  const view = app.workspace.getMostRecentLeaf()?.view;
  if (!view) return "";
  // MarkdownView is the common case; fallback to fileInfo/editor if available.
  if (view instanceof MarkdownView) {
    return view.editor?.getSelection() ?? "";
  }
  const maybe = view as unknown as MarkdownFileInfo & { editor?: { getSelection?: () => string } };
  return maybe.editor?.getSelection?.() ?? "";
}

export async function readPromptText(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f || (f as any).extension !== "md") return "";
  return await app.vault.cachedRead(f as any);
}

export function applyPromptPlaceholders(template: string, selection: string): string {
  return template.replaceAll("{{selection}}", selection ?? "");
}

