"use client";

import { useEffect, useRef } from "react";
import { PRESENTATION_CHANNEL, isPresentationPath, type PresentationBlock } from "@/lib/presentation";

/** Presents the mounted, original React content. No data copies or replacement charts. */
export default function PresentationSource({ children, path }: { children: React.ReactNode; path: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = root.current;
    if (!host || window.parent === window || !isPresentationPath(path)) return;
    let blocks: { element: HTMLElement; title: string; id: string }[] = [], active = 0, scanTimer = 0, resizeTimer = 0;
    const send = (type: string, payload: object = {}) => window.parent.postMessage({ channel: PRESENTATION_CHANNEL, type, path, ...payload }, window.location.origin);
    const focus = (index: number) => {
      if (!blocks[index]) return;
      active = index;
      host.querySelectorAll(".presentation-path,.presentation-active").forEach(el => el.classList.remove("presentation-path", "presentation-active"));
      const node = blocks[index].element;
      node.classList.add("presentation-active");
      for (let ancestor = node.parentElement; ancestor && host.contains(ancestor); ancestor = ancestor.parentElement) ancestor.classList.add("presentation-path");
      [node, ...Array.from(node.querySelectorAll<HTMLElement>("*"))].forEach(el => { if (el.scrollHeight > el.clientHeight) el.scrollTop = 0; });
      // Charts and maps already use resize observers. Also support charts listening to window.resize.
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
    };
    const scan = () => {
      const candidates: { element: HTMLElement; title: string }[] = [];
      const add = (selector: string, title?: string) => host.querySelectorAll<HTMLElement>(selector).forEach(element => {
        candidates.push({ element, title: title || element.querySelector(".panel-head h2")?.textContent?.trim() || element.getAttribute("aria-label") || "内容展示" });
      });
      add(".notice.danger", "数据连接提示");
      if (path === "/") {
        add(".map-stage", "园区空间总览");
        add(".indicator-board");
        add('.brief[aria-label="园区荣誉"]', "园区荣誉");
        add('.brief[aria-label="能源"]', "能源运行概况");
        add('.brief[aria-label="重点排放企业排名"]', "重点排放企业排名");
        add('.brief[aria-label="碳排放"]', "碳排运行概况");
      } else {
        add(".kpi-grid,.stats-row", "年度关键指标");
        host.querySelectorAll<HTMLElement>(".panel").forEach(element => {
          if (element.parentElement?.closest(".panel")) return;
          candidates.push({ element, title: element.querySelector(".panel-head h2")?.textContent?.trim() || (path === "/enterprises" ? "企业与项目名录" : "内容展示") });
        });
        add(".spatial", "问题定位地图");
        add(".spatial-list", "定位问题清单");
        add(".spatial-detail", "诊断对象详情");
      }
      if (!candidates.length) candidates.push({ element: host.querySelector<HTMLElement>("main")!, title: "当前页面暂无可展示板块" });
      const next = candidates.map((item, i) => ({ ...item, id: `block-${i}` }));
      const changed = next.length !== blocks.length || next.some((item, i) => item.element !== blocks[i]?.element || item.title !== blocks[i]?.title);
      if (changed) {
        const oldElement = blocks[active]?.element;
        blocks = next;
        active = Math.max(0, blocks.findIndex(item => item.element === oldElement));
        focus(active);
      }
      send("ready", { blocks: blocks.map(({ id, title }): PresentationBlock => ({ id, title })) });
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.channel !== PRESENTATION_CHANNEL) return;
      if (event.data.type === "inspect") scan();
      if (event.data.type === "focus" && Number.isInteger(event.data.index)) focus(event.data.index);
      if (event.data.type === "scroll" && typeof event.data.progress === "number") {
        const node = blocks[active]?.element;
        if (!node) return;
        const progress = Math.max(0, Math.min(1, event.data.progress));
        [node, ...Array.from(node.querySelectorAll<HTMLElement>("*"))].forEach(el => {
          if (el.scrollHeight > el.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = (el.scrollHeight - el.clientHeight) * progress;
        });
      }
    };
    const interact = () => send("interact");
    const links = (event: MouseEvent) => { if ((event.target as Element).closest("a")) event.preventDefault(); };
    const keys = (event: KeyboardEvent) => {
      if ((event.target as Element).closest("input,select,textarea,[contenteditable]")) return;
      if (["ArrowLeft", "ArrowRight", " "].includes(event.key)) { event.preventDefault(); send("key", { key: event.key }); }
    };
    const observer = new MutationObserver(() => { window.clearTimeout(scanTimer); scanTimer = window.setTimeout(scan, 160); });
    observer.observe(host, { childList: true, subtree: true });
    window.addEventListener("message", receive);
    host.addEventListener("pointerdown", interact);
    host.addEventListener("wheel", interact, { passive: true });
    host.addEventListener("click", links, true);
    document.addEventListener("keydown", keys);
    scan();
    return () => {
      observer.disconnect(); window.clearTimeout(scanTimer); window.clearTimeout(resizeTimer);
      window.removeEventListener("message", receive); host.removeEventListener("pointerdown", interact); host.removeEventListener("wheel", interact);
      host.removeEventListener("click", links, true); document.removeEventListener("keydown", keys);
    };
  }, [path]);
  return <div ref={root} className="app" data-presentation-source data-screen={path === "/" ? "overview" : undefined} data-module="workspace">
    <div className="app-main"><main className="page" id="workspace-content">{children}</main></div>
  </div>;
}
