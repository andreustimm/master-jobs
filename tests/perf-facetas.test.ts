/**
 * Facetas, quadro e cockpit sobre um acervo com a FORMA do de produção —
 * `pnpm perf:facetas` (#222).
 *
 * `pnpm perf:jobs` mede 10 mil vagas abertas, um candidato, uma trilha e
 * descrições de 1,3 KB que nunca saem da página da tabela. Produção não é
 * assim: ~6 mil abertas entre ~15 mil (as fechadas nunca são apagadas, regra 3),
 * vários candidatos com várias trilhas pontuadas, descrições longas guardadas
 * fora da linha (TOAST) e capturas em `job_page`. Lá as facetas custaram
 * 3,8 s numa leitura em que o benchmark local dava 24 ms.
 *
 * Tempo local continua sendo piso — os buffers já aquecidos não pagam disco.
 * O número que atravessa a diferença de máquina é o de BLOCOS TOCADOS
 * (`shared hit + read` do `EXPLAIN (ANALYZE, BUFFERS)`): num banco frio e
 * pequeno, cada bloco pode ser uma leitura de disco. Fora do `pnpm check`: sem
 * `JHO_PERF=1` o caso é pulado.
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadCockpit } from "../app/cockpit-data.ts";
import { readFilters, toBoardFilters } from "../app/filter-state.ts";
import { loadJobsView } from "../app/jobs/jobs-data.ts";
import { ensurePrimaryTrack, invalidateBoardFacets } from "../src/contexts/matching/index.ts";
import { candidate } from "../src/core/db/schema.ts";
import { createStageTimer } from "../src/core/observability.ts";
import type { DB } from "../src/core/db/client.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const enabled = process.env.JHO_PERF === "1";
const JOBS = Number(process.env.JHO_PERF_JOBS ?? 15_000);
const CANDIDATES = Number(process.env.JHO_PERF_CANDIDATES ?? 4);
const RUNS = Number(process.env.JHO_PERF_RUNS ?? 5);

let db: DB;
let owner: number;

/**
 * O acervo, determinístico: tudo sai de `x` e de `md5`, nada de `random()`.
 *
 * - 40% abertas (as demais fechadas, como as que a regra 3 guarda);
 * - 13 fontes; a `lever:jobgether` anônima leva 70% das vagas, como em produção;
 * - descrição de 3 a 10 KB: passa do limite do TOAST e mora fora da linha;
 * - `job_page` para um quarto das abertas, com texto de 8 KB;
 * - cada candidato com a principal (nota em TODA vaga, aberta ou fechada) e
 *   duas trilhas aceitas (nota em um terço das vagas);
 * - `reasons` e palavras-chave com o volume das notas reais (~1 KB por linha).
 */
