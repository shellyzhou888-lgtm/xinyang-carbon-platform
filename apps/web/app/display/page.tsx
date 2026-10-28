import PresentationPlayer from "@/components/PresentationPlayer";
import { selectedYear } from "@/lib/workspace";

export default async function Display({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  return <PresentationPlayer year={selectedYear((await searchParams).year)} />;
}
