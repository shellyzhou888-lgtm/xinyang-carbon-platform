import { notFound } from "next/navigation";
import Home from "@/app/(platform)/page";
import Energy from "@/app/(platform)/energy/page";
import Carbon from "@/app/(platform)/carbon/page";
import Diagnosis from "@/app/(platform)/diagnosis/page";
import Enterprises from "@/app/(platform)/enterprises/page";
import DisplayScene from "@/components/DisplayScene";
import { DISPLAY_MODULES } from "@/lib/presentation";
import { selectedYear } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** A separate rendering route. The original routes, layouts and components stay unchanged. */
export default async function DisplayView({ searchParams }: { searchParams: Promise<{ module?: string; slide?: string; year?: string }> }) {
  const sp = await searchParams;
  const module = DISPLAY_MODULES.find(item => item.key === sp.module);
  const slide = module?.slides.find(item => item.key === sp.slide);
  if (!module || !slide) notFound();
  const params = Promise.resolve({ year: String(selectedYear(sp.year)), tab: slide.tab });
  const content = slide.path === "/energy" ? <Energy searchParams={params} />
    : slide.path === "/carbon" ? <Carbon searchParams={params} />
    : slide.path === "/diagnosis" ? <Diagnosis searchParams={params} />
    : slide.path === "/enterprises" ? <Enterprises searchParams={params} />
    : <Home searchParams={params} />;
  return <DisplayScene moduleKey={module.key} slide={slide}>{content}</DisplayScene>;
}
