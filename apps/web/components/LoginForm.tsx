"use client";

import { useActionState, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { login, type LoginState } from "@/app/login/actions";

export default function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="login-form">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>账号</span>
        <input name="username" autoComplete="username" placeholder="请输入账号" required autoFocus />
      </label>
      <label className="field">
        <span>密码</span>
        <div className="field-row">
          <input name="password" type={show ? "text" : "password"} autoComplete="current-password" placeholder="请输入密码" required />
          <button type="button" className="field-toggle" onClick={() => setShow((value) => !value)} aria-label={show ? "隐藏密码" : "显示密码"}>{show ? "隐藏" : "显示"}</button>
        </div>
      </label>
      <AnimatePresence>
        {(state.error || !configured) && (
          <motion.p className="login-error" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {state.error || "尚未配置登录账户：请在 apps/web/.env.local 中设置 AUTH_USERNAME、AUTH_PASSWORD、AUTH_SECRET 后重启网站。"}
          </motion.p>
        )}
      </AnimatePresence>
      <motion.button type="submit" className="btn-primary login-submit" disabled={pending} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
        {pending ? <><span className="spinner" aria-hidden="true" />正在验证…</> : "登录平台"}
      </motion.button>
    </form>
  );
}
