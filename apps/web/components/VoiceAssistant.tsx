"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Overview = { tce: number | null; co2_t: number | null; achieved: number; total: number } | null;

const PROJECT_ID = "xinyang-park";
const BACKEND_URL = process.env.NEXT_PUBLIC_XIAOYUN_BACKEND_URL ||
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8766" : "");
const YEARS = [2023, 2024, 2025];

/**
 * Mounts the Xiaoyun voice assistant in the browser. Qwen handles speech and routing; database questions go
 * to the backend project tools in voice-project.mjs (DeepSeek/Pi + our db-agent tools). The only page action
 * registered here is the same year switch as the year buttons at the top of the page.
 */
export default function VoiceAssistant({ year, overview }: { year: number; overview: Overview }) {
  const router = useRouter();
  const voiceRef = useRef<any>(null);
  const pendingYear = useRef<{ year: number; resolve: (v: unknown) => void } | null>(null);
  const [status, setStatus] = useState("小云加载中…");

  const context = () => ({ page: "overview", year, profile: "GIP_2026", availableYears: YEARS, overview });

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        if (!BACKEND_URL) throw new Error("请在构建网站前设置 NEXT_PUBLIC_XIAOYUN_BACKEND_URL");
        const { createVoiceAssistant } = await import("@xiaoyun/voice");
        if (disposed) return;
        voiceRef.current = createVoiceAssistant({
          projectId: PROJECT_ID,
          backendUrl: BACKEND_URL,
          assetBaseUrl: "/xiaoyun/",
          mode: "live",
          // Keep the character left of the 420px chat panel so it does not cover the input box.
          ui: { position: { right: 450, bottom: 22 } },
          context: context(),
          actions: [
            {
              name: "switch_year",
              description: "切换网页总览显示的统计年份（与页面顶部年份按钮相同）",
              parameters: {
                type: "object",
                properties: { year: { type: "integer", enum: YEARS, description: "统计年份" } },
                required: ["year"],
                additionalProperties: false,
              },
              execute: ({ year: target }: { year: number }) =>
                new Promise((resolve) => {
                  pendingYear.current = { year: Number(target), resolve };
                  router.push(`/?year=${Number(target)}`);
                }),
            },
          ],
          onEvent(event: any) {
            if (event.type === "error") console.warn("[xiaoyun]", event.message);
          },
        });
        setStatus("");
      } catch (err) {
        setStatus(`小云未连接：${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      disposed = true;
      voiceRef.current?.destroy();
      voiceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After the server re-renders with the new year, update the voice context and finish a pending switch_year.
  useEffect(() => {
    voiceRef.current?.updateContext(context());
    if (pendingYear.current?.year === year) {
      pendingYear.current.resolve({ year });
      pendingYear.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, overview]);

  useEffect(() => {
    (window as any).xiaoyun = { submitText: (t: string) => voiceRef.current?.submitText(t) };
  }, []);

  return status ? <div className="voice-status">{status}</div> : null;
}
