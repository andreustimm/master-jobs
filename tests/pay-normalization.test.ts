import { describe, expect, it } from "vitest";
import { annualFactorSql, annualize, money, normalizePayTop, toPeriod, type FxTable } from "../src/core/money.ts";

const FX: FxTable = { base: "USD", rates: { BRL: 5.0, EUR: 0.9 }, date: "2026-09-18" };
const USD_MONTH = { currency: "USD", period: "month" } as const;

describe("pay normalization (ADR-013)", () => {
  it("UT-013 the SQL factor comes from the same table as TypeScript", () => {
    const sql = annualFactorSql("p");
    for (const [period, factor] of [["hour", 2080], ["day", 260], ["week", 52], ["month", 12], ["year", 1]] as const) {
      expect(sql).toContain(`when '${period}' then ${factor}`);
    }
    expect(sql).not.toMatch(/'project' then/);
    expect(sql).toMatch(/else null end\)$/);
  });

  it("UT-014 a yearly range normalizes its top to per month", () => {
    expect(normalizePayTop({ compMin: 100_000, compMax: 120_000, currency: "USD", period: "year" }, USD_MONTH, FX)).toEqual({
      kind: "amount",
      amount: 10_000,
    });
  });

  it("UT-015 an hourly rate uses 2,080 hours a year, to two decimals", () => {
    expect(normalizePayTop({ compMax: 50, currency: "USD", period: "hour" }, USD_MONTH, FX)).toEqual({
      kind: "amount",
      amount: 8666.67,
    });
  });

  it("UT-016 only a minimum is still the top of what is offered", () => {
    expect(normalizePayTop({ compMin: 7000, compMax: null, currency: "USD", period: "month" }, USD_MONTH, FX)).toEqual({
      kind: "amount",
      amount: 7000,
    });
  });

  it("UT-017 unknown currency and project without duration are not comparable; no amount is undisclosed", () => {
    expect(normalizePayTop({ compMax: 900_000, currency: "ARS", period: "month" }, USD_MONTH, FX)).toEqual({
      kind: "not_comparable",
    });
    expect(normalizePayTop({ compMax: 30_000, currency: "USD", period: "project" }, USD_MONTH, FX)).toEqual({
      kind: "not_comparable",
    });
    expect(normalizePayTop({ compMin: null, compMax: null, currency: "USD", period: "year" }, USD_MONTH, FX)).toEqual({
      kind: "undisclosed",
    });
    expect(normalizePayTop({ compMin: 0, compMax: 0, currency: "USD", period: "year" }, USD_MONTH, FX)).toEqual({
      kind: "undisclosed",
    });
  });

  it("UT-018 other currencies convert through the stored quote", () => {
    expect(normalizePayTop({ compMax: 50_000, currency: "BRL", period: "month" }, USD_MONTH, FX)).toEqual({
      kind: "amount",
      amount: 10_000,
    });
  });

  it("UT-019 a project with a duration annualizes, then normalizes per month", () => {
    const annual = annualize(money(30_000, "USD", "project", 6));
    expect(annual).toEqual({ amount: 60_000, currency: "USD", period: "year" });
    expect(toPeriod(annual!, "month")!.amount).toBe(5000);
    expect(normalizePayTop({ compMax: 30_000, currency: "USD", period: "project", durationMonths: 6 }, USD_MONTH, FX)).toEqual({
      kind: "amount",
      amount: 5000,
    });
  });
});
