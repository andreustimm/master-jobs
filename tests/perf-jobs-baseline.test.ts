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
import { createStageTimer, type TimingReport } from "../src/core/observability.ts";
import type { DB } from "../src/core/db/client.ts";
import { sql } from "drizzle-orm";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const enabled = process.env.JHO_PERF === "1";
const JOBS = Number(process.env.JHO_PERF_JOBS ?? 10_000);
const RUNS = 3;

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

async function measure(params: Record<string, string>): Promise<{ report: TimingReport; queries: number }> {
  const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
  const original = client.unsafe.bind(client);
  let queries = 0;
  client.unsafe = (...args: unknown[]) => {
    queries += 1;
    return original(...args);
  };
  try {
    const timer = createStageTimer();
    const view = await loadJobsView({
      candidateId: owner, params, page: 1, pageSize: 50, prefetch: false,
      schedule: () => {}, now: new Date("2026-09-20T12:00:00Z"), timer,
    });
    expect(view.total).toBeGreaterThan(0);
    return { report: timer.report("/jobs"), queries };
  } finally {
    client.unsafe = original;
  }
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe.runIf(enabled)("baseline de /jobs", () => {
  beforeEach(async () => {
    db = await useTestDb();
    await seedCorpus();
  }, 300_000);

  afterEach(async () => {
    await releaseTestDb();
  });

  it(`cronometra ${SCENARIOS.length} cenários sobre ${JOBS} vagas`, async () => {
    const lines = [
      "",
      `baseline /jobs — ${JOBS} vagas, mediana de ${RUNS} execuções, PostgreSQL local (sem rede)`,
      "cenário".padEnd(24) + "total ms".padStart(10) + "idas".padStart(6) + "  estágios (ms)",
    ];
    for (const scenario of SCENARIOS) {
      await measure(scenario.params); // aquece o plano e o cache de páginas
      const runs = [];
      for (let run = 0; run < RUNS; run++) runs.push(await measure(scenario.params));
      const totals = runs.map((r) => r.report.totalMs);
      const middle = runs.find((r) => r.report.totalMs === median(totals))!;
      const stages = middle.report.stages.map((s) => `${s.stage}=${s.ms}`).join(" ");
      lines.push(
        scenario.name.padEnd(24) + median(totals).toFixed(0).padStart(10) + String(middle.queries).padStart(6) + `  ${stages}`,
      );
    }
    lines.push("");
    const report = lines.join("\n");
    console.log(report);
    // O vitest captura o console de teste que passa; o arquivo é o caminho
    // certo para guardar um "antes" e comparar com o "depois".
    if (process.env.JHO_PERF_OUT) writeFileSync(process.env.JHO_PERF_OUT, report);
  }, 600_000);
});
