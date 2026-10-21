"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { ChartData } from "@xinyang/db-agent";
const EnterpriseEnergy3D=dynamic(()=>import("./EnterpriseEnergy3D"),{ssr:false,loading:()=> <div className="empty">正在载入3D视图…</div>});
export default function Energy3DPanel({year,ranking}:{year:number;ranking:ChartData["ranking"]}){
  const [selected,setSelected]=useState("");
  return <><EnterpriseEnergy3D year={year} ranking={ranking} selected={selected} onSelect={setSelected}/>{selected&&<p className="panel-note">已选择：{ranking.find(row=>row.code===selected)?.name}</p>}</>;
}
