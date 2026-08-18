/**
 * Exchange rates.
 *
 * Providers, in order of preference:
 *   1. Frankfurter (https://frankfurter.dev) — European Central Bank reference
 *      rates. No key, no signup, no documented rate limit. 30 currencies,
 *      which covers every currency observed in this corpus (USD, CAD, AUD,
 *      MXN, PHP) plus BRL, EUR and GBP.
 *   2. open.er-api.com — 160+ currencies, no key. Used only for codes the ECB
 *      does not publish.
 *
 * Rates are cached in the `fx_rate` table by quote date. The scorer never hits
 * the network: it reads a table that was fetched beforehand. That keeps scoring
 * pure, offline-capable and — most importantly — reproducible, since the rate
 * that produced a score is still on disk.
 *
 * ECB publishes once per business day around 16:00 CET, so a rate a day or two
 * old is normal, not an error.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { fxRate } from "./db/schema.ts";
import { getJson } from "./sources/http.ts";
import type { Currency, FxTable } from "./money.ts";

export const DEFAULT_BASE: Currency = "USD";

type FrankfurterResponse = {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
};

type ErApiResponse = {
  result: string;
  base_code: string;
  time_last_update_utc?: string;
  rates: Record<string, number>;
};

export type FetchRatesResult = {
  base: Currency;
  date: string;
  provider: string;
  count: number;
  currencies: Currency[];
};

/** Fetch the latest rates and cache them. Safe to call repeatedly. */
export async function refreshRates(base: Currency = DEFAULT_BASE): Promise<FetchRatesResult> {
  const db = getDb();
  let date: string;
  let rates: Record<string, number>;
  let provider: string;

  try {
    const data = await getJson<FrankfurterResponse>(
      `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`,
    );
    date = data.date;
    rates = data.rates;
    provider = "frankfurter";
  } catch (primaryError) {
    // The ECB feed is the better source but it is a single point of failure.
    try {
      const data = await getJson<ErApiResponse>(
        `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
      );
      if (data.result !== "success") throw new Error(`er-api returned ${data.result}`);
      date = (data.time_last_update_utc
        ? new Date(data.time_last_update_utc)
        : new Date()
      )
        .toISOString()
        .slice(0, 10);
      rates = data.rates;
      provider = "erapi";
    } catch (fallbackError) {
      throw new Error(
        `Não foi possível obter cotações. Frankfurter: ${
          primaryError instanceof Error ? primaryError.message : String(primaryError)
        }. open.er-api: ${
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }`,
      );
    }
  }

  const currencies: Currency[] = [];
  for (const [currency, rate] of Object.entries(rates)) {
    if (!Number.isFinite(rate) || rate <= 0) continue;
    await db
      .insert(fxRate)
      .values({ date, base, currency, rate, provider })
      .onConflictDoUpdate({
        target: [fxRate.date, fxRate.base, fxRate.currency],
        set: { rate, provider, fetchedAt: new Date().toISOString() },
      });
    currencies.push(currency);
  }

  return { base, date, provider, count: currencies.length, currencies: currencies.sort() };
}

/**
 * Load the most recent cached rate table.
 * Returns null when nothing has been fetched yet — the caller must say so
 * rather than pretend every currency equals every other.
 */
export async function loadRates(base: Currency = DEFAULT_BASE): Promise<FxTable | null> {
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

  const rates: Record<Currency, number> = {};
  for (const row of rows) rates[row.currency] = row.rate;

  return { base, rates, date };
}

/** Days since the table was quoted. Used to warn about stale rates. */
export function ageInDays(fx: FxTable, now = new Date()): number {
  const quoted = Date.parse(`${fx.date}T00:00:00Z`);
  if (Number.isNaN(quoted)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - quoted) / 86_400_000);
}

/**
 * A rate table is considered stale after a week. ECB skips weekends and
 * holidays, so anything under ~4 days is routine.
 */
export const STALE_AFTER_DAYS = 7;
