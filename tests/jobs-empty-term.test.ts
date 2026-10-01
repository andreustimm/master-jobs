import { describe, expect, it } from "vitest";
import { translator } from "../src/core/i18n/index.ts";

// #402: a mensagem de zero resultados tem de distinguir "0 vagas com este
// filtro" (BUG-20260929-search-term-false-negative-laravel: "laravel" existe,
// o filtro de modalidade é que zera) de "termo ausente no acervo" (nenhum
// filtro escolhido, o termo mesmo não aparece em nada).
describe("vazio da busca distingue filtro de ausência no acervo", () => {
  it.each([
    ["pt-BR", "filtros atuais"],
    ["en", "current filters"],
  ] as const)("com filtro além do termo, %s não afirma ausência no acervo", (locale, context) => {
    const message = translator(locale).t("jobs.emptyTermFiltered", { term: "laravel" });
    expect(message).toContain("laravel");
    expect(message).toContain(context);
    expect(message).not.toMatch(/acervo (menciona|tem)|corpus (mentions|has)/i);
  });

  it.each([
    ["pt-BR", "acervo"],
    ["en", "corpus"],
  ] as const)("sem filtro além do termo, %s afirma a ausência no acervo", (locale, context) => {
    const message = translator(locale).t("jobs.emptyTermAbsent", { term: "zzqxunmatched" });
    expect(message).toContain("zzqxunmatched");
    expect(message).toContain(context);
  });
});
