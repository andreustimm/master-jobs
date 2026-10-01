import { beforeAll, describe, expect, it } from "vitest";

import { scoreMessages, type ScoreMessage } from "../src/contexts/matching/index.ts";
import { renderScoreMessage, translator } from "../src/core/i18n/index.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import type { ScoreInput } from "../src/core/scoring/score.ts";
import { scoreJob } from "./support/score-now.ts";

/**
 * Issue #426. O scorer grava o rótulo de remuneração já formatado
 * (`formatMoney(posted)`, sem idioma): "$5,000/month", "$30,000 total",
 * "$30,000 total (2 meses)". O banco guarda esse texto; quem conhece o idioma
 * de quem lê é a borda que exibe. Estes testes partem da saída REAL do scorer,
 * passam pelo mesmo portão de leitura do banco (`scoreMessages`) e conferem o
 * que cada idioma mostra — sem tocar no que o scorer grava.
 */

let profile: Profile;
const pt = translator("pt-BR").t;
const en = translator("en").t;

beforeAll(async () => {
  profile = await loadProfile(true);
});

function job(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    title: "Software Engineer",
    companyName: "Acme",
    descriptionText: "We build software.",
    locationRaw: "Remote",
    ...overrides,
  };
}

/** A mensagem de remuneração como ela volta do banco: JSON, depois o portão. */
function storedCompMessage(input: ScoreInput): ScoreMessage {
  const result = scoreJob(input, profile);
  const stored: unknown = JSON.parse(JSON.stringify([...result.reasons, ...result.blockers]));
  const found = scoreMessages(stored).find((item) => item.code.startsWith("comp."));
  if (!found) throw new Error("o scorer não devolveu mensagem de remuneração");
  return found;
}

describe("rótulo de remuneração do score no idioma de quem lê (#426)", () => {
  it("comp.noBasis: o período sai em português em pt-BR e em inglês em en", () => {
    // Sem cotação e sem faixa em PHP no perfil: cai em "sem base".
    const stored = storedCompMessage(job({ compMax: 5000, compCurrency: "PHP", compPeriod: "month" }));
    expect(stored.code).toBe("comp.noBasis");

    const portuguese = renderScoreMessage(stored, pt);
    expect(portuguese).toContain("/mês");
    expect(portuguese).not.toContain("/month");

    const english = renderScoreMessage(stored, en);
    expect(english).toContain("/month");
    expect(english).not.toContain("/mês");
  });

  it("comp.projectNoDuration: o sufixo de projeto vem do dicionário nos dois idiomas", () => {
    const stored = storedCompMessage(job({ compMax: 30000, compCurrency: "USD", compPeriod: "project" }));
    expect(stored.code).toBe("comp.projectNoDuration");

    expect(renderScoreMessage(stored, pt)).toContain(` ${pt("jobs.moneyProjectTotal")} `);
    expect(renderScoreMessage(stored, en)).toContain(` ${en("jobs.moneyProjectTotal")} `);
  });

  it("projeto com duração: \"N meses\" em pt-BR e \"N months\" em inglês", () => {
    const stored = storedCompMessage(
      job({ compMax: 30000, compCurrency: "USD", compPeriod: "project", compDurationMonths: 2 }),
    );
    expect(String(stored.params?.label)).toContain("total (2 meses)");

    expect(renderScoreMessage(stored, pt)).toContain("total (2 meses)");
    const english = renderScoreMessage(stored, en);
    expect(english).toContain("total (2 months)");
    expect(english).not.toContain("meses");
  });

  it.each([
    ["week", "semana"],
    ["day", "dia"],
    ["hour", "hora"],
  ])("período %s vira %s em pt-BR", (period, word) => {
    const stored = storedCompMessage(job({ compMax: 100, compCurrency: "PHP", compPeriod: period }));
    const portuguese = renderScoreMessage(stored, pt);
    expect(portuguese).toContain(`/${word}`);
    expect(portuguese).not.toContain(`/${period}`);
  });

  it("rótulo com conversão: traduz o período do valor anunciado e preserva o convertido", () => {
    const rendered = renderScoreMessage(
      { code: "comp.below", params: { label: "CA$5,000/month ≈ $43,800" } },
      pt,
    );
    expect(rendered).toContain("CA$5,000/mês ≈ $43,800");
  });

  it("valor anual não tem sufixo e passa intacto", () => {
    const message: ScoreMessage = { code: "comp.target", params: { label: "$150,000" } };
    expect(renderScoreMessage(message, pt)).toContain("$150,000 ");
    expect(renderScoreMessage(message, en)).toContain("$150,000 ");
  });

  it("não reescreve parâmetro de mensagem que não é de remuneração", () => {
    const rendered = renderScoreMessage({ code: "legacy", params: { text: "USD 50/hour total" } }, pt);
    expect(rendered).toContain("USD 50/hour total");
  });

  it("não mexe na mensagem recebida", () => {
    const message: ScoreMessage = { code: "comp.below", params: { label: "$50/hour" } };
    renderScoreMessage(message, pt);
    expect(message.params?.label).toBe("$50/hour");
  });
});
