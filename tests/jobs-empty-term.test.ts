import { describe, expect, it } from "vitest";
import { translator } from "../src/core/i18n/index.ts";

describe("vazio da busca descreve o recorte consultado", () => {
  it.each([
    ["pt-BR", "filtros atuais", "Nenhuma vaga do acervo menciona"],
    ["en", "current filters", "No job in the corpus mentions"],
  ] as const)("não afirma ausência no acervo em %s", (locale, context, falseClaim) => {
    const message = translator(locale).t("jobs.emptyTerm", { term: "laravel" });
    expect(message).toContain("laravel");
    expect(message).toContain(context);
    expect(message).not.toContain(falseClaim);
  });
});
