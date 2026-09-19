import { describe, expect, it } from "vitest";
import { defaultPay, href, readFilters } from "../app/filter-state.ts";
import { targetOf } from "../src/contexts/matching/index.ts";
import { loadProfile } from "../src/core/profile/load.ts";

function parse(link: string): Record<string, string> {
  return Object.fromEntries(new URL(link, "http://x").searchParams.entries());
}

describe("Jobs screen filters in the URL", () => {
  it("UT-064 reads track, term, saved term, pay and sort", () => {
    const state = readFilters({
      track: "12",
      q: "laravel",
      by: "5",
      pay: "6000",
      cur: "USD",
      per: "month",
      disclosed: "1",
      sort: "comp",
    });

    expect(state).toMatchObject({
      track: 12,
      term: { term: "laravel", key: "laravel" },
      by: 5,
      sort: "comp",
      pay: { min: 6000, currency: "USD", period: "month", disclosedOnly: true },
      notices: [],
    });
  });

  it("UT-065 an invalid term is dropped with the rule's notice", () => {
    const state = readFilters({ q: "<b>" });
    expect(state.term).toBeUndefined();
    expect(state.notices).toEqual(["term_invalid_char"]);
  });

  it("UT-066 an invalid minimum pay is dropped with a notice", () => {
    for (const pay of ["0", "abc", "10000001"]) {
      const state = readFilters({ pay });
      expect(state.pay?.min, pay).toBeUndefined();
      expect(state.notices, pay).toEqual(["pay_invalid"]);
    }
  });

  it("UT-067 the URL round-trips every new parameter", () => {
    const state = readFilters({
      track: "all",
      q: "Tech Lead",
      by: "7",
      pay: "12000",
      cur: "BRL",
      per: "year",
      disclosed: "1",
      sort: "recent",
    });

    const again = readFilters(parse(href("/jobs", state, {})));

    expect(again).toEqual(state);
    expect(readFilters(parse(href("/jobs", readFilters({ track: "3" }), {}))).track).toBe(3);
  });

  it("UT-068 an empty or blank term is no filter and no notice", () => {
    for (const q of ["", "   "]) {
      const state = readFilters({ q });
      expect(state.term).toBeUndefined();
      expect(state.notices).toEqual([]);
    }
  });

  it("UT-069 pay defaults to the primary track's first range, else USD per month", async () => {
    const target = targetOf(await loadProfile(true));
    target.compensation.ranges = [
      { currency: "BRL", period: "month", floor: 30_000, target: 40_000 },
      { currency: "USD", period: "year", floor: 90_000, target: 150_000 },
    ];
    expect(defaultPay(target)).toEqual({ currency: "BRL", period: "month" });
    expect(defaultPay(null)).toEqual({ currency: "USD", period: "month" });
  });
});
