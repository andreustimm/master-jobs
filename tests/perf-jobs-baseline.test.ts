/**
 * Baseline de latência da tela de vagas — `pnpm perf:jobs`.
 *
 * Não é teste de regressão e fica FORA do `pnpm check`: sem `JHO_PERF=1` todos
 * os casos são pulados. Existe para responder "quanto custa cada cenário, e
 * onde" com número, antes e depois de cada otimização, no mesmo corpus.
 *
 * O que ele mede e o que NÃO mede:
 * - Mede o trabalho do servidor sobre o banco — varreduras, agrupamento, SQL
 *   gigante — num PostgreSQL local, sem rede. É o PISO: o tempo real em
 *   produção soma a este o round-trip entre a função e o Supabase, uma vez por
 *   ESTÁGIO em série (a coluna `idas` diz quantas consultas cada cenário faz).
 * - Não mede renderização de React, nem a rede do navegador.
 *
 * Sem asserção de tempo, de propósito: tempo varia de máquina e um limite fixo
 * seria um teste que falha por acaso. As asserções são só de sanidade.
 */
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadJobsView } from "../app/jobs/jobs-data.ts";
import { ensurePrimaryTrack, trackScope } from "../src/contexts/matching/index.ts";
import { candidate, fxRate, job, jobScore, source } from "../src/core/db/schema.ts";
import { createStageTimer } from "../src/core/observability.ts";
import type { DB } from "../src/core/db/client.ts";
import { sql } from "drizzle-orm";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const enabled = process.env.JHO_PERF === "1";
const JOBS = Number(process.env.JHO_PERF_JOBS ?? 10_000);
const RUNS = Number(process.env.JHO_PERF_RUNS ?? 3);
const WARMUPS = Number(process.env.JHO_PERF_WARMUPS ?? 1);

const CURRENCIES = [
  "BRL", "EUR", "GBP", "CAD", "AUD", "MXN", "ARS", "COP", "CLP", "PEN", "UYU", "CHF", "SEK", "NOK", "DKK",
  "PLN", "CZK", "HUF", "RON", "TRY", "INR", "JPY", "CNY", "SGD", "HKD", "NZD", "ZAR", "ILS", "AED",
];

let db: DB;
let owner: number;

async function seedCorpus() {
  const [row] = await db.insert(candidate).values({ slug: "perf", name: "Perf", isDefault: true }).returning();
  owner = row!.id;
  await ensurePrimaryTrack(owner);
  await db.insert(source).values({ id: "manual:perf", kind: "manual", handle: "perf", label: "Perf" });
  await db.insert(fxRate).values(
    CURRENCIES.map((currency, index) => ({
      date: "2026-09-18", base: "USD", currency, rate: 0.5 + index * 0.37, provider: "perf",
    })),
  );
  // 40 títulos × 15 localizações: as mesmas vagas repetidas por país, que é o
  // que faz o agrupamento (`canonicalOfGroup`) trabalhar de verdade.
  await db.execute(sql.raw(`
    insert into production.job (source_id, company_name, external_id, title, description_text, location_raw,
      url, fingerprint, content_hash, raw, comp_max, comp_currency, comp_period)
    select 'manual:perf', 'Company ' || (x % 300), 'perf-' || x,
      'Engineer ' || (x % 40),
      case when x % 10 = 0 then 'short'
        else (select string_agg(md5(x::text || g::text), ' ') from generate_series(1, 40) g)
          || case when x % 7 = 0 then ' laravel' else '' end end,
      (array['Brazil','United States','Germany','Remote','Bogota, Colombia','Sao Paulo, Brazil','London, United Kingdom',
             'Mexico City, Mexico','Argentina','Portugal','Canada','Spain','France','Poland','India'])[1 + x % 15],
      'https://perf.test/' || x, 'perf-fp-' || x, 'perf-h-' || x, '{}',
      case when x % 5 = 0 then null else 3000 + (x % 50) * 200 end,
      (array['USD','BRL','EUR'])[1 + x % 3],
      (array['month','year','hour'])[1 + x % 3]
    from generate_series(1, ${JOBS}) as x
  `));
  await db.update(job).set({ firstSeenAt: "2026-09-18T12:00:00.000Z" });
  const trackId = (await trackScope(owner, { kind: "primary" }))!.primaryTrackId;
  const ids = await db.select({ id: job.id }).from(job);
  for (let at = 0; at < ids.length; at += 1000) {
    await db.insert(jobScore).values(
      ids.slice(at, at + 1000).map(({ id }) => ({
        candidateId: owner, trackId, jobId: id, fit: (id * 37) % 100,
        titleScore: 1, keywordScore: 1, seniorityScore: 1, geoScore: 1, compScore: 1,
        freshnessScore: 1, benefitScore: 1, penalty: 0, cluster: id % 3 === 0 ? "architect" : "backend",
        matchedKeywords: [], missingKeywords: [], detectedBenefits: [], ageDays: null,
        reasons: [], blockers: [], scorerVersion: "perf",
      })),
    );
  }
  await db.execute(sql.raw("analyze"));
}

type Scenario = { name: string; params: Record<string, string> };

