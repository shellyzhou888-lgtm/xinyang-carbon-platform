"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ChatPanel from "./ChatPanel";
import VoiceAssistant from "./VoiceAssistant";
import { HealthProvider, useHealth } from "./HealthContext";
import { IconAdmin, IconCarbon, IconChat, IconClose, IconDiagnosis, IconDirectory, IconEnergy, IconLogout, IconMoon, IconOverview, IconSun } from "./icons";
import { selectedYear } from "@/lib/workspace";
import { logout } from "@/app/login/actions";

const NAV = [
  { href: "/", label: "总览", title: "园区运行总览", Icon: IconOverview, match: (p: string) => p === "/" },
  { href: "/energy", label: "能源", title: "能源管理", Icon: IconEnergy, match: (p: string) => p.startsWith("/energy") },
  { href: "/carbon", label: "碳排", title: "碳排管理", Icon: IconCarbon, match: (p: string) => p.startsWith("/carbon") },
  { href: "/diagnosis", label: "诊断", title: "能碳综合诊断", Icon: IconDiagnosis, match: (p: string) => p.startsWith("/diagnosis") },
  { href: "/enterprises", label: "名录", title: "企业与项目名录", Icon: IconDirectory, match: (p: string) => p.startsWith("/enterprises") },
  { href: "/admin/data", label: "后台", title: "后台管理", Icon: IconAdmin, match: (p: string) => p.startsWith("/admin") },
];

export default function PlatformShell({ children, user }: { children: React.ReactNode; user: string }) {
  return <HealthProvider><Shell user={user}>{children}</Shell></HealthProvider>;
}

