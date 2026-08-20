import type { HttpPort } from "../../../core/sources/http-port.ts";
import type { FxRateProvider } from "../ports.ts";

type ErApiResponse = {
  result: string;
  base_code: string;
  time_last_update_utc?: string;
  rates: Record<string, number>;
};

export function erApiProvider(client: HttpPort, now: () => Date): FxRateProvider {
  return {
    name: "erapi",
    async fetch(base) {
      const data = await client.json<ErApiResponse>(
        `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
      );
      if (data.result !== "success") throw new Error(`er-api returned ${data.result}`);
      const date = (data.time_last_update_utc ? new Date(data.time_last_update_utc) : now())
        .toISOString()
        .slice(0, 10);
      return { base, date, rates: data.rates };
    },
  };
}

