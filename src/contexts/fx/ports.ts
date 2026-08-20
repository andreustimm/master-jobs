import type { Currency, FxTable } from "../../core/money.ts";

export type FxQuote = {
  base: Currency;
  date: string;
  rates: Record<string, number>;
};

export type StoredFxQuote = FxQuote & {
  provider: string;
  fetchedAt: string;
};

/** A remote source of currency quotes. Two real adapters are composed today. */
export type FxRateProvider = {
  name: string;
  fetch(base: Currency): Promise<FxQuote>;
};

/** Persistence is independent from provider selection and fallback. */
export type FxRateStore = {
  save(quote: StoredFxQuote): Promise<void>;
  loadLatest(base: Currency): Promise<FxTable | null>;
};

