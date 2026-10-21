import { readFile } from "node:fs/promises";
import { cookies } from "next/headers";
import { IMPORT_TEMPLATES, templatePath } from "@xinyang/db-agent";
import { readSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/** GET → the Excel template for one import template code. */
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  if (!(await readSession((await cookies()).get(SESSION_COOKIE)?.value))) return Response.json({ error: "未登录或登录已过期" }, { status: 401 });
  const { code } = await context.params;
  const spec = IMPORT_TEMPLATES.find((row) => row.code === code);
  if (!spec) return Response.json({ error: "未知的导入模板" }, { status: 404 });
  const body = await readFile(templatePath(spec.file));
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${spec.name}.xlsx`)}`,
    },
  });
}