function Shell({ children, user }: { children: React.ReactNode; user: string }) {
  const path = usePathname();
  const params = useSearchParams();
  const year = selectedYear(params.get("year") || undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [themeRevision, setThemeRevision] = useState(0);
  // The inline script in the root layout applied the saved theme before paint; mirror it into state.
  useEffect(() => { if (document.documentElement.dataset.theme === "light") setTheme("light"); }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("xy-theme", next); } catch { /* private mode: theme only lasts for this page */ }
    setTheme(next);
    setThemeRevision((n) => n + 1);
  };
  const chatButton = useRef<HTMLButtonElement>(null);
  const active = NAV.find((item) => item.match(path));
  const screen = path === "/";
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && chatOpen) { setChatOpen(false); chatButton.current?.focus(); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [chatOpen]);

  // The AMap SDK (loaded from its CDN) occasionally rejects internal promises with a bare `null` while tiles or layers are
  // torn down; there is nothing to report and the dev overlay turned it into a full-screen "Runtime Error: null".
  // Only that exact case is silenced; every rejection carrying a reason still surfaces normally.
  useEffect(() => {
    const ignoreNull = (event: PromiseRejectionEvent) => {
      if (event.reason !== null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      console.warn("[platform] ignored a promise rejected with null (third-party map SDK)");
    };
    // Capture phase runs before the Next.js dev overlay's own (bubble) listener on window.
    window.addEventListener("unhandledrejection", ignoreNull, { capture: true });
    return () => window.removeEventListener("unhandledrejection", ignoreNull, { capture: true });
  }, []);

  return <div className="app" data-chat-open={chatOpen} data-screen={screen ? "overview" : undefined} data-module={path === "/energy" || path === "/carbon" || path === "/diagnosis" || path === "/admin/data" ? "workspace" : undefined}>
    <a className="skip-link" href="#workspace-content">跳转到主要内容</a>
    <aside className="rail" aria-label="主导航">
      <Link className="rail-logo" href={`/?year=${year}`} aria-label="返回园区总览">
        <Image src="/brand/logo-symbol-on-dark.svg" alt="" width={40} height={40} priority unoptimized />
      </Link>
      <nav className="rail-nav">
        {NAV.map(({ href, label, title, Icon }) => {
          const on = active?.href === href;
          return <Link key={href} href={`${href}?year=${year}`} className={`rail-item ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} title={title}>
            {on && <motion.span layoutId="rail-active" className="rail-active" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <Icon size={21} /><span>{label}</span>
          </Link>;
        })}
      </nav>
      <div className="rail-bottom">
        <button type="button" ref={chatButton} className={`rail-item manager-launch ${chatOpen ? "on" : ""}`} aria-expanded={chatOpen} onClick={() => setChatOpen((open) => !open)} title="小云总管 · 跨板块调度助手">
          <IconChat size={24} /><span>问总管</span>
        </button>
      </div>
    </aside>

    <div className="app-main">
      <header className="topbar">
        <div className="topbar-title">
          {/* The rail already shows the logo mark; the bar carries only the platform name. */}
          <span className="topbar-name">信阳经开区能碳管理平台</span>
        </div>
        <div className="topbar-right">
          <StatusPill />
          <Clock />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <UserMenu user={user} />
        </div>
      </header>
      {/* Remount on a theme switch so charts and maps rebuild with the new colour tokens. */}
      <main id="workspace-content" className="page" key={themeRevision}>{children}</main>
    </div>

    <AnimatePresence>
      {chatOpen && <motion.section className="assistant-drawer" aria-label="小云总管助手"
        initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
        <div className="assistant-bar"><div><b>小云 · 园区总管</b><small>按板块调度，可跨板块追问</small></div>
          <button type="button" className="icon-btn" aria-label="关闭数据助手" onClick={() => { setChatOpen(false); chatButton.current?.focus(); }}><IconClose /></button></div>
        <ChatPanel />
      </motion.section>}
    </AnimatePresence>
    <VoiceAssistant year={year} overview={null} page={path} />
  </div>;
}

function StatusPill() {
  const { health, refresh } = useHealth();
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: MouseEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const level = health.loading && !health.checkedAt ? "pending" : !health.db.ok ? "down" : health.agent.ok && health.voice.ok ? "ok" : "partial";
  const text = { pending: "检测连接…", down: "数据未连接", partial: "数据已连接", ok: "全部在线" }[level];
  const rows = [
    { name: "园区数据库", ok: health.db.ok, detail: health.db.ok ? `PostgreSQL · ${health.db.ms} ms` : health.db.error || "未检测" },
    { name: "AI 数据助手", ok: health.agent.ok, detail: health.agent.ok ? "DeepSeek 模型密钥已配置" : "未配置 DEEPSEEK_API_KEY，文字助手暂不可用" },
    { name: "小云语音", ok: health.voice.ok, detail: health.voice.ok ? "语音后台在线" : "语音后台未启动（npm run voice）" },
  ];
  return <div className="status" ref={host}>
    <button type="button" className={`status-pill ${level}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <i aria-hidden="true" />{text}
    </button>
    <AnimatePresence>{open && <motion.div className="status-pop" role="dialog" aria-label="连接状态"
      initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
      <b>连接状态</b>
      {rows.map((row) => <div key={row.name} className={`status-row ${row.ok ? "ok" : "down"}`}><i aria-hidden="true" /><div><span>{row.name}</span><small>{row.detail}</small></div></div>)}
      <button type="button" className="btn-ghost small" onClick={() => refresh(true)} disabled={health.loading}>{health.loading ? "检测中…" : "重新检测"}</button>
    </motion.div>}</AnimatePresence>
  </div>;
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 15_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  if (!now) return <div className="clock" aria-hidden="true" />;
  return <div className="clock" aria-label="当前时间">
    <small>{now.toLocaleDateString("zh-CN", { weekday: "short" })}<br />{now.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</small>
    <b>{now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</b>
  </div>;
}

function UserMenu({ user }: { user: string }) {
  return <form action={logout} className="user-menu">
    <span className="avatar" aria-hidden="true">{(user || "访").slice(0, 1).toUpperCase()}</span>
    <span className="user-name">{user || "访客"}</span>
    <button type="submit" className="icon-btn" title="退出登录" aria-label="退出登录"><IconLogout /></button>
  </form>;
}

function ThemeToggle({ theme, onToggle }: { theme: "dark" | "light"; onToggle: () => void }) {
  const light = theme === "light";
  return <button type="button" className="theme-toggle" onClick={onToggle} aria-label={light ? "切换到深色" : "切换到浅色"} title={light ? "切换到深色" : "切换到浅色"}>
    <motion.span key={theme} initial={{ rotate: -60, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: 0.3 }}>{light ? <IconMoon /> : <IconSun />}</motion.span>
  </button>;
}
