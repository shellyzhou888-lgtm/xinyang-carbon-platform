"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { probeVoice } from "@/lib/voice";

export type Health = {
  db: { ok: boolean; ms: number; error: string };
  agent: { ok: boolean; error: string };
  voice: { ok: boolean };
  checkedAt: string;
  loading: boolean;
};

const initial: Health = { db: { ok: false, ms: 0, error: "" }, agent: { ok: false, error: "" }, voice: { ok: false }, checkedAt: "", loading: true };
const HealthContext = createContext<{ health: Health; refresh: (withVoice?: boolean) => void }>({ health: initial, refresh: () => {} });

/**
 * Polls /api/health (database + model key) once a minute. The voice backend is probed only on load and on manual
 * re-checks: while it is offline every probe logs a "connection refused" line in the browser console.
 */
export function HealthProvider({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<Health>(initial);
  const refresh = useCallback(async (withVoice = true) => {
    setHealth((current) => ({ ...current, loading: true }));
    const [server, voice] = await Promise.all([
      fetch("/api/health", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).catch((err: Error) => ({ db: { ok: false, ms: 0, error: `状态接口不可用：${err.message}` }, agent: { ok: false, error: "" }, checkedAt: new Date().toISOString() })),
      withVoice ? probeVoice() : null,
    ]);
    setHealth((current) => ({ ...server, voice: voice == null ? current.voice : { ok: voice }, loading: false }));
  }, []);
  useEffect(() => {
    // The first check runs on mount; later checks keep the indicator honest while the page stays open.
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(() => refresh(false), 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [refresh]);
  return <HealthContext.Provider value={{ health, refresh }}>{children}</HealthContext.Provider>;
}

export const useHealth = () => useContext(HealthContext);
