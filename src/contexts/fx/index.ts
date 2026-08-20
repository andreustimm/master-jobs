import { clock } from "../../core/clock.ts";
import type { Currency, FxTable } from "../../core/money.ts";
import "../../core/sources/http.ts";
import { http } from "../../core/sources/http-port.ts";
import { refreshFxRates, type FetchRatesResult } from "./app/refresh-rates.ts";
import { ageInDays, STALE_AFTER_DAYS } from "./domain/freshness.ts";
import { drizzleFxRateStore } from "./infra/drizzle-store.ts";
import { erApiProvider } from "./infra/er-api.ts";
import { frankfurterProvider } from "./infra/frankfurter.ts";

export const DEFAULT_BASE: Currency = "USD";

export async function refreshRates(base: Currency = DEFAULT_BASE): Promise<FetchRatesResult> {
  const client = http();
  return refreshFxRates({
    base,
    providers: [
      frankfurterProvider(client),
      erApiProvider(client, () => new Date(clock().now())),
    ],
    store: drizzleFxRateStore,
    now: () => new Date(clock().now()),
  });
}

export async function loadRates(base: Currency = DEFAULT_BASE): Promise<FxTable | null> {
  return drizzleFxRateStore.loadLatest(base);
}

export { ageInDays, STALE_AFTER_DAYS };
export type { FetchRatesResult } from "./app/refresh-rates.ts";
export type { FxQuote, FxRateProvider, FxRateStore, StoredFxQuote } from "./ports.ts";

