import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Image from "next/image";
import ParkLineArt from "@/components/ParkLineArt";
import LoginForm from "@/components/LoginForm";
import { enterprises } from "@/lib/park-geography";
import { authConfigured, readSession, safeNext, SESSION_COOKIE } from "@/lib/auth";

export const metadata: Metadata = { title: "登录 · 信阳经开区能碳管理平台" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await readSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);
  return (
    <main className="login-page">
      <section className="login-visual" aria-hidden="false">
        <div className="login-visual-head">
          <Image src="/brand/logo-horizontal-on-dark.svg" alt="信阳经开区能碳管理平台" width={900} height={196} priority unoptimized className="login-logo only-dark" />
          <Image src="/brand/logo-horizontal-on-light.svg" alt="" width={900} height={196} priority unoptimized className="login-logo only-light" />
        </div>
        <ParkLineArt />
        <div className="login-visual-copy">
          <span className="eyebrow">XINYANG ECONOMIC-TECHNOLOGICAL DEVELOPMENT ZONE</span>
          <h1>能源与碳排放，<br />在一张图上协同管理。</h1>
          <p>汇聚园区企业能耗台账、碳排放核算与绿色工业园区指标，支撑 2026 年度绿色工业园区申报与日常运行。</p>
          <dl className="login-facts">
            <div><dt>规划功能片区</dt><dd>4</dd></div>
            <div><dt>企业点位</dt><dd>{enterprises.length}</dd></div>
            <div><dt>省级绿色工业园区</dt><dd>2024</dd></div>
          </dl>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">园区运营工作台</span>
          <h2>欢迎登录</h2>
          <p className="login-lead">使用平台账号访问能碳数据、诊断与后台管理。</p>
          <LoginForm next={next} configured={authConfigured()} />
        </div>
      </section>
    </main>
  );
}
