import type { ProductChain } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { Panel } from "./WorkspaceParts";

/** Compare each chain with itself: the two functional units are deliberately never ranked against each other. */
export default function ProductHotspots({ chains }: { chains: ProductChain[] }) {
  return <Panel className="screen-hotspots" title="两条产业链排放热点" subtitle="各链分别按环节排放量排序，占比以本链碳足迹为分母">
    <div className="chain-hotspots">{chains.map(chain => {
      const top = [...chain.stages].sort((a, b) => b.kgco2e - a.kgco2e).slice(0, 3);
      return <section key={chain.code} aria-label={`${chain.name}排放热点`}>
        <h3>{chain.name}<small>{chain.functional_unit}</small></h3>
        <ol>{top.map((stage, i) => <li key={stage.code}>
          <span className="num hotspot-rank">0{i + 1}</span><div><b>{stage.name}</b><small>{stage.phase}</small></div>
          <strong className="num">{fmt(chain.total ? stage.kgco2e / chain.total * 100 : null, 1)}%<small>{fmt(stage.kgco2e, 3)} kgCO₂e</small></strong>
        </li>)}</ol>
      </section>;
    })}</div>
  </Panel>;
}
