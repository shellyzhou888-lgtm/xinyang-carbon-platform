"use server";

import { revalidatePath } from "next/cache";
import { adminApi } from "@/lib/server";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

export async function decideIssue(f: FormData) {
  const a = adminApi();
  await a.decideIssue(Number(f.get("issue_id")), f.get("decision") as "approve" | "reject" | "reopen" | "improve", s(f, "note") ?? "", a.reviewer);
  // An executed action (comment write-back, recalculation) changes what the rules see: check again in the background.
  if (f.get("decision") === "approve") a.runGovernance();
  revalidatePath("/admin");
}

export async function reviewTable(f: FormData) {
  const a = adminApi();
  await a.reviewTableDoc(String(f.get("object")), {
    business_name: s(f, "business_name"), description: s(f, "description"), grain: s(f, "grain"), usage_notes: s(f, "usage_notes"),
  }, f.get("decision") as "approve" | "reject" | "save", a.reviewer);
  revalidatePath("/admin");
}

export async function reviewColumn(f: FormData) {
  const a = adminApi();
  await a.reviewColumnDoc(String(f.get("object")), String(f.get("column")), {
    business_name: s(f, "business_name"), description: s(f, "description"), unit: s(f, "unit"),
  }, f.get("decision") as "approve" | "reject" | "save", a.reviewer);
  revalidatePath("/admin");
}

export async function approveAllColumns(f: FormData) {
  const a = adminApi();
  await a.approveAllColumns(String(f.get("object")), a.reviewer);
  revalidatePath("/admin");
}

export async function reviewQa(f: FormData) {
  const a = adminApi();
  await a.reviewQa(Number(f.get("qa_id")), f.get("decision") as "approve" | "reject", s(f, "note") ?? "", a.reviewer, s(f, "question"));
  revalidatePath("/admin");
}

export async function reviewEdge(f: FormData) {
  const a = adminApi();
  await a.reviewEdge(Number(f.get("edge_id")), f.get("decision") as "approve" | "reject", a.reviewer);
  revalidatePath("/admin");
}

export async function runGovernanceNow() {
  adminApi().runGovernance();
  revalidatePath("/admin");
}

export async function reviewFootprint(f: FormData) {
  const a = adminApi();
  await a.reviewFootprint(Number(f.get("ref_id")), f.get("decision") as "approve" | "reject" | "save",
                          { boundary: s(f, "boundary"), note: s(f, "note") }, a.reviewer);
  revalidatePath("/admin");
}
