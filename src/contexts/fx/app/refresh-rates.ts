import type { Currency } from "../../../core/money.ts";
import type { FxRateProvider, FxRateStore } from "../ports.ts";

export type FetchRatesResult = {
  base: Currency;
  date: string;
  provider: string;
  count: number;
  currencies: Currency[];
};

type RefreshFxRatesInput = {
  base: Currency;
  providers: readonly FxRateProvider[];
  store: FxRateStore;
  now?: () => Date;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Selects the first healthy provider, validates its quote, and persists it. */
export async function refreshFxRates(input: RefreshFxRatesInput): Promise<FetchRatesResult> {
  const failures: string[] = [];

  for (const provider of input.providers) {
    try {
      const quote = await provider.fetch(input.base);
      const rates = Object.fromEntries(
        Object.entries(quote.rates).filter(([, rate]) => Number.isFinite(rate) && rate > 0),
      );
      const currencies = Object.keys(rates).sort();
      if (currencies.length === 0) throw new Error("resposta sem cotações válidas");

      await input.store.save({
        base: input.base,
        date: quote.date,
        rates,
        provider: provider.name,
        fetchedAt: (input.now ?? (() => new Date()))().toISOString(),
      });

      return {
        base: input.base,
        date: quote.date,
        provider: provider.name,
        count: currencies.length,
        currencies,
      };
    } catch (error) {
      failures.push(`${provider.name}: ${errorMessage(error)}`);
    }
  }

  throw new Error(`Não foi possível obter cotações. ${failures.join("; ")}`);
}

