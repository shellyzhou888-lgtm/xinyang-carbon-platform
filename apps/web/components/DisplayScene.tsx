"use client";

import { useEffect, useRef } from "react";
import { DISPLAY_CHANNEL, type DisplaySlide } from "@/lib/presentation";
import styles from "./DisplayScene.module.css";

/** Drives the original buttons in this separate render only. It never isolates a panel. */
export default function DisplayScene({ children, moduleKey, slide }: { children: React.ReactNode; moduleKey: string; slide: DisplaySlide }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let timer = 0, sent = false;
    const send = (type: string, payload: object = {}) => {
      if (window.parent !== window) window.parent.postMessage({ channel: DISPLAY_CHANNEL, type, module: moduleKey, slide: slide.key, ...payload }, window.location.origin);
    };
    const prepare = () => {
      if (slide.pager) {
        const button = Array.from(host.querySelectorAll<HTMLButtonElement>(".section-pager-tabs button")).find(item => item.textContent?.replace(/^\s*\d+\s*/, "").trim() === slide.pager);
        if (!button) return;
        if (button.getAttribute("aria-selected") !== "true") { button.click(); return; }
      }
      if (slide.zone) {
        const button = Array.from(host.querySelectorAll<HTMLButtonElement>('.segmented[aria-label="产业片区"] button')).find(item => item.textContent?.trim() === slide.zone);
        if (!button) return;
        if (button.getAttribute("aria-pressed") !== "true") { button.click(); return; }
      }
      if (!sent) {
        sent = true;
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("resize"));
          send("ready", { title: slide.label, panels: host.querySelectorAll(".panel,.float-card").length });
        });
      }
    };
    const observer = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(prepare, 80); });
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-pressed"] });
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.channel !== DISPLAY_CHANNEL) return;
      if (event.data.type === "inspect") { sent = false; prepare(); }
      if (event.data.type === "scroll" && typeof event.data.progress === "number") {
        const progress = Math.max(0, Math.min(1, event.data.progress));
        const scrollables = [document.scrollingElement, ...Array.from(host.querySelectorAll<HTMLElement>("*"))];
        scrollables.forEach(element => {
          if (element && element.scrollHeight > element.clientHeight + 12 && (element === document.scrollingElement || /auto|scroll/.test(getComputedStyle(element).overflowY))) element.scrollTop = (element.scrollHeight - element.clientHeight) * progress;
        });
      }
    };
    window.addEventListener("message", receive);
    prepare();
    const timeout = window.setTimeout(() => { if (!sent) send("error", { message: "当前按钮界面未能加载，请重试。" }); }, 12_000);
    return () => { observer.disconnect(); window.clearTimeout(timer); window.clearTimeout(timeout); window.removeEventListener("message", receive); };
  }, [moduleKey, slide]);

  return <div ref={root} className={`app ${styles.scene}`} data-display-scene={moduleKey} data-display-slide={slide.key}
    data-screen={slide.path === "/" ? "overview" : undefined} data-module="workspace">
    <div className="app-main"><main className="page" id="workspace-content">{children}</main></div>
  </div>;
}
