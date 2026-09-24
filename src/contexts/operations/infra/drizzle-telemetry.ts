/**
 * Telemetria diária por rotina (#291): o que a varredura custou, por dia.
 *
 * Duas tabelas respondem juntas. `request_budget` diz quantas requisições cada
 * rotina fez a terceiros (e quantas o teto recusou), somando CLI, Vercel e
 * botão. `sweep_run` diz quantas chamadas cada fatia recebeu, quanto tempo
 * levaram e quantos erros tiveram. Só números, nomes de rotina e dias — nada de
 * vaga, URL ou candidato sai daqui, e é isso que deixa rodar a consulta contra
 * produção para medir o baseline.
 */
import { asc, gte, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { requestBudget, sweepRun } from "../../../core/db/schema.ts";

export type RequestDay = { day: string; routine: string; used: number; refused: number };

export type SweepDay = {
  day: string;
  slice: string;
  /** Chamadas à rota (`unit` nulo). */
  calls: number;
  /** Unidades processadas dentro das chamadas (fonte, candidato). */
  units: number;
  items: number;
  errors: number;
  totalMs: number;
  p95Ms: number;
  maxMs: number;
};

export type RoutineTelemetry = { since: string; requests: RequestDay[]; sweep: SweepDay[] };

export async function routineTelemetry(opts: { days: number; now: number }): Promise<RoutineTelemetry> {
  const since = new Date(opts.now - opts.days * 86_400_000).toISOString().slice(0, 10);
  const db = getDb();
  const requests = await db
    .select({ day: requestBudget.day, routine: requestBudget.routine, used: requestBudget.used, refused: requestBudget.refused })
    .from(requestBudget)
    .where(gte(requestBudget.day, since))
    .orderBy(asc(requestBudget.day), asc(requestBudget.routine));

  const day = sql<string>`substr(${sweepRun.startedAt}, 1, 10)`;
  const call = sql`${sweepRun.unit} is null`;
  const rows = await db
    .select({
      day,
      slice: sweepRun.slice,
      calls: sql<number>`count(*) filter (where ${call})`,
      units: sql<number>`count(*) filter (where not ${call})`,
      items: sql<number>`coalesce(sum(${sweepRun.items}) filter (where ${call}), 0)`,
      errors: sql<number>`coalesce(sum(${sweepRun.errors}) filter (where ${call}), 0)`,
      totalMs: sql<number>`coalesce(sum(${sweepRun.durationMs}) filter (where ${call}), 0)`,
      p95Ms: sql<number>`coalesce(percentile_disc(0.95) within group (order by ${sweepRun.durationMs}) filter (where ${call}), 0)`,
      maxMs: sql<number>`coalesce(max(${sweepRun.durationMs}) filter (where ${call}), 0)`,
    })
    .from(sweepRun)
    .where(gte(sweepRun.startedAt, since))
    .groupBy(day, sweepRun.slice)
    .orderBy(asc(day), asc(sweepRun.slice));

  // `count` e `sum` chegam do driver como texto (bigint/numeric).
  const sweep = rows.map((row) => ({
    day: row.day,
    slice: row.slice,
    calls: Number(row.calls),
    units: Number(row.units),
    items: Number(row.items),
    errors: Number(row.errors),
    totalMs: Number(row.totalMs),
    p95Ms: Number(row.p95Ms),
    maxMs: Number(row.maxMs),
  }));
  return { since, requests, sweep };
}
