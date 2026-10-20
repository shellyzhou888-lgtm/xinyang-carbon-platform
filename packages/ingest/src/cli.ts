import { readFileSync } from "node:fs";
import { connect } from "./db.js";
import { ingestFile, runCalc } from "./ingest.js";

const USAGE = `用法：
  npm run ingest -- <文件.xlsx> --template <模板编码> [--dry-run] [--calc 标准:节点:年份] [--preview]
  npm run calc   -- --version <标准> --node <节点编码> --year <年份> [--preview] [--dry-run]

模板编码：ENT_MONTHLY_ENERGY、ENT_ANNUAL_ECONOMIC、ENT_ANNUAL_PRODUCTION
--dry-run  在事务中执行后回滚，不保存文件、不落库
--calc     导入后执行折标、碳核算与指标计算，例如 GIP_2026:XYEDZ:2023
--preview  指标计算允许使用未批准的草稿公式，结果只显示、不写入
--estimated "方法说明"   作为估值（模拟/补全）数据导入；数据来源列留空的行记为 estimated
--inputs <假设文件.json>  估值所依据的假设，存入批次 estimation_inputs
--note "说明"            批次备注`;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const client = await connect();
  try {
    if (command === "ingest") {
      const file = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      const templateCode = option(args, "--template");
      if (!file || !templateCode) throw new Error(USAGE);
      const method = option(args, "--estimated");
      const inputsFile = option(args, "--inputs");
      const result = await ingestFile(client, {
        filePath: file, templateCode, dryRun: args.includes("--dry-run"),
        calc: option(args, "--calc"), preview: args.includes("--preview"), note: option(args, "--note"),
        estimated: method ? { method, inputs: inputsFile ? JSON.parse(readFileSync(inputsFile, "utf8")) : undefined,
                              model: "scripts/simulate (rule-based placeholder)" } : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "calc") {
      const version = option(args, "--version");
      const node = option(args, "--node");
      const year = Number(option(args, "--year"));
      if (!version || !node || !year) throw new Error(USAGE);
      const result = await runCalc(client, version, node, year, args.includes("--preview"), args.includes("--dry-run"));
      console.log(JSON.stringify(result, null, 2));
    } else {
      throw new Error(USAGE);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
