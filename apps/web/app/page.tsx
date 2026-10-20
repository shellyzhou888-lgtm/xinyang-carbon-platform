import { charts, overview } from "@/lib/server";
import EnergyCharts from "@/components/EnergyCharts";
import ChatPanel from "@/components/ChatPanel";
import VoiceAssistant from "@/components/VoiceAssistant";

export const dynamic = "force-dynamic";

const YEARS = [2023, 2024, 2025];
const fmt = (v: number | null, digits = 1) => (v == null ? "—" : v.toLocaleString("zh-CN", { maximumFractionDigits: digits }));

export default async function Home({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: y } = await searchParams;
  const year = YEARS.includes(Number(y)) ? Number(y) : 2025;

  let data: Awaited<ReturnType<typeof overview>> | null = null;
  let chartData: Awaited<ReturnType<typeof charts>> | null = null;
  let error = "";
  try {
    [data, chartData] = await Promise.all([overview(year), charts(year)]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const estimated = (data?.energy_estimated_share ?? 0) > 0;

  return (
    <div className="shell">
      <main className="main">
        <div className="header">
          <div>
            <h1>信阳经济技术开发区 · 绿色园区能碳管理平台</h1>
            <div className="sub">2026 年度国家级绿色工业园区申报 · 评价口径 GIP_2026 <a className="admin-link" href="/admin">数据治理 →</a></div>
          </div>
          <nav className="years">
            {YEARS.map((v) => (
              <a key={v} href={`/?year=${v}`} className={v === year ? "on" : ""}>{v} 年</a>
            ))}
          </nav>
        </div>

        {error && <div className="section error">数据库暂不可用：{error}（请确认 SSH 隧道 localhost:15432 已打开）</div>}

        {data && (
          <>
            {estimated && (
              <div className="banner">
                当前 {year} 年能耗数据中约 {Math.round((data.energy_estimated_share ?? 0) * 100)}% 为模拟估算值（尚未取得企业实测数据），以下数字仅用于演示，不能作为申报依据。
              </div>
            )}
            <div className="kpis">
              <div className="kpi"><div className="label">综合能耗</div><div className="value">{fmt(data.tce, 0)}<span className="unit">tce</span></div></div>
              <div className="kpi"><div className="label">二氧化碳排放</div><div className="value">{fmt(data.co2_t, 0)}<span className="unit">tCO₂</span></div></div>
              <div className="kpi"><div className="label">工业增加值（可比价）</div><div className="value">{fmt(data.value_added_wan, 0)}<span className="unit">万元</span></div></div>
              <div className="kpi"><div className="label">已达标指标</div><div className="value">{data.indicators.achieved}<span className="unit">/ {data.indicators.total} 项</span></div></div>
            </div>

            {chartData && <EnergyCharts data={chartData} />}

            <section className="section">
              <h2>已达标指标</h2>
              {data.achieved.length === 0 ? (
                <div className="hint">该年度暂无已达标指标，可在右侧让 Agent 运行计算。</div>
              ) : (
                <table>
                  <thead><tr><th>编号</th><th>指标</th><th>园区数值</th><th>基准</th><th>数据</th></tr></thead>
                  <tbody>
                    {data.achieved.map((r) => (
                      <tr key={r.code}>
                        <td>{r.code}</td>
                        <td>{r.name}</td>
                        <td>{fmt(r.value, 4)} {r.unit ?? ""}</td>
                        <td>{r.benchmark == null ? "—" : `${r.comparator ?? ""} ${fmt(r.benchmark, 4)}`}</td>
                        <td>{r.estimated_share > 0 ? <span className="tag est">含模拟 {Math.round(r.estimated_share * 100)}%</span> : <span className="tag">实测</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {data.honors.length > 0 && (
              <section className="section">
                <h2>园区与企业荣誉</h2>
                <div className="honors">
                  {data.honors.map((h, i) => (
                    <div className="honor" key={i}><b>{h.node}</b>{h.title}</div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <aside className="side">
        <ChatPanel />
      </aside>
      <VoiceAssistant year={year} overview={data ? { tce: data.tce, co2_t: data.co2_t, achieved: data.indicators.achieved, total: data.indicators.total } : null} />
    </div>
  );
}
