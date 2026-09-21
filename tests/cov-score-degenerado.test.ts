/**
 * O scorer contra entradas degeneradas — perfil sem palavra-chave, duração
 * negativa, câmbio sem a moeda de referência, e benefício que não interessa.
 *
 * Nenhuma dessas é hipótese de laboratório:
 *
 * - **Perfil sem palavra-chave positiva** é o estado de uma conta nova cujo alvo
 *   ainda não foi editado. A nota de palavra-chave divide pelo peso total
 *   possível, e esse total é zero — divisão que em JavaScript devolve `NaN` sem
 *   erro, e `NaN` propaga para o `fit`, tirando a vaga de qualquer ordenação.
 * - **Duração negativa** vem de fonte: uma API que devolve `-1` para "não sei".
 *   O valor passa pela checagem de ausência (`!(-1)` é falso) e chega à
 *   anualização, onde dividir por mês negativo daria salário negativo.
 * - **Câmbio sem a moeda de referência** acontece a cada provedor novo e a cada
 *   tabela parcialmente carregada.
 * - **Benefício detectado que não está na lista de desejados** é a maioria dos
 *   anúncios, e tem razão própria — dizer "oferece" sobre benefício que ninguém
 *   pediu é ruído no dossiê.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadProfile } from "../src/core/profile/load.ts";
import { WEIGHTS, scoreJob, type ScoreInput } from "../src/core/scoring/score.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import type { FxTable } from "../src/core/money.ts";

let base: Profile;

beforeAll(async () => {
  base = await loadProfile(true);
});

function vaga(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    title: "AI Solutions Architect",
    companyName: "Acme",
    descriptionText: "We build software with typescript and postgres.",
    locationRaw: "Remote",
    ...overrides,
  };
}

describe("perfil sem nenhuma palavra-chave positiva", () => {
  function semPalavras(): Profile {
    const clone = structuredClone(base);
    clone.keywords.critical = [];
    clone.keywords.strong = [];
    clone.keywords.stack = [];
    return clone;
  }

  it("UT-390 a nota de palavra-chave é zero, e não `NaN`", () => {
    const perfil = semPalavras();

    const resultado = scoreJob(vaga(), perfil);

    expect(Number.isFinite(resultado.keywordScore)).toBe(true);
    expect(resultado.keywordScore).toBe(0);
    // E o `fit` inteiro continua sendo número: um `NaN` aqui sumiria com a vaga
    // de toda ordenação, sem erro em lugar nenhum.
    expect(Number.isFinite(resultado.fit)).toBe(true);
  });

  it("UT-391 palavra-chave negativa ainda penaliza, mesmo sem positiva alguma", () => {
    // O peso negativo é subtraído do resultado saturado. Com base zero, a
    // penalidade não pode empurrar a nota abaixo de zero.
    const perfil = semPalavras();
    expect(perfil.keywords.negative.length).toBeGreaterThan(0);
    const termoRuim = perfil.keywords.negative[0]!.term;

    const resultado = scoreJob(
      vaga({ descriptionText: `We maintain a large ${termoRuim} installation.` }),
      perfil,
    );

    expect(resultado.keywordScore).toBe(0);
    expect(Number.isFinite(resultado.fit)).toBe(true);
    expect(resultado.fit).toBeGreaterThanOrEqual(0);
  });
});

describe("duração de projeto que não faz sentido", () => {
  it("UT-392 duração negativa não vira salário anualizado negativo", () => {
    // `-1` passa pela checagem de ausência, porque `!(-1)` é falso. Anualizar
    // dividindo por mês negativo daria valor negativo, e a comparação com a faixa
    // devolveria a nota de "abaixo do piso" — que é aceitável — mas o caminho tem
    // de terminar num número, e não num `-Infinity`.
    const resultado = scoreJob(
      vaga({
        compMax: 120_000,
        compCurrency: "USD",
        compPeriod: "project",
        compDurationMonths: -1,
      }),
      base,
    );

    expect(Number.isFinite(resultado.compScore)).toBe(true);
    expect(resultado.compScore).toBeGreaterThanOrEqual(0);
    expect(resultado.compScore).toBeLessThanOrEqual(WEIGHTS.comp);
    expect(Number.isFinite(resultado.fit)).toBe(true);
  });

  it("UT-393 duração zero é tratada como ausência de duração", () => {
    // `!0` é verdadeiro, então zero cai no ramo de "projeto sem duração", que
    // pontua parcial. O par com o caso acima é o que prova que a distinção entre
    // "não informado" e "informado errado" é intencional.
    const resultado = scoreJob(
      vaga({
        compMax: 120_000,
        compCurrency: "USD",
        compPeriod: "project",
        compDurationMonths: 0,
      }),
      base,
    );

    expect(resultado.compScore).toBeCloseTo(WEIGHTS.comp * 0.4, 5);
  });
});

describe("câmbio que não cobre a moeda de referência", () => {
  it("UT-394 tabela sem a moeda da vaga cai no neutro, não em zero", () => {
    // Regra 8: o que não se sabe comparar pontua neutro. Uma tabela carregada
    // parcialmente é o estado normal de um provedor novo.
    const parcial = { base: "USD", date: "2026-09-21", rates: { USD: 1 } } as FxTable;

    const resultado = scoreJob(
      vaga({ compMax: 150_000, compCurrency: "JPY", compPeriod: "year" }),
      base,
      parcial,
    );

    expect(Number.isFinite(resultado.compScore)).toBe(true);
    expect(resultado.compScore).toBeCloseTo(WEIGHTS.comp * 0.5, 5);
  });

  it("UT-395 tabela que cobre a moeda converte e compara de verdade", () => {
    // O outro lado: o mesmo valor com a cotação presente sai do neutro. É o que
    // prova que o caso acima mediu a ausência, e não uma conversão quebrada.
    const completa = {
      base: "USD",
      date: "2026-09-21",
      rates: { USD: 1, JPY: 150 },
    } as FxTable;

    const convertido = scoreJob(
      vaga({ compMax: 30_000_000, compCurrency: "JPY", compPeriod: "year" }),
      base,
      completa,
    );

    // 30.000.000 JPY ÷ 150 = 200.000 USD: acima do alvo de 150.000.
    expect(convertido.compScore).toBeGreaterThan(WEIGHTS.comp * 0.5);
  });
});

describe("benefícios detectados que ninguém pediu", () => {
  it("UT-396 a razão é `unwanted`, distinta de `none` e de `offers`", () => {
    // Três estados diferentes com três frases diferentes, e o do meio não tinha
    // caso. Dizer "oferece" sobre benefício que ninguém pediu é ruído no dossiê;
    // dizer "nenhum" sobre um anúncio que lista benefícios é falso.
    const perfil = structuredClone(base);
    perfil.compensation.benefits.preferred = ["equity"];
    perfil.compensation.benefits.nice_to_have = [];

    // O texto precisa passar de 400 caracteres: abaixo disso `scoreBenefits` se
    // declara incapaz de avaliar, e as duas descrições receberiam a MESMA razão
    // de "não avaliável" — o caso passaria sem medir nada.
    const CORPO =
      'We are a fully distributed engineering team building a data platform used by enterprise customers across three continents. The stack is TypeScript and PostgreSQL, deployed continuously, with a strong culture of written design documents and asynchronous review. You will own services end to end, from schema design through production operation, and pair regularly with the other senior engineers on the team. We interview in three stages and make decisions within a week. ' +
      "";

    const comIndesejado = scoreJob(
      vaga({
        descriptionText:
          CORPO +
          "Benefits include unlimited paid time off and health insurance for the " +
          "whole family.",
      }),
      perfil,
    );

    const comDesejado = scoreJob(
      vaga({
        descriptionText:
          CORPO +
          "Benefits include equity in the company from your first day.",
      }),
      perfil,
    );

    const razoes = (r: typeof comIndesejado) => JSON.stringify(r.reasons);

    // As duas descrições são legíveis e detectam benefício; o que muda é se algum
    // deles estava na lista de desejados.
    expect(razoes(comIndesejado)).toMatch(/benefitsUnwanted|unwanted/i);
    expect(razoes(comDesejado)).toMatch(/benefitsOffers|offers/i);
    expect(razoes(comIndesejado)).not.toBe(razoes(comDesejado));
    // E nenhuma das duas é bloqueador: benefício ausente nunca bloqueia (regra 8).
    expect(comIndesejado.blockers).toEqual(comDesejado.blockers);
  });
});
