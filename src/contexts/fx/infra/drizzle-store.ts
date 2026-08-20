import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { fxRate } from "../../../core/db/schema.ts";
import type { FxRateStore } from "../ports.ts";

export const drizzleFxRateStore: FxRateStore = {
  async save(quote) {
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const [currency, rate] of Object.entries(quote.rates)) {
        await tx
          .insert(fxRate)
          .values({
            date: quote.date,
            base: quote.base,
            currency,
            rate,
            provider: quote.provider,
            fetchedAt: quote.fetchedAt,
          })
          .onConflictDoUpdate({
            target: [fxRate.date, fxRate.base, fxRate.currency],
            set: { rate, provider: quote.provider, fetchedAt: quote.fetchedAt },
          });
      }
    });
  },

  async loadLatest(base) {
    const db = getDb();
    const latest = await db
      .select({ date: fxRate.date })
      .from(fxRate)
      .where(eq(fxRate.base, base))
      .orderBy(desc(fxRate.date))
      .limit(1);
    const date = latest[0]?.date;
    if (!date) return null;

    const rows = await db
      .select({ currency: fxRate.currency, rate: fxRate.rate })
      .from(fxRate)
      .where(and(eq(fxRate.base, base), eq(fxRate.date, date)));
    return {
      base,
      date,
      rates: Object.fromEntries(rows.map((row) => [row.currency, row.rate])),
    };
  },
};

