/**
 * Minimal signed-cookie session for the local demo deployment.
 * Works in both the Node runtime and proxy.ts: Web Crypto only, no Node-specific modules.
 * The account comes from AUTH_USERNAME / AUTH_PASSWORD and the signing key from AUTH_SECRET,
 * all in the git-ignored apps/web/.env.local. A real multi-user deployment should replace this with a user table.
 */
export const SESSION_COOKIE = "xy_session";
export const SESSION_HOURS = 12;

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export type Session = { user: string; exp: number };

export function authConfigured() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD);
}

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(process.env.AUTH_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

/** Constant-time comparison of two strings via their HMAC digests (lengths never leak). */
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([hmac(`cmp:${a}`), hmac(`cmp:${b}`)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function checkCredentials(user: string, password: string) {
  if (!authConfigured()) return false;
  const [u, p] = await Promise.all([same(user, process.env.AUTH_USERNAME!), same(password, process.env.AUTH_PASSWORD!)]);
  return u && p;
}

export async function createSession(user: string) {
  const payload = b64url(encoder.encode(JSON.stringify({ user, exp: Date.now() + SESSION_HOURS * 3600_000 } satisfies Session)));
  return `${payload}.${b64url(await hmac(payload))}`;
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token || !authConfigured()) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!(await same(signature, b64url(await hmac(payload))))) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

/** Only same-site relative paths are accepted as the post-login destination. */
export function safeNext(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/";
}
