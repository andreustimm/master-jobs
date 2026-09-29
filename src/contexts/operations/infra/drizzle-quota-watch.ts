/**
 * Persistência do vigia de cota em PostgreSQL (`quota_watch`, ADR 0030).
 *
 * Uma linha por checagem — nunca segredo, só número e texto operacional já
 * passado por `redactSecrets` em quem chama (`app/quota-watch.ts`).
 */
import { desc } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { quotaWatch } from "../../../core/db/schema.ts";
import type { QuotaDecision, QuotaTrigger } from "../domain/quota-watch.ts";
import type { QuotaWatchHistoryEntry, QuotaWatchRow, QuotaWatchStore } from "../ports.ts";

function asTrigger(value: string | null): QuotaTrigger | null {
  return value === "vercel" || value === "actions" ? value : null;
}

export const drizzleQuotaWatch: QuotaWatchStore = {
  async record(row: QuotaWatchRow): Promise<void> {
    await getDb().insert(quotaWatch).values(row);
  },

  /**
   * M1/M4 — o dedupe de alerta e o streak de amostra indisponível dependem só
   * destas três colunas. Ordena por `id`, não por `checked_at`: duas
   * checagens no mesmo milissegundo não podem inverter a ordem real de
   * inserção (o mesmo raciocínio vale no SQL, `supabase/cron/watchdog.sql`).
   */
  async recent(limit: number): Promise<QuotaWatchHistoryEntry[]> {
    const rows = await getDb()
      .select({ decision: quotaWatch.decision, trigger: quotaWatch.trigger, issueNumber: quotaWatch.issueNumber })
      .from(quotaWatch)
      .orderBy(desc(quotaWatch.id))
      .limit(limit);
    return rows.map((row) => ({
      decision: row.decision as QuotaDecision["state"],
      trigger: asTrigger(row.trigger),
      issueNumber: row.issueNumber,
    }));
  },
};

/** Leitura operacional: as últimas checagens, mais recente primeiro. */
export async function recentQuotaWatch(limit = 10) {
  return getDb().select().from(quotaWatch).orderBy(desc(quotaWatch.id)).limit(limit);
}
