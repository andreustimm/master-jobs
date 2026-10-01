import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VocabularyGapSection } from "../app/candidate-vocabulary-gap.tsx";
import type { GapReport } from "../src/core/candidate.ts";
import { translator } from "../src/core/i18n/index.ts";

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: HTMLAttributes<HTMLElement>) => createElement("span", null, children),
}));
vi.mock("@/components/ui/card", () => ({
  Card: (props: HTMLAttributes<HTMLElement>) => createElement("div", props),
}));
vi.mock("@/components/ui/separator", () => ({
  Separator: (props: HTMLAttributes<HTMLElement>) => createElement("hr", props),
}));

const { t } = translator("en");

function gapFixture(overrides: Partial<GapReport>): GapReport {
  return {
    cvLength: 500,
    jobsAnalysed: 0,
    minFit: 60,
    missing: [],
    confirmed: [],
    unused: [],
    ...overrides,
  };
}

/**
 * Achado 1 da revisão L1 da PR #418 (issue #387): com zero vagas pontuadas,
 * `analyseGap` joga todo termo do CV em `unused` (coverage 0 < 0.05) — por
 * design do domínio, coberto em `tests/cov-core-candidate-gap.test.ts`. O
 * defeito era a TELA tratar essa lista como afirmação de mercado ("raro nas
 * vagas do alvo") sem nenhuma vaga para sustentar a afirmação.
 */
describe("VocabularyGapSection: sem vaga pontuada, sem afirmação de mercado", () => {
  it("não mostra os blocos de confirmado/raro com CV forte e zero vagas analisadas", () => {
    const gap = gapFixture({
      jobsAnalysed: 0,
      // CV forte: cai todo em `unused` porque coverage é 0 sem corpus, como
      // devolve o domínio de verdade (não é fixture inventada).
      unused: [
        { term: "kubernetes", weight: 5, inJobs: 0, coverage: 0, inCv: true },
        { term: "terraform", weight: 4, inJobs: 0, coverage: 0, inCv: true },
      ],
    });

    const html = renderToStaticMarkup(createElement(VocabularyGapSection, { gap, t }));

    expect(html).toContain(t("candidate.noJobsForGap"));
    expect(html).not.toContain(t("copy.vocabularyRareTitle"));
    expect(html).not.toContain(t("copy.vocabularyRareNote"));
    expect(html).not.toContain(t("copy.vocabularyWorking"));
    expect(html).not.toContain("kubernetes");
    expect(html).not.toContain("terraform");
  });

  it("mostra confirmado e raro normalmente quando há vaga analisada", () => {
    const gap = gapFixture({
      jobsAnalysed: 3,
      confirmed: [{ term: "kubernetes", weight: 5, inJobs: 3, coverage: 1, inCv: true }],
      unused: [{ term: "laravel", weight: 2, inJobs: 0, coverage: 0, inCv: true }],
    });

    const html = renderToStaticMarkup(createElement(VocabularyGapSection, { gap, t }));

    expect(html).toContain(t("copy.vocabularyWorking"));
    expect(html).toContain("kubernetes");
    expect(html).toContain(t("copy.vocabularyRareTitle"));
    expect(html).toContain("laravel");
  });
});
