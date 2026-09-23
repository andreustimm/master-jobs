/**
 * Reserva e métrica da varredura fatiada, em PostgreSQL.
 *
 * Tabela e não broker — ADR 0009, a mesma decisão das filas. O único ponto
 * delicado é a reserva, e ela é um único comando: `INSERT ... ON CONFLICT DO
 * UPDATE ... WHERE` com `RETURNING`. Quem encontra a linha livre a leva; quem
 * chega junto não casa o `WHERE` e recebe zero linhas. Não há leitura antes da
 * escrita, então não há janela entre as duas.
 */
import { and, eq, like, lt, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { candidate, source, sweepLease, sweepRun } from "../../../core/db/schema.ts";
import { LEASE_DEAD_MS, type SweepLease, type SweepRuns } from "../domain/sweep.ts";

const iso = (ms: number) => new Date(ms).toISOString();

export function drizzleSweepLease(worker: string): SweepLease {
  return {
    async read(prefix) {
      const rows = await getDb()
        .select()
        .from(sweepLease)
        .where(like(sweepLease.key, `${prefix}%`));
      return new Map(rows.map((row) => [row.key, row]));
    },

    async claim(key, at) {
      const now = iso(at.now);
      const dead = iso(at.now - LEASE_DEAD_MS);
      const notBefore = iso(at.notBefore);
      const rows = await getDb()
        .insert(sweepLease)
        .values({ key, claimedAt: now, claimedBy: worker, lastClaimedAt: now })
        .onConflictDoUpdate({
          target: sweepLease.key,
          set: { claimedAt: now, claimedBy: worker, lastClaimedAt: now },
          // Livre (ou de função morta) E sem término recente: sem a segunda
          // metade, a chamada que leu a lista antes de outra terminar a mesma
          // fonte a sincronizaria de novo segundos depois.
          setWhere: sql`(${sweepLease.claimedAt} is null or ${sweepLease.claimedAt} < ${dead})
            and (${sweepLease.lastFinishedAt} is null or ${sweepLease.lastFinishedAt} < ${notBefore})`,
        })
        .returning({ key: sweepLease.key });
      return rows.length > 0;
    },

    async release(key, now) {
      // Só solta a própria reserva. Se a função demorou além do prazo e outra
      // já reservou, apagar a reserva alheia deixaria as duas trabalhando.
      await getDb()
        .update(sweepLease)
        .set({ claimedAt: null, claimedBy: null, lastFinishedAt: iso(now) })
        .where(and(eq(sweepLease.key, key), eq(sweepLease.claimedBy, worker)));
    },
  };
}

/** `last_synced_at` por fonte, para a ordem do round-robin e o alarme. */
export async function lastSyncedBySource(): Promise<Map<string, string | null>> {
  const rows = await getDb().select({ id: source.id, lastSyncedAt: source.lastSyncedAt }).from(source);
  return new Map(rows.map((row) => [row.id, row.lastSyncedAt]));
}

export async function candidateIds(): Promise<number[]> {
  const rows = await getDb().select({ id: candidate.id }).from(candidate).orderBy(candidate.id);
  return rows.map((row) => row.id);
}

export const drizzleSweepRuns: SweepRuns = {
  async record(rows) {
    if (rows.length === 0) return;
    await getDb().insert(sweepRun).values(rows);
  },
  async prune(before) {
    await getDb().delete(sweepRun).where(lt(sweepRun.startedAt, iso(before)));
  },
};