const SCENARIOS: Scenario[] = [
  { name: "padrão", params: {} },
  { name: "com termo", params: { q: "laravel" } },
  { name: "com cluster", params: { cluster: "architect" } },
  { name: "faixa salarial", params: { pay: "6000", payMax: "30000", cur: "USD", per: "month" } },
  { name: "ordenar por pagamento", params: { sort: "comp", cur: "USD", per: "month" } },
  { name: "sem agrupar", params: { ungrouped: "1" } },
];

async function measure(params: Record<string, string>, profile = false) {
  const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
  const original = client.unsafe.bind(client);
  let queries = 0;
  let sqlBytes = 0;
  let parameters = 0;
  let largest: { query: string; values: unknown[] } | undefined;
  const statements: { query: string; values: unknown[] }[] = [];
  client.unsafe = (...args: unknown[]) => {
    queries += 1;
    const query = String(args[0]);
    const values = Array.isArray(args[1]) ? args[1] : [];
    const bytes = Buffer.byteLength(query);
    sqlBytes += bytes;
    parameters += values.length;
    if (profile && process.env.JHO_PERF_PLANS === "1") statements.push({ query, values });
    if (!largest || bytes > Buffer.byteLength(largest.query)) largest = { query, values };
    return original(...args);
  };
  try {
    const timer = createStageTimer();
    const view = await loadJobsView({
      candidateId: owner, params, page: 1, pageSize: 50, prefetch: false,
      schedule: () => {}, now: new Date("2026-09-20T12:00:00Z"), timer,
    });
    expect(view.total).toBeGreaterThan(0);
    const report = timer.report("/jobs");
    const golden = {
      rows: view.rows,
      total: view.total,
      facets: view.facets,
      hiddenByPayRange: view.hiddenByPayRange,
      pay: view.pay,
      offer: view.offer,
    };
    const plan = profile && largest
      ? await original(`explain (analyze, buffers, format json) ${largest.query}`, largest.values)
      : undefined;
    const plans = [];
    for (const statement of statements) {
      plans.push({
        sqlBytes: Buffer.byteLength(statement.query), parameters: statement.values.length,
        plan: await original(`explain (analyze, buffers, format json) ${statement.query}`, statement.values),
      });
    }
    return { report, queries, sqlBytes, parameters, golden, plan, plans };
  } finally {
    client.unsafe = original;
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

describe.runIf(enabled)("baseline de /jobs", () => {
  beforeEach(async () => {
    db = await useTestDb();
    await seedCorpus();
  }, 300_000);

  afterEach(async () => {
    await releaseTestDb();
  });

  it(`cronometra ${SCENARIOS.length} cenários sobre ${JOBS} vagas`, async () => {
    expect(Number.isInteger(RUNS) && RUNS > 0).toBe(true);
    expect(Number.isInteger(WARMUPS) && WARMUPS > 0).toBe(true);
    const evidence = [];
    const lines = [
      "",
      `baseline /jobs — ${JOBS} vagas, mediana de ${RUNS} execuções, PostgreSQL local (sem rede)`,
      "cenário".padEnd(24) + "total ms".padStart(10) + "idas".padStart(6) + "  estágios (ms)",
    ];
    for (const scenario of SCENARIOS) {
      let plan: unknown;
      let plans: unknown;
      for (let warmup = 0; warmup < WARMUPS; warmup++) {
        const warmed = await measure(scenario.params, warmup === WARMUPS - 1 && !!process.env.JHO_PERF_JSON);
        plan = warmed.plan;
        plans = warmed.plans;
      }
      const runs = [];
      for (let run = 0; run < RUNS; run++) runs.push(await measure(scenario.params));
      for (const run of runs) expect(run.golden).toEqual(runs[0]!.golden);
      const totals = runs.map((r) => r.report.totalMs);
      // A mediana de um número par de amostras pode não pertencer a nenhuma
      // execução; os estágios ilustram a amostra central superior, real.
      const middle = [...runs].sort((a, b) => a.report.totalMs - b.report.totalMs)[Math.floor(runs.length / 2)]!;
      const stages = middle.report.stages.map((s) => `${s.stage}=${s.ms}`).join(" ");
      lines.push(
        scenario.name.padEnd(24) + median(totals).toFixed(0).padStart(10) + String(middle.queries).padStart(6) + `  ${stages}`,
      );
      evidence.push({
        scenario: scenario.name,
        samples: runs.map(({ report, queries, sqlBytes, parameters }) => ({ report, queries, sqlBytes, parameters })),
        golden: middle.golden,
        plan,
        plans,
      });
    }
    lines.push("");
    const report = lines.join("\n");
    console.log(report);
    // O vitest captura o console de teste que passa; o arquivo é o caminho
    // certo para guardar um "antes" e comparar com o "depois".
    if (process.env.JHO_PERF_OUT) writeFileSync(process.env.JHO_PERF_OUT, report);
    if (process.env.JHO_PERF_JSON) {
      writeFileSync(process.env.JHO_PERF_JSON, JSON.stringify({ jobs: JOBS, runs: RUNS, warmups: WARMUPS, evidence }, null, 2));
    }
  }, 600_000);
});
