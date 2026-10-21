import { formatNumber as fmt } from "@/lib/workspace";

/** Compact vertical contribution bars for the dashboard side panel. */
export default function CompositionStages({ rows, unit, tone = "energy" }: {
  rows: { name: string; value: number }[]; unit: string; tone?: "energy" | "carbon";
}) {
  const ranked = [...rows].filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const max = ranked[0]?.value || 1;
  return <div className={`composition-stages ${tone}`} role="img" aria-label={`${tone === "energy" ? "能源" : "碳排"}结构占比`}>
    {ranked.map((row, index) => {
      const share = total ? row.value / total * 100 : 0;
      return <div className="composition-stage" key={row.name} title={`${row.name}：${fmt(row.value, 0)} ${unit}，占比 ${fmt(share, 1)}%`}>
        <span className="stage-value num">{fmt(share, 1)}%</span>
        <div className="stage-track"><i style={{ height: `${Math.max(8, row.value / max * 100)}%`, ["--stage-index" as string]: index }} /></div>
        <b>{row.name}</b><small>{fmt(row.value, 0)} {unit}</small>
      </div>;
    })}
  </div>;
}
