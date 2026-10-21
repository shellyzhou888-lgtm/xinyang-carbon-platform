import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, REPO_ROOT } from "./db.js";
import { governAfterLoad } from "./governance-hook.js";

/**
 * npm run sync:directory [-- --dry-run]
 * Upserts the website enterprise directory (apps/web/data/enterprise-directory.json) into core.enterprise_directory
 * and core.enterprise_directory_source, linking entries to accounting nodes by map_code. Nothing is deleted:
 * entries that disappeared from the file are listed so a person can decide what to do with them.
 */
type Source = { id: string; title: string; url?: string | null; date?: string | null };
type Item = { id: string; name: string; type: string; area?: string; business?: string; mapCode?: string | null; featured?: boolean; evidence?: string[]; note?: string };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const file = JSON.parse(readFileSync(resolve(REPO_ROOT, "apps/web/data/enterprise-directory.json"), "utf8")) as { reviewedAt: string; sources: Source[]; items: Item[] };
  const client = await connect();
  try {
    await client.query("begin");
    for (const s of file.sources) {
      await client.query(`insert into core.enterprise_directory_source (source_id, title, url, published) values ($1, $2, $3, $4)
        on conflict (source_id) do update set title = excluded.title, url = excluded.url, published = excluded.published`,
        [s.id, s.title, s.url ?? null, s.date ?? null]);
    }
    let changed = 0;
    for (const i of file.items) {
      const r = await client.query(`insert into core.enterprise_directory (entry_id, name, entry_type, area, business, map_code, featured, evidence, note, node_id, reviewed_on)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, (select node_id from core.org_node where code = $6), $10)
        on conflict (entry_id) do update set name = excluded.name, entry_type = excluded.entry_type, area = excluded.area, business = excluded.business,
          map_code = excluded.map_code, featured = excluded.featured, evidence = excluded.evidence, note = excluded.note, node_id = excluded.node_id,
          reviewed_on = excluded.reviewed_on, updated_at = now()
        where (core.enterprise_directory.name, core.enterprise_directory.entry_type, core.enterprise_directory.area, core.enterprise_directory.business,
               core.enterprise_directory.map_code, core.enterprise_directory.featured, core.enterprise_directory.evidence, core.enterprise_directory.note)
          is distinct from (excluded.name, excluded.entry_type, excluded.area, excluded.business, excluded.map_code, excluded.featured, excluded.evidence, excluded.note)`,
        [i.id, i.name, i.type, i.area ?? null, i.business ?? null, i.mapCode ?? null, Boolean(i.featured), i.evidence ?? [], i.note ?? null, file.reviewedAt]);
      changed += r.rowCount ?? 0;
    }
    const gone = (await client.query(`select entry_id, name from core.enterprise_directory where not (entry_id = any($1::text[]))`, [file.items.map((i) => i.id)])).rows;
    await client.query(dryRun ? "rollback" : "commit");
    console.log(JSON.stringify({ dryRun, reviewedAt: file.reviewedAt, entries: file.items.length, sources: file.sources.length, changedEntries: changed, notInFile: gone }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
  if (!dryRun) governAfterLoad("import");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
