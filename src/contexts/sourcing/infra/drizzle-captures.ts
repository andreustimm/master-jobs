/**
 * Fila e registro de captura por termo em PostgreSQL. Adapter burro: lê,
 * grava, mapeia. A reivindicação segue o padrão das outras filas de tabela
 * (ADR 0009): um `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { clock } from "../../../core/clock.ts";
import { getDb } from "../../../core/db/client.ts";
import { source, termAttribution, termCapture } from "../../../core/db/schema.ts";
import type { FetchableSourceKind } from "../../../core/sources/types.ts";
import { termSource } from "../domain/capture.ts";
import type { CaptureRecord } from "../domain/health.ts";
import { windowStarts } from "../domain/windows.ts";
import type {
  CaptureOrigin,
  CaptureStatus,
  ClaimedCapture,
  TermCaptureQueuePort,
} from "../ports.ts";

/** Claim mais velho que isto volta à fila: o `after()` morre em 30 segundos. */
export const CAPTURE_LEASE_MS = 5 * 60_000;

export const drizzleCaptureQueue: TermCaptureQueuePort = {
  async enqueue(rows, writer = getDb()) {
    if (rows.length === 0) return { created: 0, existing: 0 };
    const now = clock().iso();
    const written = await writer
      .insert(termCapture)
      .values(
        rows.map((row) => ({
          platform: row.platform,
          termKey: row.termKey,
          query: row.query,
          windowDay: row.windowDay,
          origin: row.origin,
          priority: row.priority,
          status: row.skipped ? "skipped" : "queued",
          reasonCode: row.skipped ?? null,
        })),
      )
      // A capture already done today serves this request too. Touching
      // `updated_at` after `finished_at` is how the screen tells "reused" from
      // "ran for you" without a column of its own.
      .onConflictDoUpdate({
        target: [termCapture.platform, termCapture.termKey, termCapture.windowDay],
        set: { updatedAt: now },
        setWhere: sql`${termCapture.status} = 'succeeded'`,
      })
      .returning({ inserted: sql<boolean>`xmax = 0` });
    const created = written.filter((row) => row.inserted).length;
    return { created, existing: rows.length - created };
  },

  async claim(worker, now) {
    const at = now.toISOString();
    const expired = new Date(now.getTime() - CAPTURE_LEASE_MS).toISOString();
    const today = windowStarts(now).day;
    const rows = await getDb()
      .update(termCapture)
      .set({
        status: "running",
        claimedAt: at,
        claimedBy: worker,
        startedAt: at,
        attempts: sql`${termCapture.attempts} + 1`,
        updatedAt: at,
      })
      .where(
        sql`${termCapture.id} = (
          select id from production.term_capture
          where status = 'queued'
             or (status = 'waiting_quota' and run_after <= ${at} and window_day = ${today})
             or (status = 'running' and claimed_at < ${expired})
          order by priority desc, id asc
          limit 1 for update skip locked
        )`,
      )
      .returning({
        id: termCapture.id,
        platform: termCapture.platform,
        termKey: termCapture.termKey,
        query: termCapture.query,
        windowDay: termCapture.windowDay,
      });
    const row = rows[0];
    return row ? { ...row, platform: row.platform as FetchableSourceKind } satisfies ClaimedCapture : null;
  },

  async finish(id, outcome, now) {
    const at = now.toISOString();
    const base = { status: outcome.status, claimedAt: null, claimedBy: null, updatedAt: at };
    const patch =
      outcome.status === "succeeded"
        ? {
            ...base,
            reasonCode: null,
            runAfter: null,
            fetched: outcome.fetched,
            created: outcome.created,
            known: outcome.known,
            attributed: outcome.attributed,
            totalHint: outcome.totalHint,
            finishedAt: at,
          }
        : outcome.status === "waiting_quota"
          ? { ...base, reasonCode: "quota", runAfter: outcome.retryAt }
          : { ...base, reasonCode: outcome.code, runAfter: null, finishedAt: at };
    // Só quem ainda segura a tarefa conclui: um claim expirado e retomado por
    // outro trabalhador não pode ser sobrescrito pelo primeiro.
    await getDb()
      .update(termCapture)
      .set(patch)
      .where(and(eq(termCapture.id, id), eq(termCapture.status, "running")));
  },
};

/** Cria a fonte `~terms` da plataforma na primeira captura, desligada. */
export async function ensureTermSource(kind: FetchableSourceKind): Promise<string> {
  const term = termSource(kind);
  await getDb()
    .insert(source)
    .values({ id: term.id, kind, handle: term.handle, label: term.label, enabled: false })
    .onConflictDoNothing({ target: source.id });
  return term.id;
}

export async function recordAttribution(termKey: string, jobId: number, platform: FetchableSourceKind): Promise<void> {
  await getDb()
    .insert(termAttribution)
    .values({ termKey, jobId, platform })
    .onConflictDoNothing({ target: [termAttribution.termKey, termAttribution.jobId] });
}