async function seedCorpus() {
  const [row] = await db.insert(candidate).values({ slug: "perf", name: "Perf", isDefault: true }).returning();
  owner = row!.id;
  await ensurePrimaryTrack(owner);
  // Uma instrução por ida: o protocolo estendido não aceita várias numa só.
  const script = `
    insert into production.candidate (slug, name, is_default)
    select 'perf-' || c, 'Perf ' || c, false from generate_series(2, ${CANDIDATES}) c;

    insert into production.target_track (candidate_id, name, name_key, is_primary, status, position, target_json)
    select c.id, 'Principal', 'principal', true, 'active', 0, t.target_json
    from production.candidate c, production.target_track t
    where c.id <> ${owner} and t.candidate_id = ${owner} and t.is_primary;

    insert into production.target_track (candidate_id, name, name_key, is_primary, status, position, target_json)
    select c.id, 'Aceita ' || n, 'aceita ' || n, false, 'active', n, t.target_json
    from production.candidate c, generate_series(1, 2) n, production.target_track t
    where t.candidate_id = ${owner} and t.is_primary;

    insert into production.source (id, kind, handle, label)
    select case when s = 0 then 'lever:jobgether' else (array['greenhouse','ashby','lever','workable','remoteok','himalayas'])[1 + s % 6] || ':board' || s end,
           case when s = 0 then 'lever' else (array['greenhouse','ashby','lever','workable','remoteok','himalayas'])[1 + s % 6] end,
           'board' || s,
           case when s = 0 then 'Jobgether' else 'Board ' || s end
    from generate_series(0, 12) s;

    insert into production.job (source_id, company_name, external_id, title, description_text, description_html,
      location_raw, url, fingerprint, content_hash, raw, comp_min, comp_max, comp_currency, comp_period,
      posted_at, first_seen_at, closed_at)
    select
      case when x % 10 < 7 then 'lever:jobgether'
        else (array['greenhouse','ashby','lever','workable','remoteok','himalayas'])[1 + (1 + x % 12) % 6] || ':board' || (1 + x % 12) end,
      case when x % 10 < 7 then 'Jobgether' else 'Company ' || (x % 700) end,
      'perf-' || x,
      (array['Senior','Staff','Lead','Principal'])[1 + x % 4] || ' ' ||
        (array['Backend Engineer','Software Architect','AI Engineer','Platform Engineer','Data Engineer'])[1 + x % 5] || ' ' || (x % 90),
      case when x % 20 = 0 then 'short'
        else (select string_agg(md5(x::text || '-' || g::text), ' ') from generate_series(1, 90 + (x % 220)) g)
          || case when x % 25 = 3 then ' typescript' else '' end end,
      '<p>' || (select string_agg(md5(g::text || '+' || x::text), ' ') from generate_series(1, 90) g) || '</p>',
      (array['Brazil','United States','Germany','Remote','Bogota, Colombia','Sao Paulo, Brazil','London, United Kingdom',
             'Mexico City, Mexico','Argentina','Portugal','Canada','Spain','France','Poland','India'])[1 + x % 15],
      'https://perf.test/' || x, 'perf-fp-' || x, 'perf-h-' || x,
      json_build_object('id', x, 'payload', md5(x::text) || md5((x + 1)::text)),
      case when x % 4 = 0 then null else 2000 + (x % 50) * 150 end,
      case when x % 4 = 0 then null else 3000 + (x % 50) * 200 end,
      (array['USD','BRL','EUR'])[1 + x % 3],
      (array['month','year','hour'])[1 + x % 3],
      to_char(timestamp '2026-07-25' + (x % 60) * interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
      to_char(timestamp '2026-07-25' + (x % 60) * interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
      case when x % 5 < 3 then '2026-09-01T00:00:00.000Z' end
    from generate_series(1, ${JOBS}) as x;

    insert into production.job_page (job_id, final_url, http_status, text, content_hash, bytes)
    select id, url, 200,
      (select string_agg(md5(id::text || '#' || g::text), ' ') from generate_series(1, 240) g),
      'page-' || id, 8000
    from production.job where closed_at is null and id % 4 = 0;

    insert into production.job_score (candidate_id, track_id, job_id, fit, title_score, keyword_score,
      seniority_score, geo_score, comp_score, freshness_score, benefit_score, penalty, cluster,
      matched_keywords, missing_keywords, detected_benefits, age_days, reasons, blockers, scorer_version)
    select t.candidate_id, t.id, j.id, (j.id * 37 + t.id * 11) % 100,
      1, 1, 1, 1, 1, 1, 1, 0,
      (array['architect','backend','ai-lead','staff','other'])[1 + (j.id + t.id) % 5],
      (select json_agg('keyword-' || g) from generate_series(1, 12) g),
      (select json_agg('missing-' || g) from generate_series(1, 8) g),
      '[]'::json, j.id % 30,
      (select json_agg('Razão ' || g || ': ' || md5(j.id::text || g::text) || md5(g::text)) from generate_series(1, 9) g),
      case when j.id % 10 = 0 then '["requires US work authorization"]'::json else '[]'::json end,
      'perf'
    from production.target_track t
    join production.job j on t.is_primary or j.id % 3 = t.position % 3;

    insert into production.application (candidate_id, job_id, status, applied_at)
    select c.id, j.id,
      (case when j.id % 4 = 0 then 'archived' when j.id % 4 = 1 then 'applied' else 'backlog' end),
      case when j.id % 4 = 1 then '2026-09-10T00:00:00.000Z' end
    from production.candidate c
    join production.job j on j.closed_at is null and j.id % 97 = c.id % 7;
  `;
  for (const statement of script.split(/;\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    await db.execute(sql.raw(statement));
  }
  await db.execute(sql.raw("vacuum analyze"));
  // Depois do `vacuum`, para simular o que ele ainda não viu: com
  // `JHO_PERF_CHURN=1`, um quinto das notas reescrito — a repontuação de
  // hora em hora — com o autovacuum desligado, e o mapa de visibilidade de
  // `job_score` deixa de valer nessas páginas.
  if (process.env.JHO_PERF_CHURN === "1") {
    await db.execute(sql.raw("alter table production.job_score set (autovacuum_enabled = false)"));
    await db.execute(sql.raw("update production.job_score set scored_at = scored_at where (job_id + track_id) % 5 = 0"));
    await db.execute(sql.raw("analyze production.job_score"));
  }
  // Uma instrução avulsa para comparar alternativas no mesmo acervo (criar ou
  // desfazer um índice, por exemplo), sem editar o arquivo.
  if (process.env.JHO_PERF_EXPERIMENT) await db.execute(sql.raw(process.env.JHO_PERF_EXPERIMENT));
}

type Statement = { query: string; values: unknown[] };
type PlanNode = {
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Temp Read Blocks"?: number;
  "Temp Written Blocks"?: number;
};
type Explained = { Plan: PlanNode; "Execution Time": number };

/** Cada consulta que a leitura mandou, na ordem, para reexplicar depois. */
async function capture(work: () => Promise<unknown>): Promise<Statement[]> {
  const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
  const original = client.unsafe.bind(client);
  const statements: Statement[] = [];
  client.unsafe = (...args: unknown[]) => {
    statements.push({ query: String(args[0]), values: Array.isArray(args[1]) ? args[1] : [] });
    return original(...args);
  };
  try {
    await work();
    return statements;
  } finally {
    client.unsafe = original;
  }
}

/** O que a consulta é, por um marcador estável do SQL que o Drizzle monta. */
function label(query: string): string {
  if (query.includes("facet_candidates")) return "facets";
  if (query.includes("board_page")) return "board";
  if (query.includes("vaga_do_grupo")) return "irmãs";
  if (query.includes(") as notas")) return "corpusStats";
  if (query.startsWith("select count(*)")) return "countBoard";
  if (query.includes("\"job_score\".\"cluster\", count(*)")) return "clusterBreakdown";
  return query.replace(/\s+/g, " ").slice(0, 48);
}

async function explain(statement: Statement) {
  const client = db.$client as unknown as { unsafe: (q: string, v: unknown[]) => Promise<Array<{ "QUERY PLAN": Explained[] }>> };
  const [row] = await client.unsafe(`explain (analyze, buffers, format json) ${statement.query}`, statement.values);
  const plan = row!["QUERY PLAN"][0]!;
  const top = plan.Plan;
  return {
    ms: plan["Execution Time"],
    blocks: (top["Shared Hit Blocks"] ?? 0) + (top["Shared Read Blocks"] ?? 0),
    temp: (top["Temp Read Blocks"] ?? 0) + (top["Temp Written Blocks"] ?? 0),
    plan,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

const SCENARIOS: { name: string; params: Record<string, string> }[] = [
  { name: "/jobs padrão", params: {} },
  { name: "/jobs remoto", params: { workMode: "remote" } },
  { name: "/jobs com termo", params: { q: "typescript" } },
  { name: "/jobs sem agrupar", params: { ungrouped: "1" } },
];

async function readJobs(params: Record<string, string>) {
  invalidateBoardFacets();
  const timer = createStageTimer();
  const view = await loadJobsView({
    candidateId: owner, params, page: 1, pageSize: 50, prefetch: false,
    schedule: () => {}, now: new Date("2026-09-20T12:00:00Z"), timer,
  });
  return { view, report: timer.report("/jobs") };
}

async function readCockpit() {
  invalidateBoardFacets();
  const state = readFilters({});
  const started = performance.now();
  const data = await loadCockpit(owner, state, toBoardFilters(state));
  return { data, totalMs: performance.now() - started };
}

describe.runIf(enabled)("facetas com acervo de forma de produção", () => {
  beforeAll(async () => {
    db = await useTestDb();
    await seedCorpus();
  }, 900_000);

  afterAll(async () => {
    await releaseTestDb();
  });

  it(`explica facetas, quadro e cockpit sobre ${JOBS} vagas e ${CANDIDATES} candidatos`, async () => {
    const [volume] = await db.execute<{ open: number; scores: number; pages: number; job_mb: string; score_mb: string }>(sql`
      select (select count(*) from production.job where closed_at is null)::int as open,
             (select count(*) from production.job_score)::int as scores,
             (select count(*) from production.job_page)::int as pages,
             pg_size_pretty(pg_total_relation_size('production.job')) as job_mb,
             pg_size_pretty(pg_total_relation_size('production.job_score')) as score_mb`);
    const lines = [
      "",
      `acervo: ${JOBS} vagas (${volume!.open} abertas), ${volume!.scores} notas, ${volume!.pages} capturas;`
        + ` job ${volume!.job_mb}, job_score ${volume!.score_mb}; mediana de ${RUNS} leituras frias do cache de facetas`,
      "leitura".padEnd(24) + "total ms".padStart(10) + "  estágios (ms)  ‖  consulta: ms / blocos tocados / temp",
    ];
    const evidence: unknown[] = [];

    const reads: { name: string; run: () => Promise<{ totalMs: number; stages: string; golden: unknown }> }[] = [
      ...SCENARIOS.map(({ name, params }) => ({
        name,
        run: async () => {
          const { view, report } = await readJobs(params);
          expect(view.total).toBeGreaterThan(0);
          return {
            totalMs: report.totalMs,
            stages: report.stages.map((s) => `${s.stage}=${s.ms}`).join(" "),
            golden: { rows: view.rows.map((r) => r.jobId), total: view.total, facets: view.facets },
          };
        },
      })),
      {
        name: "/ cockpit",
        run: async () => {
          const { data, totalMs } = await readCockpit();
          return {
            totalMs,
            stages: "",
            golden: { stats: data.stats, total: data.total, top: data.top.map((r) => r.jobId), facets: data.facets },
          };
        },
      },
    ];

    for (const read of reads) {
      await read.run();
      const samples = [];
      for (let run = 0; run < RUNS; run++) samples.push(await read.run());
      for (const sample of samples) expect(sample.golden).toEqual(samples[0]!.golden);
      const statements = await capture(read.run);
      const explained = [];
      // Só leitura: `begin`/`commit` e o `set_config` da transação de
      // `nearMatches` não se explicam fora dela.
      for (const statement of statements.filter((s) => /^\s*(select|with)\b/i.test(s.query) && !s.query.includes("set_config"))) {
        const { ms, blocks, temp, plan } = await explain(statement);
        explained.push({ label: label(statement.query), ms, blocks, temp, plan });
      }
      const middle = [...samples].sort((a, b) => a.totalMs - b.totalMs)[Math.floor(samples.length / 2)]!;
      lines.push(
        read.name.padEnd(24) + median(samples.map((s) => s.totalMs)).toFixed(0).padStart(10) + `  ${middle.stages}`,
      );
      for (const item of explained.filter((e) => e.blocks > 50 || e.ms > 5)) {
        lines.push(`${"".padEnd(28)}${item.label}: ${item.ms.toFixed(1)} ms / ${item.blocks} / ${item.temp}`);
      }
      evidence.push({ read: read.name, samples, golden: samples[0]!.golden, explained });
    }
    lines.push("");
    const report = lines.join("\n");
    console.log(report);
    if (process.env.JHO_PERF_OUT) writeFileSync(process.env.JHO_PERF_OUT, report);
    if (process.env.JHO_PERF_JSON) writeFileSync(process.env.JHO_PERF_JSON, JSON.stringify(evidence, null, 2));
  }, 1_800_000);
});
