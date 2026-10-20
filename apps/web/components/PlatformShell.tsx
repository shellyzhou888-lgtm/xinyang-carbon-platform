"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ChatPanel from "./ChatPanel";
import VoiceAssistant from "./VoiceAssistant";
import styles from "./PlatformBrand.module.css";
import { selectedYear, YEARS } from "@/lib/workspace";

const NAV = [
  { href: "/", label: "园区总览", detail: "园区态势与企业空间", icon: "◈" },
  { href: "/energy", label: "能源管理", detail: "消费 · 强度 · 能流", icon: "ϟ" },
  { href: "/carbon", label: "碳管理", detail: "核算 · 排放 · 碳流", icon: "◎" },
  { href: "/diagnosis", label: "能碳综合诊断", detail: "预警 · 溯源 · 策略", icon: "⌁" },
  { href: "/admin/data", label: "后台管理", detail: "数据 · 指标 · 治理", icon: "▦" },
];

export default function PlatformShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const params = useSearchParams();
  const year = selectedYear(params.get("year") || undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>setHydrated(true),[]);
  const chatButton = useRef<HTMLButtonElement>(null);
  const active = NAV.find(item => item.href === "/" ? path === "/" || path === "/enterprises" : path.startsWith(item.href.startsWith("/admin") ? "/admin" : item.href));
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && chatOpen) { setChatOpen(false); chatButton.current?.focus(); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [chatOpen]);
  const yearHref = (value: number) => { const query = new URLSearchParams(params.toString()); query.set("year", String(value)); return `${path}?${query}`; };
  return <div className="platform-shell" data-chat-open={chatOpen} data-hydrated={hydrated}>
    <a className="skip-link" href="#workspace-content">跳转到主要内容</a>
    <aside className="platform-rail">
      <Link className={styles.brand} href={`/?year=${year}`} aria-label="信阳经开区能碳管理平台，返回园区总览">
        <Image className={styles.logo} src="/brand/logo-horizontal-on-dark.svg" alt="" width={900} height={196} priority unoptimized />
      </Link>
      <div className="rail-caption">园区运营工作台</div>
      <nav aria-label="主导航">{NAV.map(item => {
        const on = item.href === active?.href;
        return <Link key={item.href} href={`${item.href}?year=${year}`} className={on ? "active" : ""} aria-current={on ? "page" : undefined}><span className="nav-symbol" aria-hidden="true">{item.icon}</span><span>{item.label}<small>{item.detail}</small></span></Link>;
      })}<Link className={`rail-sub-link ${path==="/enterprises"?"active":""}`} href={`/enterprises?year=${year}`}>企业与项目名录 ↗</Link></nav>
      <div className="rail-foot"><i /> GIP_2026<small>能源与碳排放协同管理</small></div>
    </aside>
    <div className="platform-body">
      <header className="platform-topbar"><div><span className="topbar-location">信阳经济技术开发区</span><span className="topbar-divider">/</span><span>{active?.label || "园区工作台"}</span></div>
        <nav className="years" aria-label="统计年份">{YEARS.map(value => <Link key={value} href={yearHref(value)} className={value === year ? "on" : ""} aria-current={value === year ? "true" : undefined}>{value} 年</Link>)}</nav>
      </header>
      <main id="workspace-content" className="workspace-content">{children}</main>
    </div>
    <section className="assistant-panel" aria-label="小云数据助手" hidden={!chatOpen}><div className="assistant-panel-bar"><span>小云 · 数据助手</span><button type="button" aria-label="关闭数据助手" onClick={() => { setChatOpen(false); chatButton.current?.focus(); }}>×</button></div><ChatPanel /></section>
    <button type="button" ref={chatButton} className="assistant-toggle" aria-expanded={chatOpen} onClick={() => setChatOpen(open => !open)}>{chatOpen ? "收起对话" : "小云助手"}<span aria-hidden="true">↗</span></button>
    <VoiceAssistant year={year} overview={null} page={path} />
  </div>;
}
