import { describe, expect, it, vi } from "vitest";
import { refreshFxRates } from "../src/contexts/fx/app/refresh-rates.ts";
import { erApiProvider } from "../src/contexts/fx/infra/er-api.ts";
import { frankfurterProvider } from "../src/contexts/fx/infra/frankfurter.ts";
import { drizzleFxRateStore } from "../src/contexts/fx/infra/drizzle-store.ts";
import type {
  FxQuote,
  FxRateProvider,
  FxRateStore,
} from "../src/contexts/fx/ports.ts";
import { fixtureHttp } from "../src/core/sources/http-port.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

function provider(name: string, fetch: FxRateProvider["fetch"]): FxRateProvider {
  return { name, fetch };
}

function store() {
  const saved: Array<FxQuote & { provider: string; fetchedAt: string }> = [];
  const port: FxRateStore = {
    async save(quote) {
      saved.push(quote);
    },
    async loadLatest() {
      return null;
    },
  };
  return { port, saved };
}

describe("FX application service", () => {
  it("owns provider fallback and persists only valid positive rates", async () => {
    const primary = provider("primary", vi.fn(async () => {
      throw new Error("offline");
    }));
    const fallback = provider("fallback", vi.fn(async () => ({
      base: "USD",
      date: "2026-08-19",
      rates: { BRL: 5.4, EUR: 0.91, ZERO: 0, BAD: Number.NaN },
    })));
    const cache = store();

    const result = await refreshFxRates({
      base: "USD",
      providers: [primary, fallback],
      store: cache.port,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });

    expect(primary.fetch).toHaveBeenCalledOnce();
    expect(fallback.fetch).toHaveBeenCalledOnce();
    expect(result).toEqual({
      base: "USD",
      date: "2026-08-19",
      provider: "fallback",
      count: 2,
      currencies: ["BRL", "EUR"],
    });
    expect(cache.saved).toHaveLength(1);
    expect(cache.saved[0]).toMatchObject({
      provider: "fallback",
      rates: { BRL: 5.4, EUR: 0.91 },
      fetchedAt: "2026-08-20T00:00:00.000Z",
    });
  });

  it("does not call the fallback after the preferred provider succeeds", async () => {
    const primary = provider("primary", vi.fn(async () => ({
      base: "USD",
      date: "2026-08-19",
      rates: { BRL: 5.4 },
    })));
    const fallback = provider("fallback", vi.fn());
    const cache = store();

    await refreshFxRates({
      base: "USD",
      providers: [primary, fallback],
      store: cache.port,
    });

    expect(fallback.fetch).not.toHaveBeenCalled();
  });

  it("reports every provider failure when none can quote", async () => {
    const cache = store();
    await expect(
      refreshFxRates({
        base: "USD",
        providers: [
          provider("one", async () => { throw new Error("first"); }),
          provider("two", async () => { throw new Error("second"); }),
        ],
        store: cache.port,
      }),
    ).rejects.toThrow("one: first; two: second");
    expect(cache.saved).toHaveLength(0);
  });
});

describe("FX HTTP adapters", () => {
  it("maps a Frankfurter quote without leaking provider choice into the use case", async () => {
    const client = fixtureHttp({
      "api.frankfurter.dev": {
        amount: 1,
        base: "USD",
        date: "2026-08-19",
        rates: { BRL: 5.4 },
      },
    });

    await expect(frankfurterProvider(client).fetch("USD")).resolves.toEqual({
      base: "USD",
      date: "2026-08-19",
      rates: { BRL: 5.4 },
    });
  });

  it("maps ER API and uses the injected date only when the response omits it", async () => {
    const client = fixtureHttp({
      "open.er-api.com": { result: "success", base_code: "USD", rates: { BRL: 5.5 } },
    });

    await expect(
      erApiProvider(client, () => new Date("2026-08-20T13:00:00Z")).fetch("USD"),
    ).resolves.toEqual({ base: "USD", date: "2026-08-20", rates: { BRL: 5.5 } });
  });
});

describe("FX Drizzle store", () => {
  it("round-trips the newest quote independently from provider fallback", async () => {
    await useTestDb();
    try {
      await drizzleFxRateStore.save({
        base: "USD",
        date: "2026-08-19",
        rates: { BRL: 5.4, EUR: 0.91 },
        provider: "fixture",
        fetchedAt: "2026-08-20T00:00:00.000Z",
      });

      await expect(drizzleFxRateStore.loadLatest("USD")).resolves.toEqual({
        base: "USD",
        date: "2026-08-19",
        rates: { BRL: 5.4, EUR: 0.91 },
      });
    } finally {
      releaseTestDb();
    }
  });
});
