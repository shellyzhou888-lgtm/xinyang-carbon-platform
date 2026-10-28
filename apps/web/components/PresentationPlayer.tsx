"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRESENTATION_CHANNEL, PRESENTATION_MODULES, PRESENTATION_VIEWS, presentationHref, type PresentationBlock } from "@/lib/presentation";
import { YEARS } from "@/lib/workspace";
import styles from "./PresentationPlayer.module.css";

export default function PresentationPlayer({ year }: { year: number }) {
  const frame = useRef<HTMLIFrameElement>(null), stage = useRef<HTMLDivElement>(null);
  const [viewIndex, setViewIndex] = useState(0), [blockIndex, setBlockIndex] = useState(0);
  const [blocks, setBlocks] = useState<PresentationBlock[]>([]), [catalog, setCatalog] = useState<Record<string, PresentationBlock[]>>({});
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(true), [seconds, setSeconds] = useState(20);
  const [progress, setProgress] = useState(0), [visible, setVisible] = useState(true), [menu, setMenu] = useState(true);
  const [error, setError] = useState(""), [full, setFull] = useState(false), [reload, setReload] = useState(0);
  const pendingBlock = useRef(0), initialized = useRef(false);
  const view = PRESENTATION_VIEWS[viewIndex], href = presentationHref(viewIndex, year, true);
  const post = useCallback((type: string, payload: object = {}) => frame.current?.contentWindow?.postMessage({ channel: PRESENTATION_CHANNEL, type, ...payload }, window.location.origin), []);
  const go = useCallback((index: number, block = 0) => {
    initialized.current = false; pendingBlock.current = block;
    setReady(false); setBlocks([]); setBlockIndex(0); setProgress(0); setError("");
    setViewIndex((index + PRESENTATION_VIEWS.length) % PRESENTATION_VIEWS.length);
  }, []);
  const step = useCallback((direction: number) => {
    if (!ready) return;
    const next = blockIndex + direction;
    if (next >= 0 && next < blocks.length) { setBlockIndex(next); setProgress(0); }
    else go(viewIndex + direction, direction < 0 ? -1 : 0);
  }, [ready, blockIndex, blocks.length, go, viewIndex]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== PRESENTATION_CHANNEL || event.data.path !== view.path) return;
      if (event.data.type === "ready" && Array.isArray(event.data.blocks) && event.data.blocks.length) {
        const next = event.data.blocks.filter((block: PresentationBlock) => typeof block.id === "string" && typeof block.title === "string") as PresentationBlock[];
        if (!next.length) return;
        setBlocks(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
        setCatalog(current => JSON.stringify(current[view.id]) === JSON.stringify(next) ? current : { ...current, [view.id]: next });
        if (!initialized.current) {
          initialized.current = true;
          setBlockIndex(pendingBlock.current < 0 ? next.length - 1 : Math.min(pendingBlock.current, next.length - 1));
        } else setBlockIndex(current => Math.min(current, next.length - 1));
        setReady(true); setError("");
      }
      if (event.data.type === "interact") setPlaying(false);
      if (event.data.type === "key") {
        if (event.data.key === " ") setPlaying(current => !current);
        else { setPlaying(false); step(event.data.key === "ArrowRight" ? 1 : -1); }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [view.id, view.path, step]);
  useEffect(() => {
    if (ready) { post("focus", { index: blockIndex }); post("scroll", { progress: 0 }); }
  }, [ready, blockIndex, post]);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    const fullscreen = () => setFull(!!document.fullscreenElement);
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element).closest("input,select,textarea,button,a")) return;
      if (event.key === " ") { event.preventDefault(); setPlaying(current => !current); }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setPlaying(false); step(event.key === "ArrowRight" ? 1 : -1); }
    };
    change(); document.addEventListener("visibilitychange", change); document.addEventListener("fullscreenchange", fullscreen); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("visibilitychange", change); document.removeEventListener("fullscreenchange", fullscreen); window.removeEventListener("keydown", key); };
  }, [step]);
  useEffect(() => {
    if (!playing || !ready || !visible) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      const next = Math.min(1, (performance.now() - start) / (seconds * 1000));
      setProgress(next);
      // Hold the beginning and end so readers have time before/after a long board scrolls.
      post("scroll", { progress: Math.max(0, Math.min(1, (next - .18) / .65)) });
      if (next >= 1) { window.clearInterval(timer); step(1); }
    }, 120);
    return () => window.clearInterval(timer);
  }, [playing, ready, visible, seconds, viewIndex, blockIndex, post, step]);
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => { setError("页面未能完成加载。可重试或选择其他界面；若登录已过期，请返回原网站重新登录。"); setPlaying(false); }, 45_000);
    return () => window.clearTimeout(timer);
  }, [ready, viewIndex, reload]);
  const selectView = (index: number) => { setPlaying(false); if (index !== viewIndex) go(index); };
  const retry = () => { initialized.current = false; pendingBlock.current = blockIndex; setReady(false); setError(""); setReload(value => value + 1); };
  const fullScreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.current?.requestFullscreen(); }
    catch { setError("浏览器未允许全屏，可以使用浏览器全屏快捷键继续展示。"); }
  };

  return <div className={styles.player} ref={stage}>
    <header className={styles.header}>
      <Link className={styles.brand} href={`/?year=${year}`}><img src="/brand/logo-symbol-on-dark.svg" alt="" /><span>信阳经开区能碳管理平台<small>前台界面 · 大屏轮播</small></span></Link>
      <div className={styles.controls}>
        <label>统计年份<select aria-label="轮播统计年份" value={year} onChange={event => { window.location.href = `/display?year=${event.target.value}`; }}>{YEARS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>每板块<select aria-label="每个板块展示时长" value={seconds} onChange={event => { setSeconds(Number(event.target.value)); setProgress(0); }}>{[10, 20, 30, 45, 60].map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label>
        <button type="button" onClick={() => setMenu(value => !value)} aria-pressed={menu}>界面目录</button>
        <button type="button" onClick={fullScreen}>{full ? "退出全屏" : "全屏展示"}</button>
        <Link href={presentationHref(viewIndex, year)} className={styles.back}>返回当前原页面 ↗</Link>
      </div>
    </header>
    <div className={styles.body} data-menu={menu}>
      {menu && <aside className={styles.catalog} aria-label="前台界面目录">
        <div className={styles.catalogTitle}><b>前台界面</b><span>5 个页面 · 17 个界面</span></div>
        {PRESENTATION_MODULES.map((module, i) => <section key={module.key}>
          <h2><span>0{i + 1}</span>{module.label}</h2>
          {PRESENTATION_VIEWS.map((item, index) => item.module === module.key && <button key={item.id} type="button" aria-current={index === viewIndex ? "step" : undefined} onClick={() => selectView(index)}>
            <span>{item.label}</span><small>{catalog[item.id]?.length ? `${catalog[item.id].length} 板块` : "›"}</small>
          </button>)}
        </section>)}
        <p>每个界面的小板块依次播完后，自动进入下一个界面。后台不参与轮播。</p>
      </aside>}
      <main className={styles.main}>
        <div className={styles.heading}><div><span>{view.moduleLabel} <i>/</i> {view.label}</span><h1>{ready ? blocks[blockIndex]?.title : "正在载入原页面…"}</h1></div><span className={styles.counter}>界面 {String(viewIndex + 1).padStart(2, "0")} / 17{ready && <small>板块 {blockIndex + 1} / {blocks.length}</small>}</span></div>
        <div className={styles.stage}>
          <iframe key={`${href}:${reload}`} ref={frame} src={href} title={`${view.moduleLabel} · ${view.label}原页面内容`} allow="fullscreen" className={ready ? styles.loaded : undefined}
            onLoad={() => {
              try { if (frame.current?.contentWindow?.location.pathname === "/login") { setError("登录已过期，请返回原网站重新登录后打开大屏。"); setPlaying(false); return; } } catch { /* loading state handles unavailable frames */ }
              post("inspect");
            }} />
          {!ready && <div className={styles.loading} role="status"><span className={styles.loader} />正在读取 {view.moduleLabel} · {view.label} 的原有板块</div>}
          {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={retry}>重新加载</button><button type="button" onClick={() => go(viewIndex + 1)}>下一个界面</button><Link href="/login?next=%2Fdisplay">返回登录</Link></div>}
        </div>
        <nav className={styles.blocks} aria-label="当前界面的小板块">{blocks.map((block, index) => <button key={block.id} type="button" aria-current={index === blockIndex ? "step" : undefined} onClick={() => { setPlaying(false); setBlockIndex(index); setProgress(0); }}><small>{String(index + 1).padStart(2, "0")}</small>{block.title}</button>)}</nav>
      </main>
    </div>
    <footer className={styles.footer}>
      <span>{playing && ready && visible ? "● 自动轮播" : !ready ? "等待页面就绪" : "Ⅱ 已暂停"}<small>原页面原数据 · 长内容自动滚动</small></span>
      <div><button type="button" disabled={!ready} onClick={() => { setPlaying(false); step(-1); }}>← 上一板块</button><button type="button" className={styles.play} disabled={!ready} onClick={() => { setPlaying(value => !value); setProgress(0); }}>{playing ? "暂停轮播" : "开始轮播"}</button><button type="button" disabled={!ready} onClick={() => { setPlaying(false); step(1); }}>下一板块 →</button></div>
      <span className={styles.remaining}>{ready ? playing ? `${Math.ceil(seconds * (1 - progress))} 秒后切换` : "手动浏览" : "正在加载"}<small>方向键切换 · 空格暂停 / 播放</small></span>
      <div className={styles.progress}><i style={{ width: `${progress * 100}%` }} /></div>
    </footer>
  </div>;
}
