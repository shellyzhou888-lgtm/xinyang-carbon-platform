// Xiaoyun backend project module (loaded by `xiaoyun start` via VOICE_PROJECT_MODULE=./voice-project.mjs).
// It runs in the voice backend process, not in the browser. Database tools come from the db-agent package,
// which reads DATABASE_URL from the repository .env; nothing secret is placed in this file.
import { defineProject } from "@xiaoyun/voice/server";
import { createVoiceTools } from "@xinyang/db-agent/voice";

export default defineProject({
  id: "xinyang-park",
  description: [
    "信阳经济技术开发区绿色园区能碳管理平台。数据在 PostgreSQL，只能通过 park_ 开头的项目工具读取，不要用 query_sql（那是 SQLite 白名单，本项目没有）。",
    "单位：综合能耗 tce（吨标准煤）；碳排放 tCO2；产值、增加值 万元；单位增加值能耗 tce/万元。",
    "评价口径默认 GIP_2026（2026 年度国家级绿色工业园区）；园区 2024 年已是河南省级绿色工业园区。",
    "当前很多能耗与统计数据是模拟估算值（estimated），回答数字时要说明含模拟数据、不能作为申报依据。",
    "简单的总览问题直接用 park_overview；指标、因子、能耗/碳排放明细按 park-energy-carbon Skill 执行。",
    "页面动作 switch_year 可切换网页显示年份（2023–2025）。",
  ].join("\n"),
  skills: ["./voice/skills/park-energy-carbon"],
  tools: createVoiceTools(),
});
