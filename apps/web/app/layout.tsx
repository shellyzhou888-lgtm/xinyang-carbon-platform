import type { Metadata } from "next";
import "./globals.css";
import { Suspense } from "react";
import PlatformShell from "@/components/PlatformShell";

export const metadata: Metadata = {
  title: "信阳经开区能碳管理平台",
  description: "园区能耗、碳排放与绿色工业园区指标；数据库 Agent 与小云语音助手",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body><Suspense fallback={<div className="workspace-content" role="status">正在加载园区工作台…</div>}><PlatformShell>{children}</PlatformShell></Suspense></body>
    </html>
  );
}
