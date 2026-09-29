/**
 * Persistência do vigia de cota em PostgreSQL (`quota_watch`, ADR 0030).
 *
 * Uma linha por checagem — nunca segredo, só número e texto operacional já
 * passado por `redactSecrets` em quem chama (`app/quota-watch.ts`).
 */
import { desc } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { quotaWatch } from "../../../core/db/schema.ts";
import type { QuotaWatchRow, QuotaWatchStore } from "../ports.ts";

export const drizzleQuotaWatch: QuotaWatchStore = {
  async record(row: QuotaWatchRow): Promise<void> {
    await getDb().insert(quotaWatch).values(row);
  },
};

/** Leitura operacional: as últimas checagens, mais recente primeiro. */
export async function recentQuotaWatch(limit = 10) {
  return getDb().select().from(quotaWatch).orderBy(desc(quotaWatch.checkedAt)).limit(limit);
}
