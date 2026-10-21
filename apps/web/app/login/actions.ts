"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfigured, checkCredentials, createSession, safeNext, SESSION_COOKIE, SESSION_HOURS } from "@/lib/auth";

export type LoginState = { error?: string };

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  if (!authConfigured()) return { error: "尚未配置登录账户：请在 apps/web/.env.local 中设置 AUTH_USERNAME、AUTH_PASSWORD、AUTH_SECRET 后重启网站。" };
  const user = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  if (!user || !password) return { error: "请输入账号和密码" };
  // A small fixed delay blunts rapid guessing without adding state.
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!(await checkCredentials(user, password))) return { error: "账号或密码不正确" };
  (await cookies()).set(SESSION_COOKIE, await createSession(user), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600,
    secure: process.env.NODE_ENV === "production" && process.env.AUTH_INSECURE_COOKIE !== "true",
  });
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
