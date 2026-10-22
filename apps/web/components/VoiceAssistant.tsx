"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { probeVoice, voiceBackendUrl } from "@/lib/voice";

type Overview = { tce: number | null; co2_t: number | null; achieved: number; total: number } | null;

const PROJECT_ID = "xinyang-park";
const YEARS = [2023, 2024, 2025];

/**
 * Mounts the Xiaoyun voice assistant in the browser. Qwen handles speech; platform questions go
 * to the shared Pi manager through voice-project.mjs. The only page action
 * registered here is the same year switch as the year buttons at the top of the page.
 */
export default function VoiceAssistant({ year, overview, page = "/" }: { year: number; overview: Overview; page?: string }) {
  const router = useRouter();
  const mount = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<any>(null);
  const pendingYear = useRef<{ year: number; resolve: (v: unknown) => void } | null>(null);
  const [status, setStatus] = useState("");

  const currentPage = useRef(page);
  currentPage.current = page;
  const context = () => ({ page, year, profile: "GIP_2026", availableYears: YEARS, overview });

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        if (!window.isSecureContext) throw new Error("当前地址不能使用麦克风：请通过可信任的 HTTPS 地址访问网站");
        const backendUrl = voiceBackendUrl();
        if (window.location.protocol === "https:" && new URL(backendUrl).protocol !== "https:") {
          throw new Error("HTTPS 网站需要使用 HTTPS/WSS 小云后台地址");
        }
        // Without a running backend the SDK would retry its WebSocket and flood the console;
        // the top-bar status pill already explains how to start it.
        if (!(await probeVoice())) { if (!disposed) setStatus(""); return; }
        const { createVoiceAssistant } = await import("@xiaoyun/voice");
        if (disposed) return;
        voiceRef.current = createVoiceAssistant({
          container: mount.current || undefined,
          projectId: PROJECT_ID,
          backendUrl,
          assetBaseUrl: "/xiaoyun/",
          mode: "live",
          ui: { position: { right: 22, bottom: 22 } },
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
                  const query = new URLSearchParams(window.location.search);
                  query.set("year", String(Number(target)));
                  router.push(`${currentPage.current}?${query}`);
                }),
            },
          ],
          onEvent(event: any) {
            if (event.type === "error") console.warn("[xiaoyun]", event.message);
          },
        });
        // The SDK has no public avatar option. Its open shadow root lets the host
        // replace only the artwork, retaining the SDK's buttons, dragging and voice lifecycle.
        const shadow = mount.current?.querySelector("xiaoyun-voice")?.shadowRoot;
        if (shadow) {
          const style = document.createElement("style");
          style.dataset.parkAvatar = "carbon-cloud";
          style.textContent = `
            .xy-widget { --xy-size:104px; }
            .xy-character-button, .xy-character-button:hover, .xy-character-button:active,
            .xy-widget[data-dragging=true] .xy-character-button {
              border:0; border-radius:0; background:transparent; box-shadow:none; backdrop-filter:none;
            }
            .xy-character-button::before {
              inset:0; border:0; border-radius:0;
              background:center / contain no-repeat url('/mascots/carbon-cloud/animation.gif?v=0.44.1');
              z-index:2;
            }
            .xy-character-button::after { display:none; }
            .xy-character-svg { opacity:0; }
            .xy-character-halo { inset:18px; border-radius:50%; box-shadow:0 0 26px #c5f05c22; }
            .xy-character-button:focus-visible { outline:2px solid #c5f05c; outline-offset:3px; }
            @media (max-width:900px) {
              .xy-widget { right:14px!important; --xy-size:76px; }
              .xy-widget[data-state=mic_off] .xy-status[data-error=false] { display:none; }
            }
            @media (prefers-reduced-motion:reduce) {
              .xy-character-button::before { background-image:url('/mascots/carbon-cloud/poster.png?v=0.44.1'); }
            }
          `;
          shadow.appendChild(style);
        }
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
  }, [year, overview, page]);

  useEffect(() => {
    (window as any).xiaoyun = { submitText: (t: string) => voiceRef.current?.submitText(t) };
  }, []);

  return <><div ref={mount} className="voice-assistant-mount" />{status ? <div className="voice-status">{status}</div> : null}</>;
}
