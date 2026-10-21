"use client";
import Link from "next/link";
import { useState } from "react";
import directory from "@/data/enterprise-directory.json";
import { enterpriseBrands } from "@/lib/enterprise-branding";
import { IconSearch } from "./icons";
import { cleanSource } from "@/lib/source-text";

/** Internal verification notes (open questions, exclusions) stay in the data file and are not shown on the page. */
const INTERNAL_NOTE = /待核|未核|未取得|未消除|不计入|存疑|不直接|待确认|矛盾|不能推断|未证实/;
const publicNote = (note?: string | null) => { const text = cleanSource(note); return text && !INTERNAL_NOTE.test(text) ? text : ""; };
const typeLabel = (type: string) => type === "待核条目" ? "其他条目" : type;
import { Stat } from "./MotionParts";

export default function EnterpriseDirectory({ year }: { year: number }) {
  const [query, setQuery] = useState(""), [area, setArea] = useState("全部"), [type, setType] = useState("全部"), [featured, setFeatured] = useState(false);
  const sources = new Map(directory.sources.map((source) => [source.id, source]));
  const rows = directory.items.filter((row) => (area === "全部" || row.area.includes(area)) && (type === "全部" || row.type === type) && (!featured || row.featured) && (`${row.name}${row.business}`.includes(query.trim())));
  const count = (kind: string) => directory.items.filter((row) => row.type === kind).length;
  return <>
    <div className="stats-row">
      <Stat label="公开核验条目" value={directory.items.length} unit="条" digits={0} tone="accent" />
      <Stat label="企业" value={count("企业")} unit="家" digits={0} tone="energy" delay={0.05} />
      <Stat label="品牌基地" value={count("品牌基地")} unit="个" digits={0} tone="info" delay={0.1} />
      <Stat label="建设项目" value={count("项目")} unit="个" digits={0} tone="carbon" delay={0.15} />
    </div>
    <div className="directory-toolbar">
      <label className="search"><IconSearch /><input aria-label="搜索企业名录" placeholder="搜索企业、品牌或产业" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <select aria-label="企业所在片区" value={area} onChange={(e) => setArea(e.target.value)}>{["全部", "羊山片区", "金牛物流片区", "科创研发片区"].map((value) => <option key={value} value={value}>{value === "全部" ? "全部片区" : value}</option>)}</select>
      <select aria-label="名录条目类型" value={type} onChange={(e) => setType(e.target.value)}>{["全部", "企业", "品牌基地", "历史企业", "项目", "待核条目"].map((value) => <option key={value} value={value}>{value === "全部" ? "全部类型" : typeLabel(value)}</option>)}</select>
      <label className="check"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />仅重点展示</label>
      <span className="count">{rows.length} 条</span>
    </div>
    <section className="panel">
      <div className="table-scroll"><table className="enterprise-directory"><thead><tr><th>企业 / 品牌 / 项目</th><th>片区与产业</th><th>条目类型</th><th>核验依据</th><th>地图</th></tr></thead><tbody>{rows.map((row) => {
        const brandCode = "brandCode" in row ? row.brandCode : row.mapCode;
        const brand = brandCode ? enterpriseBrands.get(brandCode) : null;
        return <tr key={row.id}>
          <td><div className="directory-name">{brand?.logo && <img src={brand.logo} alt={`${row.name}公开品牌标识`} style={{ background: brand.code === "B_KAIYUAN" ? "#093c62" : "#fff" }} />}<div><b>{row.name}</b>{row.featured && <span className="tag">重点展示</span>}{publicNote(row.note) && <small>{publicNote(row.note)}</small>}</div></div></td>
          <td>{row.area}<small className="table-subtext">{row.business}</small></td>
          <td><span className="chip">{typeLabel(row.type)}</span></td>
          <td>{row.evidence.map((id) => { const source = sources.get(id); return source ? <a className="directory-source" key={id} href={source.url} target="_blank" rel="noreferrer">{source.date} · {cleanSource(source.title)}</a> : null; })}</td>
          <td>{row.mapCode ? <Link className="more-link" href={`/?year=${year}&enterprise=${row.mapCode}`}>定位</Link> : <span className="muted">—</span>}</td>
        </tr>;
      })}</tbody></table></div>
      {!rows.length && <div className="empty"><b>没有匹配的公开核验条目</b></div>}
    </section>
    <p className="panel-note"><a href={sources.get(directory.reportedScale.sourceId)?.url} target="_blank" rel="noreferrer">2025 年 3 月公开报道：辖区 {directory.reportedScale.value} {directory.reportedScale.unit}</a>。</p>
  </>;
}
