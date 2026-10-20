import type pg from "pg";

export interface TemplateField {
  source_field: string;
  target_field: string;
  is_required: boolean;
}

export interface ImportTemplate {
  template_id: number;
  code: string;
  name: string;
  target: string;
  sheet_name: string | null;
  header_row: number;
  fields: TemplateField[];
}

/** Loads the active (latest revision) template and its field mapping from core. */
export async function loadTemplate(client: pg.Client, code: string): Promise<ImportTemplate> {
  const { rows } = await client.query(
    `select t.template_id, t.code, t.name, t.target, t.sheet_name, coalesce(t.header_row, 1) as header_row,
            coalesce(json_agg(json_build_object('source_field', m.source_field, 'target_field', m.target_field,
                                                'is_required', m.is_required) order by m.map_id)
                     filter (where m.map_id is not null), '[]') as fields
       from core.import_template t
       left join core.import_field_map m using (template_id)
      where t.code = $1 and t.is_active
      group by t.template_id
      order by t.revision desc
      limit 1`,
    [code],
  );
  if (rows.length === 0) throw new Error(`导入模板 ${code} 不存在或未启用`);
  return rows[0] as ImportTemplate;
}
