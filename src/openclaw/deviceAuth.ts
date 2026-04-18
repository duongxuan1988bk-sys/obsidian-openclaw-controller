import type { StoredDeviceAuth, StoredDeviceIdentity } from "../settings";

const enc = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return bytesToHex(new Uint8Array(digest));
}

function normalizeMeta(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string;
  nonce: string;
  platform?: string;
  deviceFamily?: string;
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeMeta(params.platform),
    normalizeMeta(params.deviceFamily)
  ].join("|");
}

async function exportIdentity(keys: CryptoKeyPair): Promise<StoredDeviceIdentity> {
  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", keys.publicKey),
    crypto.subtle.exportKey("jwk", keys.privateKey)
  ]);
  const raw = publicKeyJwk.x ? base64UrlDecode(publicKeyJwk.x) : new Uint8Array();
  if (!publicKeyJwk.x || raw.length === 0) {
    throw new Error("Unable to export Ed25519 public key");
  }
  return {
    version: 1,
    deviceId: await sha256Hex(raw),
    publicKeyJwk,
    privateKeyJwk,
    createdAtMs: Date.now()
  };
}

export async function ensureDeviceIdentity(stored: StoredDeviceIdentity | null | undefined): Promise<StoredDeviceIdentity> {
  if (stored?.version === 1 && stored.deviceId && stored.publicKeyJwk?.x && stored.privateKeyJwk?.d) {
    return stored;
  }

  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  return await exportIdentity(keys);
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey("jwk", jwk, "Ed25519", false, ["sign"]);
}

export function resolvePublicKeyBase64Url(identity: StoredDeviceIdentity): string {
  const x = identity.publicKeyJwk?.x;
  if (!x) throw new Error("Stored device identity is missing public key");
  return x;
}

export async function signDevicePayload(identity: StoredDeviceIdentity, payload: string): Promise<string> {
  const privateKey = await importPrivateKey(identity.privateKeyJwk);
  const signature = await crypto.subtle.sign("Ed25519", privateKey, enc.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function createSignedDeviceEnvelope(params: {
  identity: StoredDeviceIdentity;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  nonce: string;
  token?: string;
  platform?: string;
  deviceFamily?: string;
}): Promise<{
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}> {
  const signedAt = Date.now();
  const payload = buildDeviceAuthPayloadV3({
    deviceId: params.identity.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    signedAtMs: signedAt,
    token: params.token,
    nonce: params.nonce,
    platform: params.platform,
    deviceFamily: params.deviceFamily
  });
  const signature = await signDevicePayload(params.identity, payload);
  return {
    id: params.identity.deviceId,
    publicKey: resolvePublicKeyBase64Url(params.identity),
    signature,
    signedAt,
    nonce: params.nonce
  };
}

export function sameStoredDeviceAuth(
  left: StoredDeviceAuth | null | undefined,
  right: StoredDeviceAuth | null | undefined
): boolean {
  return (
    (left?.deviceToken ?? "") === (right?.deviceToken ?? "") &&
    (left?.role ?? "") === (right?.role ?? "") &&
    JSON.stringify(left?.scopes ?? []) === JSON.stringify(right?.scopes ?? []) &&
    (left?.issuedAtMs ?? 0) === (right?.issuedAtMs ?? 0)
  );
}
