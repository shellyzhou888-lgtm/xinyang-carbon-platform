import { Suspense } from "react";
import { cookies } from "next/headers";
import PlatformShell from "@/components/PlatformShell";
import { readSession, SESSION_COOKIE } from "@/lib/auth";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <Suspense fallback={<div className="boot-screen" role="status"><span />正在加载园区工作台…</div>}>
      <PlatformShell user={session?.user ?? ""}>{children}</PlatformShell>
    </Suspense>
  );
}
