import { and, eq, sql } from "drizzle-orm";
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
    // Uma consulta, não duas em série: a data mais recente vem de subconsulta.
    // Cada ida ao banco é um round-trip, e a tela de vagas pedia o câmbio antes
    // de poder começar as leituras que dependem dele.
    const rows = await getDb()
      .select({ date: fxRate.date, currency: fxRate.currency, rate: fxRate.rate })
      .from(fxRate)
      .where(
        and(
          eq(fxRate.base, base),
          eq(fxRate.date, sql`(select max(${fxRate.date}) from ${fxRate} where ${fxRate.base} = ${base})`),
        ),
      );
    const date = rows[0]?.date;
    if (!date) return null;
    return {
      base,
      date,
      rates: Object.fromEntries(rows.map((row) => [row.currency, row.rate])),
    };
  },
};

