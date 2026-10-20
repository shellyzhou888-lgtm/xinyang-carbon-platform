import { selectedYear } from "@/lib/workspace";
import { PageHeading } from "@/components/WorkspaceParts";
import EnterpriseDirectory from "@/components/EnterpriseDirectory";
export const dynamic="force-dynamic";
export default async function Enterprises({searchParams}:{searchParams:Promise<{year?:string}>}){
  const year=selectedYear((await searchParams).year);
  return <><PageHeading eyebrow="ENTERPRISE DIRECTORY" title="企业与项目名录" description="按公开来源逐条核对，区分法人企业、品牌基地与建设项目。"/><EnterpriseDirectory year={year}/></>;
}