/**
 * Os ids das vagas que um termo trouxe, como subconsulta para o filtro "trazida
 * por" da tela Vagas. Entre parênteses, pronta para `job.id in …`.
 */
export function attributedJobIds(termKey: string): SQL {
  return sql`(select ${termAttribution.jobId} from ${termAttribution} where ${termAttribution.termKey} = ${termKey})`;
}

/**
 * Put today's failed captures of a term back in the queue — except a gone
 * endpoint, which fails again for sure. The manual re-run inside the cooldown
 * uses this: a platform that failed is retried, the ones that answered are not
 * called twice.
 */
export async function requeueFailed(termKey: string, now: Date): Promise<number> {
  const rows = await getDb()
    .update(termCapture)
    .set({ status: "queued", reasonCode: null, runAfter: null, updatedAt: now.toISOString() })
    .where(
      and(
        eq(termCapture.termKey, termKey),
        eq(termCapture.windowDay, windowStarts(now).day),
        eq(termCapture.status, "failed"),
        sql`${termCapture.reasonCode} is distinct from 'endpoint_gone'`,
      ),
    )
    .returning({ id: termCapture.id });
  return rows.length;
}

export type CaptureDay = {
  termKey: string;
  windowDay: string;
  status: CaptureStatus;
  fetched: number;
};

/** Daily outcomes of some terms since a UTC day, for the "no results" streak. */
export async function captureHistory(termKeys: readonly string[], sinceDay: string): Promise<CaptureDay[]> {
  if (termKeys.length === 0) return [];
  const rows = await getDb()
    .select({
      termKey: termCapture.termKey,
      windowDay: termCapture.windowDay,
      status: termCapture.status,
      fetched: termCapture.fetched,
    })
    .from(termCapture)
    .where(and(inArray(termCapture.termKey, [...termKeys]), sql`${termCapture.windowDay} >= ${sinceDay}`));
  return rows.map((row) => ({ ...row, status: row.status as CaptureStatus }));
}

/** When the daily sweep last asked for a capture; null if it never did. */
export async function lastSweepCaptureAt(): Promise<string | null> {
  const [row] = await getDb()
    .select({ at: sql<string | null>`max(${termCapture.createdAt})` })
    .from(termCapture)
    .where(eq(termCapture.origin, "sweep"));
  return row?.at ?? null;
}

export type CaptureStateRow = {
  termKey: string;
  platform: FetchableSourceKind;
  status: CaptureStatus;
  reasonCode: string | null;
  runAfter: string | null;
  windowDay: string;
  fetched: number;
  created: number;
  known: number;
  attributed: number;
  totalHint: number | null;
  finishedAt: string | null;
  updatedAt: string;
};

/** A captura mais recente de cada (termo, plataforma). */
export async function latestCaptures(termKeys: readonly string[]): Promise<CaptureStateRow[]> {
  if (termKeys.length === 0) return [];
  const rows = await getDb()
    .selectDistinctOn([termCapture.termKey, termCapture.platform], {
      termKey: termCapture.termKey,
      platform: termCapture.platform,
      status: termCapture.status,
      reasonCode: termCapture.reasonCode,
      runAfter: termCapture.runAfter,
      windowDay: termCapture.windowDay,
      fetched: termCapture.fetched,
      created: termCapture.created,
      known: termCapture.known,
      attributed: termCapture.attributed,
      totalHint: termCapture.totalHint,
      finishedAt: termCapture.finishedAt,
      updatedAt: termCapture.updatedAt,
    })
    .from(termCapture)
    .where(inArray(termCapture.termKey, [...termKeys]))
    .orderBy(termCapture.termKey, termCapture.platform, sql`${termCapture.windowDay} desc`, sql`${termCapture.id} desc`);
  return rows.map((row) => ({
    ...row,
    platform: row.platform as FetchableSourceKind,
    status: row.status as CaptureStatus,
  }));
}

/** Capturas de uma plataforma a partir de um dia UTC, para a saúde agregada. */
export async function captureRecords(platform: FetchableSourceKind, sinceDay: string): Promise<CaptureRecord[]> {
  const rows = await getDb()
    .select({
      status: termCapture.status,
      reasonCode: termCapture.reasonCode,
      origin: termCapture.origin,
      windowDay: termCapture.windowDay,
      termKey: termCapture.termKey,
      createdAt: termCapture.createdAt,
      updatedAt: termCapture.updatedAt,
    })
    .from(termCapture)
    .where(and(eq(termCapture.platform, platform), sql`${termCapture.windowDay} >= ${sinceDay}`));
  return rows.map((row) => ({
    ...row,
    status: row.status as CaptureStatus,
    origin: row.origin as CaptureOrigin,
  }));
}
