import { sql, type SQL } from "drizzle-orm";
import { WORK_MODE_ALIASES, WORK_MODES, type WorkMode } from "../../contexts/matching/index.ts";
import { job, jobPage } from "./schema.ts";

function declaredMode(value: SQL): SQL<WorkMode | null> {
  const normalized = sql`lower(trim(replace(${value}, 'Í', 'í')))`;
  return sql`case ${sql.join(WORK_MODES.map((mode) => sql`
    when ${normalized} in (${sql.join(WORK_MODE_ALIASES[mode].map((alias) => sql`${alias}`), sql`, `)}) then ${mode}
  `), sql` `)} end`;
}

// Keep filtering in SQL, before LIMIT/OFFSET, and share it with counts/facets.
// A false remote flag can mean hybrid as well as onsite; alone it is unknown.
export function workModeSql(): SQL<WorkMode | null> {
  const location = sql`' ' || lower(replace(coalesce(${job.locationRaw}, ''), 'Í', 'í')) || ' '`;
  const locationMode = sql`case ${sql.join(
    (["hybrid", "onsite", "remote"] as const).map((mode) => sql`
      when ${sql.join(WORK_MODE_ALIASES[mode].map((alias) =>
        sql`${location} glob ${`*[^a-zÀ-ÿ]${alias}[^a-zÀ-ÿ]*`}`), sql` or `)} then ${mode}
    `), sql` `)} end`;
  return sql`coalesce(
    ${declaredMode(sql`json_extract(${job.raw}, '$.workplaceType')`)},
    ${declaredMode(sql`json_extract(${job.raw}, '$.fields.workplace')`)},
    ${locationMode},
    case when ${job.remote} = 1 then 'remote' end,
    ${declaredMode(sql`json_extract(${jobPage.extracted}, '$.fields.workplace')`)}
  )`;
}
