import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "信阳经开区能碳管理平台",
  description: "园区能耗、碳排放与绿色工业园区指标；数据库 Agent 与小云语音助手",
};

export const viewport: Viewport = { themeColor: "#0c0d10", colorScheme: "dark light" };

// Applies the saved theme before first paint (no flash); PlatformShell owns the toggle.
const THEME_SCRIPT = `try{var t=localStorage.getItem("xy-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
