/** Where the browser reaches the Xiaoyun voice backend: explicit env, local dev port, or same-origin behind HTTPS. */
export function voiceBackendUrl() {
  const configured = process.env.NEXT_PUBLIC_XIAOYUN_BACKEND_URL;
  if (configured) return configured;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  return local && window.location.protocol === "http:" ? "http://127.0.0.1:8766" : window.location.origin;
}

/** Reachability only: a no-cors request resolves when something answers and rejects when the port is closed. */
export async function probeVoice(timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(new URL("/api/health", voiceBackendUrl()), { mode: "no-cors", signal: controller.signal, cache: "no-store" });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
