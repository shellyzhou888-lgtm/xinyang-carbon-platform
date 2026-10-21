import type { CarbonManagementData } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { C } from "@/lib/chart-theme";
import ComparisonChart from "./ComparisonChart";
import { cleanSource } from "@/lib/source-text";
import { Empty, Panel } from "./WorkspaceParts";

export function BudgetComparison({ data, kind }: { data: CarbonManagementData | null; kind: "energy" | "carbon" }) {
  const budget = data?.budget.find((row) => row.kind === kind), unit = kind === "energy" ? "tce" : "tCO₂";
  const color = kind === "energy" ? C.energy : C.carbon;
  const over = budget?.months.filter((row) => row.cumulative != null && row.budget_cumulative != null && row.cumulative > row.budget_cumulative).length ?? 0;
  return <Panel title={`累计${kind === "energy" ? "能耗" : "排放"}与预算`} subtitle="年度预算按月等额分配，与累计实际对比。"
    action={budget?.annual_budget != null ? <span className="panel-figure">年度预算 <b>{fmt(budget.annual_budget)}</b> {unit}</span> : undefined}>
    {budget?.annual_budget != null ? <>
      <ComparisonChart labels={budget.months.map((row) => `${Number(row.month.slice(5))}月`)} unit={unit} label="累计实际与预算比较"
        series={[{ name: "累计实际", values: budget.months.map((row) => row.cumulative), color }, { name: "累计预算", values: budget.months.map((row) => row.budget_cumulative), color: "var(--text-3)", dashed: true }]} />
      <div className="month-strip">{budget.months.map((row) => {
        const isOver = row.cumulative != null && row.budget_cumulative != null && row.cumulative > row.budget_cumulative;
        return <span key={row.month} className={isOver ? "over" : ""}><small>{Number(row.month.slice(5))}月</small><b>{fmt(row.cumulative, 0)}</b></span>;
      })}</div>
      <p className="panel-note">{over ? `${over} 个月累计实际高于预算进度（标为橙色）。` : "全年累计实际均未超出预算进度。"}</p>
    </> : <Empty title="本年度未录入预算" />}
  </Panel>;
}

export function Roadmap({ data }: { data: CarbonManagementData | null }) {
  const roadmap = data?.roadmap, years = [...new Set([...(roadmap?.actual.map((row) => row.year) || []), ...(roadmap?.scenarios.flatMap((row) => row.points.map((point) => point.year)) || [])])].sort();
  return <Panel title="碳达峰情景路线图" subtitle="历史实际与基准、低碳两种情景">
    {roadmap?.scenarios.length ? <>
      <ComparisonChart labels={years.map(String)} unit="tCO₂" label="历史排放与基准、低碳情景路线图" series={[
        { name: "历史排放", values: years.map((year) => roadmap.actual.find((row) => row.year === year)?.co2_t ?? null), color: "var(--text-2)" },
        ...roadmap.scenarios.map((scenario, index) => ({ name: scenario.label || scenario.code, values: years.map((year) => scenario.points.find((row) => row.year === year)?.co2_t ?? null), color: index ? C.energy : C.carbon, dashed: true })),
        { name: "达峰上限", values: years.map((year) => data?.targets.find((row) => row.kind === "carbon_peak_t" && row.year === year)?.value ?? null), color: C.danger, dashed: true },
      ]} />
      <div className="meta-row">{roadmap.scenarios.map((row) => <span key={row.code}><b>{row.label || row.code}</b>{row.peak_year ? `${row.peak_year} 年峰值 ${fmt(row.peak_co2_t)} tCO₂` : "预测期内未达峰"}</span>)}</div>
    </> : <Empty title="暂无已发布的情景路线图" />}
  </Panel>;
}

export function CarbonReferences({ data }: { data: CarbonManagementData | null }) {
  const markets = data?.carbon_price.filter((row) => row.latest) || [];
  const series = markets.map((row, index) => ({ name: row.name, values: row.monthly.slice(-24).map((m) => m.avg_price), color: index ? C.info : C.accent }));
  const labels = markets[0]?.monthly.slice(-24).map((m) => m.month.slice(2)) || [];
  return <div className="grid-2">
    <Panel title="碳市场行情" subtitle="上海环境能源交易所公开日行情，按月均价汇总">
      {markets.length ? <>
        <div className="quote-row">{markets.map((row) => <div key={row.market} className="quote"><span>{row.name}</span><strong className="num">{fmt(row.latest?.price, 2)}<small>元/t</small></strong><small>{row.latest?.date}</small></div>)}</div>
        <ComparisonChart labels={labels} unit="元/t" label="碳市场月均成交价" series={series} />
      </> : <Empty title="暂无行情数据">待接入官方交易记录</Empty>}
    </Panel>
    <Panel title="产品碳足迹参考" subtitle="公开数据库与文献参考值，核对后在后台批准">
      {data?.footprint_refs.length ? <div className="list scroll-list">{data.footprint_refs.map((row, index) => <div className="list-row" key={index}>
        <div><b>{row.product}</b><small>{row.boundary || "边界未标注"} · {cleanSource(row.source)}</small></div>
        <div className="list-figure"><span className="num">{fmt(row.value, 3)}</span><small>{row.unit} / {row.functional_unit}</small></div>
      </div>)}</div> : <Empty title="暂无参考数据">待补充产品功能单位、边界与来源</Empty>}
    </Panel>
  </div>;
}
