/**
 * Execuções de captura e de verificação em PostgreSQL (`source_run`).
 *
 * Adapter burro: as decisões — transição, chave, composição do pai, redação —
 * chegam prontas de `../domain/runs.ts`. Duas garantias moram aqui porque só o
 * banco as dá:
 *
 * - a chave de idempotência é um índice único PARCIAL nos estados ativos, e a
 *   criação é `INSERT ... ON CONFLICT DO NOTHING` seguido da leitura da linha
 *   ativa: dois cliques simultâneos produzem uma execução;
 * - toda escrita de progresso filtra `status in ('queued','running')`, então
 *   uma linha terminal nunca muda — um resultado atrasado afeta zero linhas.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { sourceRun } from "../../../core/db/schema.ts";
import { ACTIVE_RUN_STATUSES, type RunCounts, type RunStatus } from "../domain/runs.ts";

export type SourceRunRow = typeof sourceRun.$inferSelect;

/** O que o pedido grava; o resto nasce nulo (contagem desconhecida). */
export type NewSourceRun = {
  scopeKind: "source" | "all" | "verify";
  sourceId: string | null;
  parentId: number | null;
  retryOf: number | null;
  idempotencyKey: string;
  actorUserId: number | null;
  configSnapshot: unknown;
  queuedAt: string;
};

const active = inArray(sourceRun.status, [...ACTIVE_RUN_STATUSES]);

export async function findActiveRun(key: string): Promise<SourceRunRow | null> {
  const [row] = await getDb()
    .select()
    .from(sourceRun)
    .where(and(eq(sourceRun.idempotencyKey, key), active));
  return row ?? null;
}

/**
 * Cria a execução ou devolve a equivalente já ativa. `created` diz qual das
 * duas — quem chamou só despacha o que criou.
 *
 * A segunda volta cobre a corrida estreita em que a equivalente terminou entre
 * o conflito e a leitura: aí a chave está livre de novo e a inserção passa.
 */
export async function createOrJoinRun(input: NewSourceRun): Promise<{ run: SourceRunRow; created: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [inserted] = await getDb()
      .insert(sourceRun)
      .values({ ...input, status: "queued" })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { run: inserted, created: true };
    const existing = await findActiveRun(input.idempotencyKey);
    if (existing) return { run: existing, created: false };
  }
  throw new Error("source_run: chave ocupada sem execução ativa legível");
}

export async function getRun(id: number): Promise<SourceRunRow | null> {
  const [row] = await getDb().select().from(sourceRun).where(eq(sourceRun.id, id));
  return row ?? null;
}

export async function childRuns(parentId: number): Promise<SourceRunRow[]> {
  return getDb().select().from(sourceRun).where(eq(sourceRun.parentId, parentId)).orderBy(asc(sourceRun.id));
}

/** Lista paginada, mais recente primeiro; só execuções de topo (sem pai). */
export async function listRuns(opts: { limit: number; offset: number }): Promise<{ rows: SourceRunRow[]; total: number }> {
  const db = getDb();
  const top = sql`${sourceRun.parentId} is null`;
  const [rows, [count]] = await Promise.all([
    db.select().from(sourceRun).where(top).orderBy(desc(sourceRun.queuedAt), desc(sourceRun.id)).limit(opts.limit).offset(opts.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(sourceRun).where(top),
  ]);
  return { rows, total: count?.n ?? 0 };
}

/**
 * Aplica uma transição decidida pelo domínio. Devolve `false` quando a linha
 * já não estava no estado esperado — outro processo andou antes, ou ela é
 * terminal —, e nada foi escrito.
 */
export async function transitionRun(
  id: number,
  from: RunStatus,
  to: RunStatus,
  patch: Partial<{
    heartbeatAt: string;
    startedAt: string;
    finishedAt: string;
    completeness: string | null;
    errorCode: string | null;
    errorDetail: string | null;
  }> &
    Partial<RunCounts> = {},
): Promise<boolean> {
  const rows = await getDb()
    .update(sourceRun)
    .set({ ...patch, status: to })
    // `active` repete a trava de imutabilidade mesmo quando `from` já é ativo:
    // a regra "terminal não muda" não pode depender de quem chama.
    .where(and(eq(sourceRun.id, id), eq(sourceRun.status, from), active))
    .returning({ id: sourceRun.id });
  return rows.length === 1;
}

/** Motivo visível numa execução que continua ativa (ex.: `no_token`, `waiting_slot`). */
export async function noteRun(id: number, errorCode: string | null, errorDetail: string | null = null): Promise<boolean> {
  const rows = await getDb()
    .update(sourceRun)
    .set({ errorCode, errorDetail })
    .where(and(eq(sourceRun.id, id), active))
    .returning({ id: sourceRun.id });
  return rows.length === 1;
}

export async function heartbeatRun(id: number, now: string): Promise<void> {
  await getDb()
    .update(sourceRun)
    .set({ heartbeatAt: now })
    .where(and(eq(sourceRun.id, id), eq(sourceRun.status, "running")));
}

/** As execuções `running`, para a regra de lease decidir quais morreram. */
export async function runningRuns(): Promise<Pick<SourceRunRow, "id" | "status" | "heartbeatAt">[]> {
  return getDb()
    .select({ id: sourceRun.id, status: sourceRun.status, heartbeatAt: sourceRun.heartbeatAt })
    .from(sourceRun)
    .where(eq(sourceRun.status, "running"));
}
