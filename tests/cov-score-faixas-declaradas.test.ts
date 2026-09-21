/**
 * Faixas de remuneração escritas de formas que o `profile.yaml` atual não usa.
 *
 * `profile.yaml` é editado à mão, e o Zod aceita mais formas do que o arquivo de
 * hoje contém: faixa **sem `ideal`**, faixa com `ideal` igual ao alvo, faixa com
 * piso igual ao alvo, e projeto **recusado**. Cada uma dessas cai num ramo
 * diferente de `gradeAgainst`, e dois deles dividem por um intervalo que nessas
 * formas vale zero.
 *
 * Divisão por zero em JavaScript não estoura: devolve `Infinity` ou `NaN`. Um
 * `NaN` aqui propaga silenciosamente para o `fit`, e a vaga desaparece de
 * qualquer ordenação por nota sem nenhum erro em lugar nenhum — o defeito mais
 * difícil de notar que este arquivo pode ter.
 *
 * A nota também precisa continuar monótona: mais dinheiro nunca pontua menos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadProfile } from "../src/core/profile/load.ts";
import { WEIGHTS, scoreJob, type ScoreInput } from "../src/core/scoring/score.ts";
import type { Profile } from "../src/core/profile/schema.ts";

let base: Profile;

beforeAll(async () => {
  base = await loadProfile(true);
});

type Faixa = {
  currency: string;
  period: "year" | "month" | "week" | "day" | "hour";
  floor: number;
  target: number;
  ideal?: number;
};

/** O perfil real com as faixas trocadas — nada mais muda. */
function comFaixas(faixas: Faixa[], projectAccepted = true): Profile {
  const clone = structuredClone(base);
  clone.compensation.ranges = faixas;
  clone.compensation.reference_currency = "USD";
  clone.compensation.project = { ...clone.compensation.project, accepted: projectAccepted };
  return clone;
}

function vaga(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    title: "AI Solutions Architect",
    companyName: "Acme",
    descriptionText: "We build software with typescript and postgres.",
    locationRaw: "Remote",
    ...overrides,
  };
}

const nota = (profile: Profile, entrada: Partial<ScoreInput>) =>
  scoreJob(vaga(entrada), profile).compScore;

const anual = (valor: number) => ({
  compMax: valor,
  compCurrency: "USD",
  compPeriod: "year" as const,
});

