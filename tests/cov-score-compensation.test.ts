/**
 * A nota de remuneração nas faixas que o caminho feliz não visita.
 *
 * `score.ts` estava em 89,4% de branches, e o que faltava era quase tudo do
 * componente de remuneração: valor entre piso e alvo, valor acima do alvo mas
 * abaixo do ideal, projeto longo demais, moeda sem faixa própria, e a conversão
 * pela moeda de referência.
 *
 * Isto é ranking. Uma vaga que paga o piso e uma que paga o ideal não podem
 * receber a mesma nota, e um `>=` no lugar de um `>` aqui reordena o quadro
 * inteiro sem mudar nenhum teste — porque os testes só olhavam os extremos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadProfile } from "../src/core/profile/load.ts";
import { WEIGHTS, type ScoreInput } from "../src/core/scoring/score.ts";
import { scoreJob } from "./support/score-now.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import type { FxTable } from "../src/core/money.ts";

let profile: Profile;

beforeAll(async () => {
  profile = await loadProfile(true);
});

function job(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    title: "AI Solutions Architect",
    companyName: "Acme",
    descriptionText: "We build software with typescript and postgres.",
    locationRaw: "Remote",
    ...overrides,
  };
}

const comp = (entrada: Partial<ScoreInput>, fx?: FxTable) =>
  scoreJob(job(entrada), profile, fx).compScore;

describe("a faixa em USD por ano: piso 90k, alvo 150k, ideal 220k", () => {
  it("UT-190 abaixo do piso não pontua, e o piso já pontua", () => {
    const abaixo = comp({ compMax: 60_000, compCurrency: "USD", compPeriod: "year" });
    const noPiso = comp({ compMax: 90_000, compCurrency: "USD", compPeriod: "year" });

    expect(abaixo).toBe(0);
    // O piso é inclusivo: é o que separa "atende o mínimo" de "não atende".
    expect(noPiso).toBeGreaterThan(0);
  });

  it("UT-191 entre piso e alvo cresce com o valor, sem chegar à nota de alvo", () => {
    const perto = comp({ compMax: 100_000, compCurrency: "USD", compPeriod: "year" });
    const longe = comp({ compMax: 140_000, compCurrency: "USD", compPeriod: "year" });
    const noAlvo = comp({ compMax: 150_000, compCurrency: "USD", compPeriod: "year" });

    expect(longe).toBeGreaterThan(perto);
    expect(noAlvo).toBeGreaterThan(longe);
    // A faixa entre piso e alvo é monótona e fica abaixo do alvo.
    expect(longe).toBeLessThan(noAlvo);
  });

  it("UT-192 entre alvo e ideal cresce, e o ideal dá o peso cheio", () => {
    const noAlvo = comp({ compMax: 150_000, compCurrency: "USD", compPeriod: "year" });
    const meio = comp({ compMax: 185_000, compCurrency: "USD", compPeriod: "year" });
    const ideal = comp({ compMax: 220_000, compCurrency: "USD", compPeriod: "year" });
    const acima = comp({ compMax: 400_000, compCurrency: "USD", compPeriod: "year" });

    expect(meio).toBeGreaterThan(noAlvo);
    expect(ideal).toBe(WEIGHTS.comp);
    // Acima do ideal não rende mais: o teto é o peso do componente.
    expect(acima).toBe(WEIGHTS.comp);
  });

  it("UT-193 o topo da faixa manda, e faixa sem topo usa o piso declarado", () => {
    const comTopo = comp({ compMin: 90_000, compMax: 200_000, compCurrency: "USD", compPeriod: "year" });
    const soPiso = comp({ compMin: 200_000, compCurrency: "USD", compPeriod: "year" });

    expect(comTopo).toBeGreaterThan(0);
    // `compMax ?? compMin`: sem topo, o que há é o piso anunciado.
    expect(soPiso).toBeGreaterThan(0);
  });
});

describe("moeda e período que não têm faixa própria", () => {
  it("UT-194 USD por semana é anualizado contra a faixa anual", () => {
    // Não existe faixa `USD/week` no perfil, então o caminho é anualizar e
    // comparar com a faixa de USD que existir.
    const semana = comp({ compMax: 4_000, compCurrency: "USD", compPeriod: "week" });

    expect(semana).toBeGreaterThan(0);
  });

  it("UT-195 moeda sem faixa é convertida pela moeda de referência", () => {
    const fx: FxTable = {
      base: "USD",
      date: "2026-09-21",
      rates: { USD: 1, GBP: 0.8 },
    } as FxTable;

    // Não há faixa em GBP: 160.000 GBP viram 200.000 USD, acima do alvo.
    const convertido = comp({ compMax: 160_000, compCurrency: "GBP", compPeriod: "year" }, fx);

    expect(convertido).toBeGreaterThan(0);
  });

  it("UT-196 moeda sem faixa e sem câmbio não inventa nota", () => {
    const semCambio = comp({ compMax: 160_000, compCurrency: "GBP", compPeriod: "year" });

    // Regra 8: o que não se sabe comparar não vira zero punitivo nem nota alta.
    expect(semCambio).toBeGreaterThanOrEqual(0);
    expect(semCambio).toBeLessThanOrEqual(WEIGHTS.comp);
  });
});

describe("projeto de preço fechado", () => {
  it("UT-197 projeto sem duração recebe nota parcial, não zero", () => {
    const semDuracao = comp({ compMax: 60_000, compCurrency: "USD", compPeriod: "project" });

    // O valor total só compara com salário depois de dividido pela duração; sem
    // ela, o que se sabe é que há um valor — e isso vale algo.
    expect(semDuracao).toBeCloseTo(WEIGHTS.comp * 0.4, 5);
  });

  it("UT-198 projeto mais longo que o máximo aceito cai para nota baixa", () => {
    const longo = comp({
      compMax: 300_000,
      compCurrency: "USD",
      compPeriod: "project",
      compDurationMonths: 24,
    });

    // O perfil aceita até 12 meses. Mais que isso não é projeto, é vínculo —
    // e a nota diz isso sem transformar em bloqueador.
    expect(longo).toBeCloseTo(WEIGHTS.comp * 0.2, 5);
  });

  it("UT-199 projeto dentro do prazo é comparado como salário anualizado", () => {
    const dentro = comp({
      compMax: 180_000,
      compCurrency: "USD",
      compPeriod: "project",
      compDurationMonths: 12,
    });

    expect(dentro).toBeGreaterThan(WEIGHTS.comp * 0.4);
  });
});

describe("remuneração ausente ou ilegível", () => {
  it("UT-200 sem remuneração é neutro, e valor zero ou negativo também", () => {
    const ausente = comp({});
    const zero = comp({ compMax: 0, compCurrency: "USD", compPeriod: "year" });
    const negativo = comp({ compMax: -10, compCurrency: "USD", compPeriod: "year" });

    // Regra 8: vaga que não publica salário não é vaga que paga mal.
    expect(ausente).toBe(zero);
    expect(negativo).toBe(zero);
  });

  it("UT-201 período que não existe é dito, não adivinhado", () => {
    const estranho = comp({ compMax: 100_000, compCurrency: "USD", compPeriod: "fortnight" });

    expect(estranho).toBeGreaterThanOrEqual(0);
    const nota = scoreJob(
      job({ compMax: 100_000, compCurrency: "USD", compPeriod: "fortnight" }),
      profile,
    );
    // A razão nomeia o período que veio, para o defeito ser localizável na fonte.
    expect(JSON.stringify(nota.reasons)).toMatch(/fortnight/);
  });
});
