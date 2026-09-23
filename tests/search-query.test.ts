/**
 * Domínio da busca (#223, tarefa 05): análise da consulta, ordem por
 * relevância e explicação. Puro — nenhum caso abre banco.
 */
import { describe, expect, it } from "vitest";
import { readFilters, toBoardFilters, toParams } from "../app/filter-state.ts";
import { compareByRelevance, explainMatch, parseQuery, relevanceRank, type RankedRow } from "../src/core/search.ts";
import { matchesTerm, phraseRegexSql, termPrefilterLike } from "../src/core/term.ts";

describe("UT-013 análise da consulta", () => {
  it("sem aspas, o texto é UM termo, como antes da tarefa", () => {
    expect(parseQuery("tech lead")).toEqual({ terms: ["tech lead"], phrases: [] });
  });

  it("separa frases entre aspas dos termos em volta", () => {
    expect(parseQuery('"tech lead" remote')).toEqual({ terms: ["remote"], phrases: ["tech lead"] });
    expect(parseQuery('python "staff  engineer" aws')).toEqual({ terms: ["python", "aws"], phrases: ["staff engineer"] });
    expect(parseQuery('"a" "b c"')).toEqual({ terms: [], phrases: ["a", "b c"] });
  });

  it("aspas desbalanceadas viram texto simples, sem as aspas", () => {
    expect(parseQuery('"tech lead')).toEqual({ terms: ["tech lead"], phrases: [] });
    expect(parseQuery('a "b" c"')).toEqual({ terms: ["a b c"], phrases: [] });
  });

  it("mantém C# e C++ literais", () => {
    expect(parseQuery('C# "C++ developer"')).toEqual({ terms: ["C#"], phrases: ["C++ developer"] });
  });

  it("espaço em branco e aspas vazias devolvem vazio", () => {
    expect(parseQuery("   ")).toEqual({ terms: [], phrases: [] });
    expect(parseQuery('""')).toEqual({ terms: [], phrases: [] });
    expect(parseQuery('"')).toEqual({ terms: [], phrases: [] });
  });

  it("frase é a sequência exata de palavras; termo junta separador", () => {
    const phrase = new RegExp(phraseRegexSql("tech lead"), "i");
    expect(phrase.test("Senior Tech Lead, Remote")).toBe(true);
    expect(phrase.test("Tech  lead")).toBe(true);
    expect(phrase.test("Techlead")).toBe(false);
    expect(phrase.test("tech-lead")).toBe(false);
    expect(phrase.test("lead tech")).toBe(false);
    expect(new RegExp(phraseRegexSql("c++ developer"), "i").test("Senior C++ Developer")).toBe(true);
    expect(matchesTerm("tech lead", "Techlead")).toBe(true);
  });

  it("o pré-filtro trigrama continua necessário para a frase", () => {
    // O trecho casado sem espaço e hífen é a chave: o `ilike` nunca descarta
    // uma vaga que a frase casaria.
    const text = "We need a Staff  Engineer now";
    expect(new RegExp(phraseRegexSql("staff engineer"), "i").test(text)).toBe(true);
    const like = termPrefilterLike("staff engineer")!.slice(1, -1);
    expect(text.replaceAll(" ", "").replaceAll("-", "").toLowerCase()).toContain(like);
  });

  it("a URL leva a consulta crua; frase inválida vira aviso", () => {
    const state = readFilters({ q: ' "tech  lead"  remote ' });
    expect(state.query?.phrases.map((p) => p.term)).toEqual(["tech lead"]);
    expect(state.query?.terms.map((p) => p.term)).toEqual(["remote"]);
    expect(state.term).toBeUndefined();
    expect(toParams(state)).toContainEqual(["q", '"tech lead" remote']);
    expect(readFilters({ q: "java" }).term?.term).toBe("java");
    expect(readFilters({ q: '"x"' }).notices).toEqual(["term_too_short"]);
  });
});

const row = (over: Partial<RankedRow> & { id: number }): RankedRow => ({
  fields: ["description"],
  fit: 50,
  postedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("UT-014 ordenação por relevância", () => {
  it("cargo antes de empresa antes de localização e descrição, que empatam", () => {
    expect(relevanceRank(["description", "title"])).toBe(0);
    expect(relevanceRank(["company"])).toBe(1);
    expect(relevanceRank(["location"])).toBe(relevanceRank(["description"]));
    const rows = [
      row({ id: 1, fields: ["description"], fit: 99 }),
      row({ id: 2, fields: ["company"], fit: 10 }),
      row({ id: 3, fields: ["title"], fit: 5 }),
      row({ id: 4, fields: ["location"], fit: 60 }),
    ];
    expect([...rows].sort(compareByRelevance).map((r) => r.id)).toEqual([3, 2, 1, 4]);
  });

  it("desempata por fit, recência e id, de forma determinística", () => {
    const rows = [
      row({ id: 5, fit: 40 }),
      row({ id: 4, fit: null }),
      row({ id: 3, fit: 40, postedAt: "2026-09-10T00:00:00.000Z" }),
      row({ id: 2, fit: 40, postedAt: null }),
      row({ id: 1, fit: 40 }),
    ];
    const once = [...rows].sort(compareByRelevance).map((r) => r.id);
    expect(once).toEqual([3, 1, 5, 2, 4]);
    expect([...rows].reverse().sort(compareByRelevance).map((r) => r.id)).toEqual(once);
  });

  it("relevância sem consulta volta à ordem por fit", () => {
    expect(toBoardFilters(readFilters({ sort: "relevance" })).sort).toBe("fit");
    expect(toBoardFilters(readFilters({ sort: "relevance", q: "java" })).sort).toBe("relevance");
    expect(toParams(readFilters({ sort: "relevance" }))).toContainEqual(["sort", "relevance"]);
  });
});

describe("UT-015 explicação honesta", () => {
  it("lista só os campos que casaram, uma vez, na ordem de força", () => {
    expect(explainMatch({ fields: ["description", "title", "title"], proximity: false })).toEqual([
      { kind: "field", field: "title" },
      { kind: "field", field: "description" },
    ]);
    expect(explainMatch({ fields: ["location"], proximity: false })).toEqual([{ kind: "field", field: "location" }]);
  });

  it("proximidade só aparece quando contribuiu", () => {
    expect(explainMatch({ fields: [], proximity: true })).toEqual([{ kind: "proximity" }]);
    expect(explainMatch({ fields: [], proximity: false })).toEqual([]);
  });

  it("nunca menciona semântica: não existe esse sinal", () => {
    const every = explainMatch({ fields: ["title", "company", "location", "description"], proximity: true });
    expect(every.map((signal) => signal.kind)).not.toContain("semantic");
    expect(JSON.stringify(every)).not.toMatch(/seman/i);
  });
});
