"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { DISPLAY_CHANNEL, DISPLAY_MODULES, DISPLAY_SLIDE_COUNT, displayFrameHref, originalViewHref, type DisplayModule } from "@/lib/presentation";
import { YEARS } from "@/lib/workspace";
import styles from "./PresentationPlayer.module.css";

export default function PresentationPlayer({ year }: { year: number }) {
  const root = useRef<HTMLDivElement>(null), catalog = useRef<HTMLDialogElement>(null);
  const [playing, setPlaying] = useState(true), [seconds, setSeconds] = useState(25);
  const [visible, setVisible] = useState(true), [full, setFull] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    const fullscreen = () => setFull(!!document.fullscreenElement);
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element).closest("input,select,textarea,button,a,dialog[open]")) return;
      if (event.key === " ") { event.preventDefault(); setPlaying(value => !value); }
      if (event.key === "Escape") setExpanded(null);
    };
    change(); document.addEventListener("visibilitychange", change);
    document.addEventListener("fullscreenchange", fullscreen); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("visibilitychange", change); document.removeEventListener("fullscreenchange", fullscreen); window.removeEventListener("keydown", key); };
  }, []);
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setError("浏览器未允许全屏，可继续在当前窗口观看。"); }
  };
  return <div ref={root} className={styles.player}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/brand/logo-symbol-on-dark.svg" alt="" /><div><h1>信阳经开区 · 平台全景大屏</h1><p>总览 · 能源 · 碳排 · 诊断　/　四区同屏，完整界面自动轮播</p></div></div>
      <div className={styles.controls}>
        <label>统计年份<select aria-label="大屏统计年份" value={year} onChange={event => { window.location.href = `/display?year=${event.target.value}`; }}>{YEARS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>切换间隔<select aria-label="完整界面轮播间隔" value={seconds} onChange={event => setSeconds(Number(event.target.value))}>{[10, 15, 25, 40, 60].map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label>
        <button type="button" className={styles.play} onClick={() => setPlaying(value => !value)}>{playing ? "暂停全部" : "开始轮播"}</button>
        <button type="button" onClick={() => catalog.current?.showModal()}>内容目录</button>
        <button type="button" onClick={fullscreen}>{full ? "退出全屏" : "全屏展示"}</button>
        <Link href={`/?year=${year}`}>原平台 ↗</Link>
      </div>
    </header>
    {error && <p className={styles.notice} role="status">{error}</p>}
    <main className={styles.wall} aria-label="四区同屏轮播" data-expanded={expanded ?? undefined}>
      {DISPLAY_MODULES.map((module, index) => <DisplayTile key={module.key} module={module} ordinal={index + 1} year={year}
        playing={playing && visible && (!expanded || expanded === module.key)} seconds={seconds}
        expanded={expanded === module.key} hidden={!!expanded && expanded !== module.key}
        onPause={() => setPlaying(false)} onExpand={() => setExpanded(value => value === module.key ? null : module.key)} />)}
    </main>
    <footer className={styles.footer}><span><i data-playing={playing && visible} />{playing && visible ? "四区自动轮播中" : "已暂停，可手动切换"}</span><span>5 个前台模块 · {DISPLAY_SLIDE_COUNT} 个完整按钮界面 · 保留同一界面内的全部图表</span><span>原页面数据与组件 · 后台不参与展示</span></footer>
    <dialog className={styles.catalog} ref={catalog}>
      <header><div><span>PLATFORM CONTENTS</span><h2>大屏内容目录</h2><p>每次切换展示对应按钮下的整组内容。</p></div><button type="button" onClick={() => catalog.current?.close()} aria-label="关闭内容目录">×</button></header>
      <div>{DISPLAY_MODULES.map(module => <section key={module.key}><h3 style={{ color: module.color }}>{module.label}</h3><ol>{module.slides.map(slide => <li key={slide.key}>{slide.label}</li>)}</ol></section>)}</div>
    </dialog>
  </div>;
}

function DisplayTile({ module, ordinal, year, playing, seconds, expanded, hidden, onPause, onExpand }: {
  module: DisplayModule; ordinal: number; year: number; playing: boolean; seconds: number;
  expanded: boolean; hidden: boolean; onPause: () => void; onExpand: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null), viewport = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0), [reload, setReload] = useState(0), [readyKey, setReadyKey] = useState("");
  const [progress, setProgress] = useState(0), [error, setError] = useState("");
  const [panelCount, setPanelCount] = useState(0);
  const [size, setSize] = useState({ width: 900, height: 390 });
  const slide = module.slides[index], frameKey = `${slide.key}:${reload}`, ready = readyKey === frameKey;
  const baseWidth = 1800, baseHeight = Math.max(780, Math.round(baseWidth * size.height / Math.max(1, size.width)));
  const scale = Math.min(size.width / baseWidth, size.height / baseHeight);
  const post = useCallback((type: string, payload: object = {}) => frame.current?.contentWindow?.postMessage({ channel: DISPLAY_CHANNEL, type, ...payload }, window.location.origin), []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== DISPLAY_CHANNEL || event.data.module !== module.key || event.data.slide !== slide.key) return;
      if (event.data.type === "ready") { setReadyKey(frameKey); setPanelCount(Number(event.data.panels) || 0); setError(""); }
      if (event.data.type === "error") setError("当前按钮界面未能加载，可重试或切换下一界面。");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [module.key, slide.key, frameKey]);
  useEffect(() => {
    setError(""); setProgress(0);
    if (ready) return;
    const probe = window.setInterval(() => post("inspect"), 700);
    const timeout = window.setTimeout(() => setError("加载超时，请重试；登录过期时请返回原平台登录。"), 45_000);
    return () => { window.clearInterval(probe); window.clearTimeout(timeout); };
  }, [frameKey, ready, post]);
  useEffect(() => {
    if (!ready || !playing) return;
    const start = performance.now();
    post("scroll", { progress: 0 });
    const timer = window.setInterval(() => {
      const next = Math.min(1, (performance.now() - start) / (seconds * 1000));
      setProgress(next);
      post("scroll", { progress: Math.max(0, Math.min(1, (next - .22) / .6)) });
      if (next >= 1) { window.clearInterval(timer); setIndex(value => (value + 1) % module.slides.length); }
    }, 140);
    return () => window.clearInterval(timer);
  }, [ready, playing, seconds, frameKey, module.slides.length, post]);
  const go = (next: number) => { onPause(); setIndex((next + module.slides.length) % module.slides.length); setProgress(0); post("scroll", { progress: 0 }); };
  return <section className={styles.tile} style={{ "--module-color": module.color } as CSSProperties} data-module-tile={module.key} data-hidden={hidden} data-expanded={expanded} data-ready={ready} data-slide={slide.key} data-panel-count={panelCount} aria-label={module.label}>
    <header className={styles.tileHeader}><div className={styles.moduleName}><span>0{ordinal}</span><div><h2>{module.label}</h2><small>{module.english}</small></div></div><div className={styles.current}><b>{slide.label}</b><small>{index + 1} / {module.slides.length}</small></div><button type="button" onClick={onExpand} aria-label={`${expanded ? "还原" : "放大"}${module.label}`}>{expanded ? "四区同屏" : "放大 ↗"}</button></header>
    <div ref={viewport} className={styles.viewport}>
      <iframe key={frameKey} ref={frame} src={displayFrameHref(module, slide, year)} title={`${module.label} · ${slide.label}完整界面`} aria-hidden={hidden} tabIndex={-1}
        style={{ width: baseWidth, height: baseHeight, transform: `translate(-50%,-50%) scale(${scale})` }} data-loaded={ready}
        onLoad={() => {
          try { if (frame.current?.contentWindow?.location.pathname === "/login") { setError("登录已过期，请返回原平台登录后重新打开大屏。"); return; } } catch { /* load timeout supplies a visible error */ }
          post("inspect");
        }} />
      {!ready && !error && <div className={styles.loading} role="status"><i />正在载入 {slide.label} 的完整内容</div>}
      {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>重新加载</button><button type="button" onClick={() => go(index + 1)}>下一界面</button><Link href="/login?next=%2Fdisplay">返回登录</Link></div>}
    </div>
    <footer className={styles.tileFooter}><button type="button" onClick={() => go(index - 1)} aria-label={`${module.label}上一界面`}>‹</button><nav aria-label={`${module.label}轮播界面`}>{module.slides.map((item, i) => <button key={item.key} type="button" onClick={() => go(i)} aria-current={i === index ? "step" : undefined} aria-label={`${module.label}：${item.label}`} title={item.label} />)}</nav><span>{ready ? playing ? `${Math.ceil(seconds * (1 - progress))} 秒后切换` : "已暂停" : "正在加载"}</span><Link href={originalViewHref(slide, year)} target="_blank" rel="noreferrer">查看原页 ↗</Link><button type="button" onClick={() => go(index + 1)} aria-label={`${module.label}下一界面`}>›</button></footer>
    <div className={styles.progress}><i style={{ width: `${progress * 100}%` }} /></div>
  </section>;
}
