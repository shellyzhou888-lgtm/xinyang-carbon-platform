import { formatNumber as fmt } from "@/lib/workspace";
type Evidence = {months?:{month?:string;deviation_pct?:number;observed?:number;baseline?:number}[];top_contributors?:{name?:string;delta?:number;share_pct?:number}[];annual_change_pct?:number;basis?:string;budget_annual?:number;strategy_categories?:string[]};
export default function AlertEvidence({value}:{value:unknown}){
  if(!value||typeof value!=="object")return <p className="hint">暂无结构化溯源证据</p>;
  const evidence=value as Evidence;
  return <details><summary>展开溯源证据</summary>{evidence.basis&&<p className="hint">计算依据：{evidence.basis} · 年度预算 {fmt(evidence.budget_annual)}</p>}{evidence.annual_change_pct!=null&&<p>全年变化 {fmt(evidence.annual_change_pct,2)}%</p>}
    {evidence.months?.length? <div className="table-scroll"><table><thead><tr><th>月份</th><th>观测值</th><th>基线</th><th>偏离</th></tr></thead><tbody>{evidence.months.map((row,index)=><tr key={index}><td>{row.month}</td><td>{fmt(row.observed,4)}</td><td>{fmt(row.baseline,4)}</td><td>{fmt(row.deviation_pct,2)}%</td></tr>)}</tbody></table></div>:null}
    {evidence.top_contributors?.map((row,index)=><div className="contribution-row" key={index}><b>{row.name}</b><strong>{fmt(row.delta,4)} <small>贡献占比 {fmt(row.share_pct,2)}%</small></strong></div>)}
    {evidence.strategy_categories?.length?<p className="hint">建议策略类别：{evidence.strategy_categories.join("、")}</p>:null}
    {!evidence.months?.length&&!evidence.top_contributors?.length&&!evidence.basis&&!evidence.strategy_categories?.length&&<p className="hint">该规则暂无月份或企业贡献明细。</p>}
  </details>;
}
