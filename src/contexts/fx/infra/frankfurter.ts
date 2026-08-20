import type { HttpPort } from "../../../core/sources/http-port.ts";
import type { FxRateProvider } from "../ports.ts";

type FrankfurterResponse = {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
};

export function frankfurterProvider(client: HttpPort): FxRateProvider {
  return {
    name: "frankfurter",
    async fetch(base) {
      const data = await client.json<FrankfurterResponse>(
        `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`,
      );
      return { base, date: data.date, rates: data.rates };
    },
  };
}

