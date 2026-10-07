// Suite: filtros do Funil na URL (#478)
// Invariant: o estado inteiro vive na URL e volta igual; a consulta é lida
//   pela mesma função de Vagas; só `semantic=1` amplia a busca.
// Boundary IN: `app/pipeline/filter-state.ts` com um dicionário em memória.
// Boundary OUT: a consulta SQL (tests/pipeline-filters.test.ts) e a tela (E2E).
import { describe, expect, it } from "vitest";
import {
  broadenHintKey,
  clearPipelineFiltersHref,
  hasPipelineFilters,
  pipelineHref,
  readPipelineFilters,
  toPipelineFilters,
  toPipelineParams,
} from "../app/pipeline/filter-state.ts";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import { buildSynonymDictionary, EMPTY_SYNONYMS } from "../src/core/synonyms.ts";
import { resetSynonymsCache, searchSynonyms } from "../src/core/synonyms-load.ts";

const dictionary = buildSynonymDictionary({ groups: [["engenheiro", "engineer"]] });

function pairs(link: string): Array<[string, string]> {
  return [...new URL(link, "http://x").searchParams];
}

describe("readPipelineFilters", () => {
  it("UT-478-01 lê estágio, consulta, empresas e canais repetidos e a faixa de score, e volta igual", () => {
    const state = readPipelineFilters(
      {
        stage: "applied",
        q: "  engenheiro   backend ",
        semantic: "1",
        company: ["Acme", "Globex", "Acme", " "],
        channel: "referral",
        fit: "60",
        fitMax: "90",
      },
      dictionary,
    );
    expect(state.stage).toBe("applied");
    expect(state.invalidStage).toBe(false);
    expect(state.query?.raw).toBe("engenheiro backend");
    expect(state.companies).toEqual(["Acme", "Globex"]);
    expect(state.channels).toEqual(["referral"]);
    expect([state.fit, state.fitMax]).toEqual([60, 90]);
    expect(state.notices).toEqual([]);
    expect(toPipelineParams(state)).toEqual([
      ["stage", "applied"],
      ["q", "engenheiro backend"],
      ["semantic", "1"],
      ["company", "Acme"],
      ["company", "Globex"],
      ["channel", "referral"],
      ["fit", "60"],
      ["fitMax", "90"],
    ]);
    const again = readPipelineFilters(Object.fromEntries(
      [...new Set(toPipelineParams(state).map(([key]) => key))].map((key) => [
        key,
        toPipelineParams(state).filter(([k]) => k === key).map(([, value]) => value),
      ]),
    ), dictionary);
    expect(toPipelineParams(again)).toEqual(toPipelineParams(state));
  });

  it("UT-478-02 consulta inválida vira o aviso de Vagas, faixa invertida é trocada e estágio desconhecido não filtra", () => {
    const state = readPipelineFilters({ q: "a", fit: "90", fitMax: "20", stage: "nope" }, dictionary);
    expect(state.query).toBeUndefined();
    expect(state.notices).toEqual(["term_too_short", "range_swapped"]);
    expect([state.fit, state.fitMax]).toEqual([20, 90]);
    expect(state.stage).toBeNull();
    expect(state.invalidStage).toBe(true);
  });

  it("score vazio ou ilegível não filtra; fora da escala é preso", () => {
    expect(readPipelineFilters({ fit: "", fitMax: "abc" }, dictionary)).toMatchObject({ fit: undefined, fitMax: undefined });
    expect(readPipelineFilters({ fit: "-5", fitMax: "250" }, dictionary)).toMatchObject({ fit: 0, fitMax: 100 });
  });

  it("score ilegível avisa uma vez; vazio e fora da escala não avisam (#494)", () => {
    expect(readPipelineFilters({ fit: "abc" }, dictionary).notices).toEqual(["fit_invalid"]);
    expect(readPipelineFilters({ fit: "abc", fitMax: "x" }, dictionary).notices).toEqual(["fit_invalid"]);
    expect(readPipelineFilters({ fit: "", fitMax: "250" }, dictionary).notices).toEqual([]);
  });

  it("UT-478-03 sem semantic a busca é literal; com ele, expande pelo dicionário e liga a grafia parecida", () => {
    const literal = toPipelineFilters(readPipelineFilters({ q: "engenheiro" }, dictionary));
    expect(literal.synonyms).toBeUndefined();
    expect(literal.proximity).toBe(false);

    const broad = toPipelineFilters(readPipelineFilters({ q: "engenheiro", semantic: "1" }, dictionary));
    expect(broad.synonyms?.engenheiro?.map((term) => term.term)).toEqual(["engineer"]);
    expect(broad.proximity).toBe(true);
    expect(broad.query?.terms.map((term) => term.term)).toEqual(["engenheiro"]);

    // Sem consulta, ampliar não tem o que ampliar.
    expect(toPipelineFilters(readPipelineFilters({ semantic: "1" }, dictionary)).proximity).toBe(false);
  });

  it("a frase entre aspas nunca expande", () => {
    const filters = toPipelineFilters(readPipelineFilters({ q: '"engenheiro"', semantic: "1" }, dictionary));
    expect(filters.synonyms).toBeUndefined();
    expect(filters.query?.phrases.map((term) => term.term)).toEqual(["engenheiro"]);
  });
});

describe("links do funil", () => {
  const state = readPipelineFilters(
    { stage: "applied", q: "backend", company: ["Acme", "Globex"], channel: ["direct", "referral"], fit: "50" },
    dictionary,
  );

  it("UT-478-04 trocar um parâmetro mantém o resto, repetições inclusive, e volta à primeira página", () => {
    expect(pairs(pipelineHref(state, { stage: "screening" }))).toEqual([
      ["stage", "screening"],
      ["q", "backend"],
      ["company", "Acme"],
      ["company", "Globex"],
      ["channel", "direct"],
      ["channel", "referral"],
      ["fit", "50"],
    ]);
    expect(pairs(pipelineHref(state, { company: undefined })).some(([key]) => key === "company")).toBe(false);
    expect(pairs(pipelineHref(state, { page: "3" })).at(-1)).toEqual(["page", "3"]);
    expect(pairs(pipelineHref(state)).some(([key]) => key === "page")).toBe(false);
  });

  it("limpar os filtros mantém só o estágio", () => {
    expect(clearPipelineFiltersHref(state)).toBe("/pipeline?stage=applied");
    expect(hasPipelineFilters(state)).toBe(true);
    expect(hasPipelineFilters(readPipelineFilters({ stage: "applied", semantic: "1" }, dictionary))).toBe(false);
    expect(pipelineHref(readPipelineFilters({}, dictionary))).toBe("/pipeline");
  });
});

describe("broadenHintKey — a dica só promete o que a busca faz (#490)", () => {
  it("com SEARCH_SYNONYMS_ENABLED desligada (o padrão), não promete sinônimo", () => {
    resetSynonymsCache();
    expect(broadenHintKey(searchSynonyms({}))).toBe("pipeline.broadenHintSpelling");
    expect(broadenHintKey(EMPTY_SYNONYMS)).toBe("pipeline.broadenHintSpelling");
    for (const locale of [ptBR, en]) {
      expect(locale.pipeline.broadenHintSpelling).not.toMatch(/sinônimo|synonym/i);
    }
  });

  it("com a lista ligada e carregada, promete sinônimo", () => {
    resetSynonymsCache();
    expect(broadenHintKey(searchSynonyms({ SEARCH_SYNONYMS_ENABLED: "1" }))).toBe("pipeline.broadenHint");
    expect(broadenHintKey(dictionary)).toBe("pipeline.broadenHint");
    resetSynonymsCache();
  });
});
