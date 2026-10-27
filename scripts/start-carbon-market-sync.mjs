import { existsSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "storage/automation");
const pidFile = path.join(dir, "carbon-market-sync.json");
const script = path.join(root, "packages/ingest/src/carbon-market-sync.ts");
const tsx = path.join(root, "packages/ingest/node_modules/tsx/dist/cli.mjs");
mkdirSync(dir, { recursive: true });
let running = false;
try {
  const { pid } = JSON.parse(readFileSync(pidFile, "utf8"));
  if (Number.isInteger(pid) && pid > 1) {
    process.kill(pid, 0);
    running = process.platform === "win32" || execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes("carbon-market-sync.ts");
  }
} catch { /* Missing / stale process metadata can be replaced without touching data. */ }
if (running) {
  console.log("[carbon-market] 已有碳价同步进程，复用现有任务");
} else if (!existsSync(tsx)) {
  console.warn("[carbon-market] 未找到 ingest 依赖，请在 packages/ingest 安装依赖后运行 npm run sync:carbon -- --watch");
} else {
  const log = path.join(dir, "carbon-market-sync.log");
  const fd = openSync(log, "a");
  const child = spawn(process.execPath, [tsx, script, "--watch"], { cwd: root, detached: true, stdio: ["ignore", fd, fd], env: process.env, windowsHide: true });
  closeSync(fd);
  child.on("error", error => console.warn(`[carbon-market] 同步进程未启动：${error.message}`));
  if (child.pid) {
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), script, log }, null, 2));
    child.unref();
    console.log(`[carbon-market] 已启动每日行情自动同步（每 5 分钟检查，PID ${child.pid}）`);
  }
}
