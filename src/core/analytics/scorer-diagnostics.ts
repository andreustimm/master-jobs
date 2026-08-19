/**
 * Does each scoring component actually do anything?
 *
 * This is the half of "statistical analysis of matching" that can be answered
 * today, with 6.239 scored jobs and no funnel data at all. The funnel question
 * — which component predicts a reply — needs outcomes we do not have yet. This
 * question needs only the scores themselves, and it is the one that catches a
 * broken scorer.
 *
 * The insight it turns on: **a component's weight is not its influence.** A
 * component that returns nearly the same value for every job shifts all scores
 * equally and therefore changes no ranking, however many points it is worth.
 * Weight is what we intended; the numbers below are what happened.
 *
 * Two failure modes it detects:
 *
 *   - **Dead weight** — low spread. The component is paying for itself in
 *     points but not sorting anything.
 *   - **Redundancy** — two components correlated near 1. They are measuring the
 *     same property twice, which quietly doubles that property's real weight.
 *
 * Pure: takes rows, returns findings. No database, no clock.
 */
import { coefficientOfVariation, mean, quantile, spearman, stdDev } from "./stats.ts";

export type ComponentSample = {
  key: string;
  label: string;
  /** Declared weight, i.e. the maximum this component can contribute. */
  weight: number;
  values: number[];
};

export type ComponentDiagnostic = {
  key: string;
  label: string;
  weight: number;
  mean: number;
  stdDev: number;
  cv: number;
  p10: number;
  p90: number;
  /** Share of jobs scoring exactly zero here. */
  zeroShare: number;
  /** Share of jobs at the component's ceiling. */
  ceilingShare: number;
  /**
   * Share of the total spread in `fit` this component is responsible for.
   * This — not the weight — is how much it moves the ranking.
   */
  influence: number;
  /** How much of the declared weight is actually used, mean/weight. */
  utilisation: number;
  verdict: "healthy" | "dead-weight" | "saturated" | "all-or-nothing";
  note: string;
};

export type RedundantPair = {
  a: string;
  b: string;
  rho: number;
};

export type ScorerDiagnostics = {
  jobs: number;
  fit: { mean: number; stdDev: number; p10: number; median: number; p90: number };
  components: ComponentDiagnostic[];
  redundant: RedundantPair[];
  warnings: string[];
};

/** Below this coefficient of variation a component barely reorders anything. */
const DEAD_WEIGHT_CV = 0.15;

/** Above this share at the ceiling, a component has stopped discriminating. */
const SATURATED = 0.8;

/** Above this share at zero-or-ceiling, a component is effectively a flag. */
const BINARY = 0.9;

/** Rank correlation above which two components are measuring the same thing. */
const REDUNDANT_RHO = 0.9;

export function diagnoseScorer(
  samples: ComponentSample[],
  fits: number[],
): ScorerDiagnostics {
  const jobs = fits.length;
  const warnings: string[] = [];

  if (jobs < 30) {
    warnings.push(`Só ${jobs} vaga(s) pontuada(s) — os números abaixo não são estáveis.`);
  }

  // Influence is apportioned by each component's own spread. Standard deviation
  // rather than variance because the shares are meant to be read, and variance
  // shares exaggerate the leader.
  const spreads = samples.map((s) => stdDev(s.values));
  const totalSpread = spreads.reduce((a, b) => a + b, 0);

  const components: ComponentDiagnostic[] = samples.map((sample, i) => {
    const values = sample.values;
    const m = mean(values);
    const sd = spreads[i]!;
    const cv = coefficientOfVariation(values);
    const zeroShare = values.length === 0 ? 0 : values.filter((v) => v <= 0).length / values.length;
    const ceilingShare =
      values.length === 0
        ? 0
        : values.filter((v) => v >= sample.weight - 0.05).length / values.length;
    const influence = totalSpread === 0 ? 0 : sd / totalSpread;
    const utilisation = sample.weight === 0 ? 0 : m / sample.weight;

    let verdict: ComponentDiagnostic["verdict"] = "healthy";
    let note = "Distribui bem — separa as vagas.";

    if (cv < DEAD_WEIGHT_CV) {
      verdict = "dead-weight";
      note =
        `Quase o mesmo valor para toda vaga (variação ${(cv * 100).toFixed(0)}%). ` +
        `Vale ${sample.weight} pontos e praticamente não muda o ranking.`;
    } else if (ceilingShare > SATURATED) {
      verdict = "saturated";
      note =
        `${(ceilingShare * 100).toFixed(0)}% das vagas no teto. ` +
        `Deixou de discriminar — considere um critério mais exigente.`;
    } else if (zeroShare + ceilingShare > BINARY) {
      verdict = "all-or-nothing";
      note =
        `${(zeroShare * 100).toFixed(0)}% em zero e ${(ceilingShare * 100).toFixed(0)}% no teto: ` +
        `na prática é uma flag, não uma escala. Só é problema se a intenção era graduar.`;
    }

    return {
      key: sample.key,
      label: sample.label,
      weight: sample.weight,
      mean: round(m),
      stdDev: round(sd),
      cv: round(cv, 3),
      p10: round(quantile(values, 0.1)),
      p90: round(quantile(values, 0.9)),
      zeroShare: round(zeroShare, 3),
      ceilingShare: round(ceilingShare, 3),
      influence: round(influence, 3),
      utilisation: round(utilisation, 3),
      verdict,
      note,
    };
  });

  // Redundancy: rank correlation, because what matters is whether the two
  // components order the corpus the same way, not whether they are linear.
  const redundant: RedundantPair[] = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const rho = spearman(samples[i]!.values, samples[j]!.values);
      if (rho !== null && Math.abs(rho) >= REDUNDANT_RHO) {
        redundant.push({ a: samples[i]!.label, b: samples[j]!.label, rho: round(rho, 3) });
      }
    }
  }
  redundant.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));

  for (const c of components) {
    if (c.verdict === "dead-weight") {
      warnings.push(
        `"${c.label}" carrega ${c.weight} pontos e responde por ${(c.influence * 100).toFixed(0)}% da dispersão — peso sem efeito.`,
      );
    }
  }
  for (const pair of redundant) {
    warnings.push(
      `"${pair.a}" e "${pair.b}" ordenam o acervo quase igual (ρ=${pair.rho}) — a propriedade está sendo contada duas vezes.`,
    );
  }

  return {
    jobs,
    fit: {
      mean: round(mean(fits)),
      stdDev: round(stdDev(fits)),
      p10: round(quantile(fits, 0.1)),
      median: round(quantile(fits, 0.5)),
      p90: round(quantile(fits, 0.9)),
    },
    components,
    redundant,
    warnings,
  };
}

function round(x: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
