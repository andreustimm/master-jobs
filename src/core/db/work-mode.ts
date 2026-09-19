import { sql, type SQL } from "drizzle-orm";
import { WORK_MODE_ALIASES, WORK_MODES, type WorkMode } from "../../contexts/matching/index.ts";
import { job, source } from "./schema.ts";

function declaredMode(value: SQL): SQL<WorkMode | null> {
  const normalized = sql`lower(trim(replace(${value}, 'Í', 'í')))`;
  return sql`case ${sql.join(WORK_MODES.map((mode) => sql`
    when ${normalized} in (${sql.join(WORK_MODE_ALIASES[mode].map((alias) => sql`${alias}`), sql`, `)}) then ${mode}
  `), sql` `)} end`;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

// Keep filtering in SQL, before LIMIT/OFFSET, and share it with counts/facets.
// A false remote flag can mean hybrid as well as onsite; alone it is unknown.
// Parser fields and the careers remote flag are guesses from description words.
export function workModeSql(): SQL<WorkMode | null> {
  const location = sql`lower(coalesce(${job.locationRaw}, ''))`;
  const locationMode = sql`case ${sql.join(
    (["hybrid", "onsite", "remote"] as const).map((mode) => {
      const matches = sql.join(
        WORK_MODE_ALIASES[mode].map((alias) =>
          sql`${location} ~* ${`(^|[^[:alnum:]])${escapeRegex(alias)}([^[:alnum:]]|$)`}`),
        sql` or `,
      );
      return sql`when ${matches} then ${mode}`;
    }),
    sql` `,
  )} end`;
  return sql`coalesce(
    ${declaredMode(sql`${job.raw}->>'workplaceType'`)},
    ${locationMode},
    case when ${job.remote} = true and ${source.kind} <> 'careers' then 'remote' end
  )`;
}