describe("faixa declarada sem `ideal`", () => {
  const perfil = () => comFaixas([{ currency: "USD", period: "year", floor: 90_000, target: 150_000 }]);

  it("UT-270 acima do alvo ainda cresce, usando 40% acima do alvo como teto implícito", () => {
    const p = perfil();
    const noAlvo = nota(p, anual(150_000));
    const meio = nota(p, anual(180_000));
    // 150.000 × 1,4 = 210.000 é o ideal implícito.
    const noTeto = nota(p, anual(210_000));
    const acima = nota(p, anual(400_000));

    expect(meio).toBeGreaterThan(noAlvo);
    expect(noTeto).toBeGreaterThan(meio);
    // Sem `ideal` declarado, o teto implícito entrega o peso cheio — e nada
    // acima dele rende mais.
    expect(noTeto).toBeCloseTo(WEIGHTS.comp, 5);
    expect(acima).toBeCloseTo(WEIGHTS.comp, 5);
  });

  it("UT-271 a nota continua um número em toda a faixa, nunca NaN nem Infinity", () => {
    const p = perfil();
    for (const valor of [1, 89_999, 90_000, 120_000, 150_000, 209_999, 210_000, 1_000_000]) {
      const n = nota(p, anual(valor));
      expect(Number.isFinite(n), String(valor)).toBe(true);
      expect(n, String(valor)).toBeLessThanOrEqual(WEIGHTS.comp);
      expect(n, String(valor)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("faixa degenerada, onde dois limites coincidem", () => {
  it("UT-272 `ideal` igual ao alvo dá o peso cheio no alvo, sem dividir por zero", () => {
    // O Zod exige `ideal >= target`, então igual é declaração válida — e nela o
    // intervalo entre alvo e ideal é zero.
    const p = comFaixas([
      { currency: "USD", period: "year", floor: 90_000, target: 150_000, ideal: 150_000 },
    ]);

    const noAlvo = nota(p, anual(150_000));
    const abaixo = nota(p, anual(149_999));

    expect(Number.isFinite(noAlvo)).toBe(true);
    expect(noAlvo).toBeCloseTo(WEIGHTS.comp, 5);
    // Um centavo abaixo cai para a faixa entre piso e alvo: continua ordenado.
    expect(abaixo).toBeLessThan(noAlvo);
  });

  it("UT-273 piso igual ao alvo pontua o mínimo da faixa alta, sem NaN", () => {
    // Faixa sem largura entre piso e alvo: quem paga exatamente esse valor
    // atende o alvo, e quem paga um centavo menos não atende o piso.
    const p = comFaixas([
      { currency: "USD", period: "year", floor: 120_000, target: 120_000, ideal: 200_000 },
    ]);

    const exato = nota(p, anual(120_000));
    const abaixo = nota(p, anual(119_999));

    expect(Number.isFinite(exato)).toBe(true);
    expect(exato).toBeGreaterThan(0);
    expect(abaixo).toBe(0);
  });

  it("UT-274 piso, alvo e ideal todos iguais: a faixa é um ponto e ainda pontua", () => {
    const p = comFaixas([
      { currency: "USD", period: "year", floor: 100_000, target: 100_000, ideal: 100_000 },
    ]);

    const exato = nota(p, anual(100_000));

    expect(Number.isFinite(exato)).toBe(true);
    expect(exato).toBeCloseTo(WEIGHTS.comp, 5);
    expect(nota(p, anual(99_999))).toBe(0);
  });
});

describe("faixa em outro período, e a anualização que a compara", () => {
  it("UT-275 faixa só por hora compara com uma oferta anual, pelo mesmo ano", () => {
    // O perfil tem faixa anual; um perfil que só declare valor-hora é igualmente
    // válido, e a comparação passa por anualizar a FAIXA, não a oferta.
    const p = comFaixas([{ currency: "USD", period: "hour", floor: 55, target: 85, ideal: 120 }]);

    const baixa = nota(p, anual(80_000));
    const alta = nota(p, anual(240_000));

    expect(baixa).toBeLessThan(alta);
    expect(Number.isFinite(baixa)).toBe(true);
  });

  it("UT-276 oferta mensal contra faixa anual usa a anualização, não o número cru", () => {
    // 12.000/mês são 144.000/ano: abaixo do alvo de 150.000, muito acima do piso.
    // Comparar 12.000 com 90.000 cru daria zero, e a vaga sairia do quadro.
    const p = comFaixas([
      { currency: "USD", period: "year", floor: 90_000, target: 150_000, ideal: 220_000 },
    ]);

    const mensal = nota(p, { compMax: 12_000, compCurrency: "USD", compPeriod: "month" });

    expect(mensal).toBeGreaterThan(0);
    expect(mensal).toBeLessThan(WEIGHTS.comp);
  });
});

describe("projeto recusado no perfil", () => {
  it("UT-277 quem não aceita preço fechado pontua zero e diz que é escolha", () => {
    const p = comFaixas(
      [{ currency: "USD", period: "year", floor: 90_000, target: 150_000, ideal: 220_000 }],
      false,
    );

    const resultado = scoreJob(
      vaga({ compMax: 300_000, compCurrency: "USD", compPeriod: "project", compDurationMonths: 6 }),
      p,
    );

    // Zero aqui não é dado faltante punido: é preferência declarada, e por isso
    // a razão precisa dizer qual, para o zero não parecer defeito de leitura.
    expect(resultado.compScore).toBe(0);
    expect(JSON.stringify(resultado.reasons)).toMatch(/project/i);
  });
});
