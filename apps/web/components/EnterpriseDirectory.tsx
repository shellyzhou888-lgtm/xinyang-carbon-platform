"use client";
import Link from "next/link";
import { useState } from "react";
import directory from "@/data/enterprise-directory.json";
import { enterpriseBrands } from "@/lib/enterprise-branding";

export default function EnterpriseDirectory({year}:{year:number}){
  const [query,setQuery]=useState(""),[area,setArea]=useState("全部"),[type,setType]=useState("全部"),[featured,setFeatured]=useState(false);
  const sources=new Map(directory.sources.map(source=>[source.id,source]));
  const rows=directory.items.filter(row=>(area==="全部"||row.area.includes(area))&&(type==="全部"||row.type===type)&&(!featured||row.featured)&&(`${row.name}${row.business}`.includes(query.trim())));
  return <>
    <div className="directory-scope"><strong>公开资料核验条目 {directory.items.length} 条</strong><p>{directory.scope}</p><p>原10家仅为数据库能耗样本；名单按企业、品牌基地、项目和待核条目区分，收录时间不代表2026年实时经营状态。</p></div>
    <div className="directory-filters"><input aria-label="搜索企业名录" placeholder="搜索企业、品牌或产业" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="企业所在片区" value={area} onChange={e=>setArea(e.target.value)}>{["全部","羊山片区","金牛物流片区","科创研发片区"].map(value=><option key={value}>{value}</option>)}</select>
      <select aria-label="名录条目类型" value={type} onChange={e=>setType(e.target.value)}>{["全部","企业","品牌基地","项目","待核条目"].map(value=><option key={value}>{value}</option>)}</select>
      <label><input type="checkbox" checked={featured} onChange={e=>setFeatured(e.target.checked)}/>仅重点展示企业</label><span>{rows.length} 条</span></div>
    <section className="section"><div className="table-scroll"><table className="enterprise-directory"><thead><tr><th>企业 / 品牌 / 项目</th><th>片区与产业</th><th>条目类型</th><th>核验依据</th><th>地图</th></tr></thead><tbody>{rows.map(row=>{
      const brand=row.mapCode?enterpriseBrands.get(row.mapCode):null;
      return <tr key={row.id}><td><div className="directory-name">{row.featured&&brand?.logo&&<img src={brand.logo} alt={`${row.name}公开品牌标识`}/>}<div><b>{row.name}</b>{row.featured&&<span className="tag">重点展示</span>}<small>{row.note}</small></div></div></td><td>{row.area}<small className="table-subtext">{row.business}</small></td><td>{row.type}</td><td>{row.evidence.map(id=>{const source=sources.get(id);return source?<a className="directory-source" key={id} href={source.url} target="_blank" rel="noreferrer">{source.date} · {source.title} ↗</a>:null;})}</td><td>{row.mapCode?<Link href={`/?year=${year}&enterprise=${row.mapCode}`}>定位 ↗</Link>:<span className="muted">未绑定POI</span>}</td></tr>;
    })}</tbody></table></div>{!rows.length&&<p className="workspace-empty">没有匹配的公开核验条目</p>}</section>
    <p className="section-subtitle">重点展示是平台按公开报道选取的展示范围，不等同于新增官方“龙头企业”认定。完整在营企业名册仍以管委会企业台账为准。</p>
  </>;
}
