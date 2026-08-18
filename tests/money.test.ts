import { describe, expect, it } from "vitest";
import {
  annualize,
  convert,
  formatMoney,
  money,
  parseCurrency,
  parsePeriod,
  toPeriod,
  type FxTable,
} from "../src/core/money.ts";

/** Real ECB quote from 2026-08-18, as fetched by `jho fx refresh`. */
const FX: FxTable = {
  base: "USD",
  date: "2026-08-18",
  rates: { BRL: 5.2074, CAD: 1.3874, EUR: 0.86386, MXN: 17.0535, PHP: 61.78, AUD: 1.4062 },
};

describe("parsePeriod", () => {
  it("handles every spelling actually present in the corpus", () => {
    // These five come from five different APIs, all in data/jobs.db.
    expect(parsePeriod("annual")).toBe("year");
    expect(parsePeriod("1 YEAR")).toBe("year");
    expect(parsePeriod("year")).toBe("year");
    expect(parsePeriod("hourly")).toBe("hour");
    expect(parsePeriod("monthly")).toBe("month");
  });

  it("handles prose forms", () => {
    expect(parsePeriod("per year")).toBe("year");
    expect(parsePeriod("per annum")).toBe("year");
    expect(parsePeriod("PER HOUR")).toBe("hour");
    expect(parsePeriod("USD / month")).toBe("month");
  });

  it("recognises fixed-price engagements", () => {
    expect(parsePeriod("project")).toBe("project");
    expect(parsePeriod("fixed-price")).toBe("project");
    expect(parsePeriod("one-time")).toBe("project");
  });

  it("returns null instead of guessing", () => {
    expect(parsePeriod("bananas")).toBeNull();
    expect(parsePeriod(null)).toBeNull();
    expect(parsePeriod("")).toBeNull();
  });
});

describe("parseCurrency", () => {
  it("accepts ISO codes and rejects anything else", () => {
    expect(parseCurrency("usd")).toBe("USD");
    expect(parseCurrency(" brl ")).toBe("BRL");
    expect(parseCurrency("dollars")).toBeNull();
    expect(parseCurrency("$")).toBeNull();
    expect(parseCurrency(null)).toBeNull();
  });
});

describe("annualize", () => {
  it("converts an hourly rate at the 2080h full-time equivalent", () => {
    // The exact bug this module was written for: USD 100/hour is 208k/year,
    // not 100/year.
    expect(annualize(money(100, "USD", "hour"))?.amount).toBe(208_000);
  });

  it("converts monthly and weekly", () => {
    expect(annualize(money(10_000, "USD", "month"))?.amount).toBe(120_000);
    expect(annualize(money(2_000, "USD", "week"))?.amount).toBe(104_000);
  });

  it("leaves an annual figure alone", () => {
    expect(annualize(money(150_000, "USD", "year"))?.amount).toBe(150_000);
  });

  it("annualises a project using its duration", () => {
    // 30k over 2 months is a 180k/year pace.
    expect(annualize(money(30_000, "USD", "project", 2))?.amount).toBe(180_000);
    // The same 30k stretched over a year is not.
    expect(annualize(money(30_000, "USD", "project", 12))?.amount).toBe(30_000);
  });

  it("refuses to annualise a project with no duration", () => {
    // Guessing a timeline would flip the verdict, so it returns null instead.
    expect(annualize(money(30_000, "USD", "project"))).toBeNull();
    expect(annualize(money(30_000, "USD", "project", 0))).toBeNull();
  });
});

describe("toPeriod", () => {
  it("round-trips through the annual figure", () => {
    const hourly = toPeriod(money(208_000, "USD", "year"), "hour");
    expect(hourly?.amount).toBe(100);
  });
});

describe("convert", () => {
  it("converts through the base currency", () => {
    const cad = money(330_000, "CAD", "year");
    const usd = convert(cad, "USD", FX);
    expect(usd?.currency).toBe("USD");
    expect(Math.round(usd?.amount ?? 0)).toBe(237_855);
  });

  it("converts between two non-base currencies", () => {
    const brl = money(100_000, "BRL", "year");
    const eur = convert(brl, "EUR", FX);
    // 100000 BRL / 5.2074 = 19203.44 USD; * 0.86386 = 16588.5 EUR
    expect(Math.round(eur?.amount ?? 0)).toBe(16_589);
  });

  it("is a no-op for the same currency", () => {
    const m = money(1000, "USD", "month");
    expect(convert(m, "USD", FX)).toBe(m);
  });

  it("returns null rather than treating an unknown currency as equal", () => {
    // This is the whole point: silently treating PHP as USD is the bug.
    expect(convert(money(1000, "XYZ", "year"), "USD", FX)).toBeNull();
    expect(convert(money(1000, "USD", "year"), "XYZ", FX)).toBeNull();
  });

  it("exposes how wrong the old behaviour was", () => {
    // PHP 150.000/year was being compared against a USD 90.000 floor as if
    // equal. It is really about USD 2.428 — far below floor.
    const php = money(150_000, "PHP", "year");
    const usd = convert(php, "USD", FX);
    expect(Math.round(usd?.amount ?? 0)).toBe(2_428);
  });
});

describe("formatMoney", () => {
  it("renders currency and period", () => {
    expect(formatMoney(money(180, "USD", "hour"))).toContain("/hour");
    expect(formatMoney(money(150_000, "USD", "year"))).not.toContain("/");
  });

  it("renders a project with its duration", () => {
    expect(formatMoney(money(30_000, "USD", "project", 2))).toContain("2 meses");
  });

  it("degrades gracefully for an unknown currency code", () => {
    expect(formatMoney(money(1000, "XYZ", "year"))).toContain("XYZ");
  });
});
