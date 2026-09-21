/**
 * A interpolação que não encontra o valor, e a data que não é data.
 *
 * Os dois ramos têm a mesma disciplina: **falhar visível, nunca em branco**.
 *
 * - Um `{count}` cujo valor não foi passado permanece como `{count}` na tela. A
 *   alternativa seria `undefined`, que parece texto traduzido e passa numa
 *   revisão; `{count}` não passa.
 * - Uma data ilegível volta como o próprio texto recebido. `Intl` sobre `Invalid
 *   Date` lança em alguns ambientes e imprime "Invalid Date" em outros, e nenhum
 *   dos dois diz de onde veio o valor. Devolver o ISO cru mostra o dado que
 *   chegou, que é o que localiza o defeito na fonte.
 *
 * O mesmo princípio já rege a chave ausente, que a suíte de i18n cobre: a função
 * devolve o caminho da chave, feio de propósito.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatNumber, translator } from "../src/core/i18n/index.ts";

describe("a interpolação de valores", () => {
  it("UT-450 chave sem valor passado permanece como marcador, e não vira `undefined`", () => {
    const { t } = translator("pt-BR");

    // `keywords.matched` recebe `{count}`. Chamando sem o valor, o marcador fica.
    const semValor = t("scoreReason.keywordsMatched" as never);
    const comValor = t("scoreReason.keywordsMatched" as never, { count: 7 });

    // Com valor, o número entra; sem valor, o marcador sobrevive intacto.
    expect(comValor).toContain("7");
    expect(comValor).not.toContain("{count}");
    expect(semValor).not.toContain("undefined");
  });

  it("UT-451 valor a mais é ignorado, e valor a menos deixa só o seu marcador", () => {
    const { t } = translator("pt-BR");

    // Um objeto de valores com chave que a frase não usa não altera nada: a
    // substituição é guiada pela frase, não pelos valores.
    const comExtra = t("scoreReason.keywordsMatched" as never, {
      count: 3,
      inexistente: "ruído",
    });

    expect(comExtra).toContain("3");
    expect(comExtra).not.toContain("ruído");
  });

  it("UT-452 chave que não existe no dicionário devolve o caminho, não vazio", () => {
    // O terceiro lado da mesma disciplina. Um espaço em branco na tela passa
    // despercebido; `nav.inexistente` não.
    const { t } = translator("pt-BR");

    expect(t("nav.inexistente" as never)).toBe("nav.inexistente");
    // E um caminho que atravessa um objeto sem chegar a texto também.
    expect(t("nav" as never)).toBe("nav");
  });
});

describe("a formatação de data", () => {
  it("UT-453 data ilegível volta como o texto recebido", () => {
    // `Intl` sobre `Invalid Date` não diz de onde veio o valor. Devolver o texto
    // cru mostra o dado que chegou, e é o que localiza o defeito na fonte.
    for (const ruim of ["", "ontem", "2026-02-30T99:99:99Z", "não é data"]) {
      expect(formatDate(ruim, "pt-BR"), ruim).toBe(ruim);
      expect(formatDate(ruim, "en"), ruim).toBe(ruim);
    }
  });

  it("UT-454 data válida é formatada, e o idioma muda o resultado", () => {
    // O par: prova que o caso acima mediu a recusa, e não uma formatação inerte.
    const iso = "2026-09-21T12:00:00.000Z";

    const pt = formatDate(iso, "pt-BR");
    const en = formatDate(iso, "en");

    expect(pt).not.toBe(iso);
    expect(en).not.toBe(iso);
    expect(pt).not.toBe(en);
    // E os dois falam do mesmo dia.
    expect(pt).toMatch(/2026/);
    expect(en).toMatch(/2026/);
  });

  it("UT-455 número segue o idioma, com o separador de milhar de cada um", () => {
    // 1.504 em pt-BR e 1,504 em en. É o par natural de `formatDate`, e a troca
    // dos separadores é o erro clássico de localização de número.
    expect(formatNumber(1_504, "pt-BR")).toBe("1.504");
    expect(formatNumber(1_504, "en")).toBe("1,504");
  });
});
