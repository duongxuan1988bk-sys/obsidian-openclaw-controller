// Intentionally left unused.
// OpenClaw /health is plain-text and does not include CORS headers;
// Obsidian plugins run with Origin `app://obsidian.md` and will be blocked.
export async function pingHealth(): Promise<boolean> {
  return false;
}

