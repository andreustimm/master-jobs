import { describe, expect, it } from "vitest";
import { defaultPay, href, readFilters, toBoardFilters } from "../app/filter-state.ts";
import { targetOf } from "../src/contexts/matching/index.ts";
import { loadProfile } from "../src/core/profile/load.ts";

/**
 * The link back as parameters, keeping every repetition.
 *
 * `Object.fromEntries` would keep only the last `source`, which is exactly the
 * bug a round-trip test exists to catch.
 */
function parse(link: string): Record<string, string | string[]> {
  const params = new URL(link, "http://x").searchParams;
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length > 1 ? values : values[0]!];
    }),
  );
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

  it("UT-066 an invalid pay bound is dropped with a notice, on either side", () => {
    for (const bad of ["0", "abc", "10000001"]) {
      const asFloor = readFilters({ pay: bad });
      expect(asFloor.pay?.min, bad).toBeUndefined();
      expect(asFloor.notices, bad).toEqual(["pay_invalid"]);

      const asCeiling = readFilters({ payMax: bad });
      expect(asCeiling.pay?.max, bad).toBeUndefined();
      expect(asCeiling.notices, bad).toEqual(["pay_invalid"]);
    }
    // Os dois lados inválidos são uma causa só, e um aviso só.
    expect(readFilters({ pay: "0", payMax: "abc" }).notices).toEqual(["pay_invalid"]);
  });

  it("UT-077 reads a pay range, and an inverted one is swapped with a notice", () => {
    expect(readFilters({ pay: "6000", payMax: "12000" }).pay).toMatchObject({
      min: 6000,
      max: 12000,
    });

    // O slider não produz isso; URL escrita à mão e campo digitado produzem.
    const inverted = readFilters({ pay: "12000", payMax: "6000" });
    expect(inverted.pay).toMatchObject({ min: 6000, max: 12000 });
    expect(inverted.notices).toEqual(["range_swapped"]);

    // Um lado só não tem o que trocar.
    expect(readFilters({ payMax: "6000" }).pay).toMatchObject({ min: undefined, max: 6000 });
    expect(readFilters({ payMax: "6000" }).notices).toEqual([]);
  });

  it("UT-078 sources are a list, and one value is a list of one", () => {
    expect(readFilters({ source: ["lever", "ashby"] }).sources).toEqual(["lever", "ashby"]);
    // O formato antigo, que ainda circula em link salvo.
    expect(readFilters({ source: "lever" }).sources).toEqual(["lever"]);
    expect(readFilters({}).sources).toEqual([]);
    // Repetido e vazio somem: o combo envia o que estiver marcado, e nada mais.
    expect(readFilters({ source: ["lever", "lever", "  ", ""] }).sources).toEqual(["lever"]);
  });

  it("UT-080 the score is a range, clamped, and an absent cut keeps the default", () => {
    expect(readFilters({}).fit).toBe(45);
    // Campo em branco é escolha: "toda nota".
    expect(readFilters({ fit: "" }).fit).toBe(0);
    expect(readFilters({ fit: "70", fitMax: "85" })).toMatchObject({ fit: 70, fitMax: 85 });

    // Nota acima do teto do scorer não existe; abaixo de zero, também não.
    expect(readFilters({ fit: "250", fitMax: "900" })).toMatchObject({ fit: 100, fitMax: 100 });
    expect(readFilters({ fit: "-5" }).fit).toBe(0);

    // `fit=abc` chegava na consulta como NaN e o Postgres recusava a página.
    expect(readFilters({ fit: "abc" }).fit).toBe(45);

    const inverted = readFilters({ fit: "80", fitMax: "60" });
    expect(inverted).toMatchObject({ fit: 60, fitMax: 80 });
    expect(inverted.notices).toEqual(["range_swapped"]);

    expect(toBoardFilters(readFilters({ fit: "70", fitMax: "85" }))).toMatchObject({
      minFit: 70,
      maxFit: 85,
    });
  });

  it("UT-082 the employer filter asks about the employer alone", () => {
    expect(readFilters({ company: "  Shopify  " }).company).toBe("Shopify");
    expect(readFilters({ company: "   " }).company).toBeUndefined();
    expect(readFilters({}).company).toBeUndefined();
    // Cortado, não recusado: colar um texto grande é engano de dedo.
    expect(readFilters({ company: "x".repeat(200) }).company).toHaveLength(80);
    expect(toBoardFilters(readFilters({ company: "Acme" })).company).toBe("Acme");
  });

  it("UT-081 hiding what was already sent is a filter of its own", () => {
    expect(readFilters({}).notApplied).toBe(false);
    expect(readFilters({ notApplied: "1" }).notApplied).toBe(true);
    expect(toBoardFilters(readFilters({ notApplied: "1" })).hideApplied).toBe(true);
    expect(toBoardFilters(readFilters({})).hideApplied).toBe(false);
  });

  it("UT-079 the board query asks for every chosen source, and none means all", () => {
    expect(toBoardFilters(readFilters({ source: ["lever", "ashby"] })).sourceKinds).toEqual([
      "lever",
      "ashby",
    ]);
    expect(toBoardFilters(readFilters({})).sourceKinds).toEqual([]);
  });

  it("UT-067 the URL round-trips every new parameter", () => {
    const state = readFilters({
      track: "all",
      q: "Tech Lead",
      by: "7",
      company: "Acme",
      fitMax: "90",
      notApplied: "1",
      pay: "12000",
      payMax: "30000",
      cur: "BRL",
      per: "year",
      disclosed: "1",
      sort: "recent",
      source: ["lever", "ashby"],
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
