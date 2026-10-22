import { charts, management, overview, carbonManagement, enterpriseMonthly, diagnosisLoop } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { DataError, Empty, PageHeading, Panel } from "@/components/WorkspaceParts";
import SpatialDiagnosis from "@/components/SpatialDiagnosis";
import { TrendChart } from "@/components/EnergyCharts";
import StrategyReportButton from "@/components/StrategyReportButton";
import { Roadmap } from "@/components/CarbonDataSections";
import { cleanSource } from "@/lib/source-text";
import SectionPager from "@/components/SectionPager";
import { IndicatorScales } from "@/components/IndicatorScales";
import { CheckMatrix, EffectView, FindingList, LoopBar, LoopLogic, StrategyChain } from "@/components/DiagnosisLoop";
import { LOOP_STEPS, type LoopStep } from "@/lib/diagnosis-loop";
import type { DiagnosisLoop, ManagementData } from "@xinyang/db-agent";

export const dynamic = "force-dynamic";
const CATEGORIES: Record<string, string> = { clean_energy: "清洁能源", green_power: "绿电交易", efficiency: "能效提升", waste_heat: "余热回收", electrification: "电气化", process: "工艺优化", management: "运行管理", offset: "抵消" };
/** Old links keep working: spatial/alerts/causes → locate, evaluation → evaluate, strategies → strategy, forecast → effect. */
const ALIASES: Record<string, LoopStep> = { spatial: "locate", alerts: "locate", causes: "locate", evaluation: "evaluate", strategies: "strategy", forecast: "effect" };

/** Findings in the alert shape the map uses (one per finding, all open, rule code = check code). */
function findingsAsAlerts(loop: DiagnosisLoop | null, year: number): ManagementData["alerts"] {
  return (loop?.findings ?? []).map((f, i) => ({
    id: i + 1, rule_code: f.check, rule_name: f.title, node: f.objectName, node_code: f.object, node_type: f.objectType, period: `${year} 年`,
    message: f.evidence, severity: f.severity, status: "open", observed: f.value, baseline: f.reference, root_cause: null,
  }));
}

