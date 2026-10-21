import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { IMPORT_TEMPLATES, REPO_ROOT } from "@xinyang/db-agent";
import { importData } from "@/lib/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST multipart/form-data { file: .xlsx, template, dryRun: "1" | "0", estimatedMethod?, note? }
 * Saves the upload under storage/uploads, then runs the standard import pipeline (dry run = validate and roll back).
 * A real import starts the governance step (semantic catalog, drafted descriptions, detection rules) in the background.
 */
export async function POST(request: Request) {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: "未登录或登录已过期" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const template = String(form.get("template") ?? "");
  const dryRun = form.get("dryRun") !== "0";
  if (!(file instanceof File) || !file.size) return Response.json({ error: "请选择要导入的 Excel 文件" }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return Response.json({ error: "只支持 .xlsx 文件（请使用平台导入模板）" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "文件超过 20 MB" }, { status: 400 });
  const spec = IMPORT_TEMPLATES.find((row) => row.code === template);
  if (!spec) return Response.json({ error: "未知的导入模板" }, { status: 400 });

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const safeName = file.name.replace(/[^\w.\-一-龥（）()]/g, "_").slice(-80);
  const dir = path.join(REPO_ROOT, "storage", "uploads");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${stamp}_${safeName}`);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  try {
    const result = await importData({
      filePath, templateCode: spec.code, dryRun, by: session.user,
      estimatedMethod: String(form.get("estimatedMethod") ?? "").trim() || undefined,
      note: String(form.get("note") ?? "").trim() || undefined,
    });
    return Response.json({ ok: true, template: spec.name, file: file.name, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
