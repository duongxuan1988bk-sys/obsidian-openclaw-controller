export type ParsedSetupCode = {
  url?: string;
  bootstrapToken?: string;
};

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return atob(padded);
}

export function parseSetupCode(raw: string | null | undefined): ParsedSetupCode | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) return null;

  try {
    const decoded = base64UrlDecode(value);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
    const bootstrapToken = typeof parsed.bootstrapToken === "string" ? parsed.bootstrapToken.trim() : "";
    if (!url && !bootstrapToken) return null;
    return {
      ...(url ? { url } : {}),
      ...(bootstrapToken ? { bootstrapToken } : {})
    };
  } catch {
    return null;
  }
}