export default async function Diagnosis({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year);
  const tab: LoopStep = LOOP_STEPS.some((s) => s.key === sp.tab) ? sp.tab as LoopStep : ALIASES[sp.tab ?? ""] ?? "diagnose";
  let data: Awaited<ReturnType<typeof overview>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, chart: Awaited<ReturnType<typeof charts>> | null = null, error = "";
  let extended: Awaited<ReturnType<typeof carbonManagement>> | null = null, loop: DiagnosisLoop | null = null;
  let entNow: Awaited<ReturnType<typeof enterpriseMonthly>> = [], entPrev: Awaited<ReturnType<typeof enterpriseMonthly>> = [];
  try {
    [data, detail, chart, extended, loop, entNow, entPrev] = await Promise.all([overview(year), management(year), charts(year), carbonManagement(year), diagnosisLoop(year),
      tab === "locate" ? enterpriseMonthly(year) : Promise.resolve([]), tab === "locate" && year > 2021 ? enterpriseMonthly(year - 1) : Promise.resolve([])]);
  } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }

  const findings = loop?.findings ?? [];
  const entFindings = findings.filter((f) => f.objectType === "enterprise");
  const ents = new Set(entFindings.map((f) => f.object)).size;
  const met = loop?.indicators.filter((r) => r.achieved).length ?? 0;
  const reduction = loop?.effect.reductionCo2 ?? 0;
  const outputs: Record<LoopStep, string> = {
    diagnose: `${loop?.checks.length ?? 0} 类规则 · 发现 ${findings.length} 项问题`,
    locate: `${ents} 家企业 + 园区整体`,
    evaluate: `${loop?.indicators.length ?? 19} 项指标 · ${met} 项达到引领值`,
    strategy: `${loop?.strategies.length ?? 0} 条策略 · 减碳 ${fmt(reduction, 0)} t/年`,
    effect: loop?.effect.withStrategiesCo2 != null ? `${loop.effect.nextYear} 年 ${fmt(loop.effect.baselineCo2, 0)} → ${fmt(loop.effect.withStrategiesCo2, 0)} t` : "—",
  };
  const plans = (loop?.strategies ?? []).map((s) => ({ alert: s.findings.join("；"), severity: "warning", node: s.enterpriseName, strategy: s.name, category: s.category,
    tce_saving: s.tceSaving, co2_reduction_t: s.co2Reduction, simulated: true }));
  const history = (detail?.annual ?? []).map((r) => ({ year: r.year, co2: r.co2_t }));

  return <div className="fit-screen">
    <PageHeading eyebrow={`ENERGY & CARBON DIAGNOSIS · ${year} 年度`} title="能碳综合诊断" description="按“诊断问题 → 定位对象 → 对标评价 → 生成策略 → 预测效果”闭环推进，每一步的结果作为下一步的输入。" />
    <DataError error={error} />
    <LoopBar year={year} active={tab} outputs={outputs} />

    {tab === "diagnose" && loop && <SectionPager labels={["检查矩阵", "问题清单"]}>
      <Panel className="view-fill" title={`01 问题诊断 · ${year} 年`} subtitle="每家企业和园区整体按同一组规则逐项检查：符合、发现问题或缺少数据">
        <LoopLogic input={`${year} 年企业能耗、排放、产值与能源结构，园区预算与评价指标`} method={`${loop.checks.length} 类规则覆盖总量、强度、结构、指标与数据四个维度`} output={`${findings.length} 项问题，交给 02 定位、04 生成策略`} />
        <CheckMatrix loop={loop} />
      </Panel>
      <Panel className="view-fill" title="诊断出的问题" subtitle="按维度分组，列出证据与触发规则">
        <LoopLogic input="检查矩阵中标记“!”的项" method="记录对象、证据数值与对照基准" output="问题清单（每项问题对应可匹配的策略类别）" />
        <FindingList findings={findings} checks={loop.checks} />
      </Panel>
    </SectionPager>}

    {tab === "locate" && <div className="fit-body">
      <LoopLogic input="01 诊断出的企业级与园区级问题" method="按企业真实位置落点，锥形大小表示排放、颜色表示问题等级" output="明确问题所在的企业和片区，及该企业的排放、同比与逐月证据" />
      <SpatialDiagnosis year={year} alerts={findingsAsAlerts(loop, year)} ranking={detail?.carbonRanking ?? []} monthly={entNow} previous={entPrev} plans={plans} parkCo2={data?.co2_t} />
    </div>}

    {tab === "evaluate" && loop && <SectionPager labels={["评价指标"]}>
      <Panel className="view-fill" title={`03 对标评价 · 《绿色工业园区评价要求》${loop.indicators.length} 项指标`} subtitle="当前值、引领值与 2021 年以来的变化；有提升空间与缺少数据的指标已进入 01 问题清单">
        <LoopLogic input={`${year} 年园区指标计算结果`} method="与 GIP_2026 引领值逐项对照，并看近年走势" output={`${met} 项达到引领值，其余作为提升方向交给 04 生成策略`} />
        <IndicatorScales rows={loop.indicators} year={year} columns={3} grouped />
      </Panel>
    </SectionPager>}

    {tab === "strategy" && loop && <SectionPager labels={["策略生成", "策略库"]}>
      <Panel className="view-fill" title="04 策略生成" subtitle="每条策略都可追溯到它针对的问题；测算参数为策略库中的行业常见值，需按企业节能诊断核实" action={<StrategyReportButton year={year} />}>
        <LoopLogic input="01 问题清单（问题类型 → 策略类别）" method="在策略库中按企业所属产业匹配，用节能率 × 能耗或减碳率 × 排放测算，单企业合计不超过其排放 35%" output={`${loop.strategies.length} 条策略、年减碳 ${fmt(reduction, 0)} t，交给 05 预测效果`} />
        <StrategyChain loop={loop} />
      </Panel>
      <Panel className="view-fill" title="减碳策略库" subtitle={`${detail?.strategies.length ?? 0} 项可选策略，标注适用产业与测算参数来源`}>
        <div className="strategy-grid">{detail?.strategies.map((row) => <article className="strategy-item" key={row.code}><span className="strategy-category">{CATEGORIES[row.category] || row.category}</span><h3>{row.name}</h3><p>{row.description || "按企业工况和适用条件进一步核查。"}</p>{cleanSource(row.reference) && <small>{cleanSource(row.reference)}</small>}</article>)}</div>
      </Panel>
    </SectionPager>}

    {tab === "effect" && loop && <SectionPager labels={["策略效果", "月度预测", "减碳路线"]}>
      <Panel className="view-fill" title={`05 效果预测 · ${loop.effect.nextYear} 年`} subtitle="基准预测减去本次策略减碳量，得到实施后的排放与碳强度；与预算和两种情景路线对照">
        <LoopLogic input={`Chronos-2 对 ${loop.effect.nextYear} 年的基准预测 + 04 策略减碳量`} method="基准 − 策略减碳；碳强度按增加值同比增速外推" output="实施后排放与碳强度；下一年度实际数据导入后回到 01 复核" />
        <EffectView loop={loop} history={history} />
      </Panel>
      <Panel className="view-fill" title="月度能耗与碳排放预测" subtitle="最新成功批次；虚线为中位预测，阴影为 10%—90% 区间">
        {chart?.forecast.length ? <><TrendChart data={chart} /><div className="meta-row">{chart.forecast.map((row) => <span key={row.target}><b>{row.target === "energy_tce" ? "能耗" : "碳排放"}</b>{row.model || "基准模型"} · 批次 {row.run_id} · {row.points[0]?.month}—{row.points.at(-1)?.month}</span>)}</div></>
          : <Empty title="暂无已发布的预测批次" />}
      </Panel>
      <Roadmap data={extended} />
    </SectionPager>}
  </div>;
}
