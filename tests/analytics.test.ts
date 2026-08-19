import { describe, expect, it } from "vitest";
import { analyzeFunnel, hasReplied, type Outcome } from "../src/core/analytics/funnel.ts";
import { diagnoseScorer } from "../src/core/analytics/scorer-diagnostics.ts";
import {
  coefficientOfVariation,
  median,
  quantile,
  rank,
  sampleSizeFor,
  spearman,
  stdDev,
  wilson,
} from "../src/core/analytics/stats.ts";

describe("stats", () => {
  it("computes a sample standard deviation, not a population one", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it("returns zero spread for fewer than two points", () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0);
  });

  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
  });

  it("shares ranks across ties", () => {
    // Required for a correct Spearman; naive ranking silently biases it.
    expect(rank([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("finds a monotonic relationship Pearson would understate", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [1, 4, 9, 16, 25];
    expect(spearman(xs, ys)).toBeCloseTo(1, 5);
  });

  it("returns null rather than a number it cannot justify", () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("normalises spread by level so components on different scales compare", () => {
    const small = coefficientOfVariation([9, 10, 11]);
    const large = coefficientOfVariation([90, 100, 110]);
    expect(small).toBeCloseTo(large, 6);
  });

  describe("wilson", () => {
    it("never claims certainty from zero successes", () => {
      // The normal approximation returns [0, 0] here, asserting the true rate
      // is exactly zero from 8 tries. That is the bug this exists to avoid.
      const i = wilson(0, 8);
      expect(i.point).toBe(0);
      expect(i.high).toBeGreaterThan(0.2);
    });

    it("never claims certainty from a perfect run", () => {
      const i = wilson(1, 1);
      expect(i.low).toBeLessThan(0.5);
      expect(i.high).toBe(1);
    });

    it("stays inside 0..1", () => {
      for (const [s, n] of [[0, 1], [1, 1], [3, 5], [50, 100]] as const) {
        const i = wilson(s, n);
        expect(i.low).toBeGreaterThanOrEqual(0);
        expect(i.high).toBeLessThanOrEqual(1);
      }
    });

    it("narrows as the sample grows", () => {
      const width = (s: number, n: number) => {
        const i = wilson(s, n);
        return i.high - i.low;
      };
      expect(width(30, 200)).toBeLessThan(width(3, 20));
    });

    it("gives the widest possible interval for no data at all", () => {
      expect(wilson(0, 0)).toEqual({ point: 0, low: 0, high: 1, n: 0 });
    });
  });

  it("sizes a sample for a target margin", () => {
    expect(sampleSizeFor(0.1)).toBe(49);
    expect(sampleSizeFor(0.05)).toBeGreaterThan(sampleSizeFor(0.1));
  });
});

const sample = (key: string, weight: number, values: number[]) => ({
  key,
  label: key,
  weight,
  values,
});

describe("diagnoseScorer", () => {
  const spread = Array.from({ length: 100 }, (_, i) => (i % 30) + 1);
  const flat = Array.from({ length: 100 }, () => 5.5);

  it("calls out a component that carries weight but does not reorder", () => {
    // The whole point: weight is what was intended, spread is what happened.
    const d = diagnoseScorer(
      [sample("cargo", 30, spread), sample("frescor", 6, flat)],
      spread.map((v, i) => v + flat[i]!),
    );
    const dead = d.components.find((c) => c.key === "frescor")!;
    expect(dead.verdict).toBe("dead-weight");
    expect(dead.influence).toBeLessThan(0.05);
    expect(d.warnings.join(" ")).toContain("peso sem efeito");
  });

  it("does not accuse a component that spreads", () => {
    const d = diagnoseScorer([sample("cargo", 30, spread)], spread);
    expect(d.components[0]!.verdict).toBe("healthy");
  });

  it("flags a component pinned at its ceiling", () => {
    const pinned = Array.from({ length: 100 }, (_, i) => (i < 95 ? 10 : 2));
    const d = diagnoseScorer([sample("geo", 10, pinned)], pinned);
    expect(d.components[0]!.verdict).toBe("saturated");
  });

  it("detects two components measuring the same thing", () => {
    const a = spread;
    const b = spread.map((v) => v * 2);
    const d = diagnoseScorer([sample("a", 30, a), sample("b", 30, b)], a);
    expect(d.redundant).toHaveLength(1);
    expect(d.redundant[0]!.rho).toBeCloseTo(1, 2);
    expect(d.warnings.join(" ")).toContain("duas vezes");
  });

  it("warns when the corpus is too small to conclude anything", () => {
    const d = diagnoseScorer([sample("a", 10, [1, 2, 3])], [1, 2, 3]);
    expect(d.warnings.join(" ")).toContain("não são estáveis");
  });

  it("survives an empty corpus", () => {
    const d = diagnoseScorer([sample("a", 10, [])], []);
    expect(d.jobs).toBe(0);
    expect(d.fit.mean).toBe(0);
  });
});

const outcome = (status: string, over: Partial<Outcome> = {}): Outcome => ({
  jobId: 1,
  status,
  replied: hasReplied(status),
  fit: 70,
  cluster: "architect",
  sourceKind: "lever",
  channel: "direct",
  components: { Cargo: 25 },
  ...over,
});

describe("analyzeFunnel", () => {
  it("counts a rejection as a reply", () => {
    // Excluding it would measure "good outcomes" while claiming to measure
    // response rate, and the number would improve as the process got worse.
    expect(hasReplied("rejected")).toBe(true);
    expect(hasReplied("applied")).toBe(false);
    expect(hasReplied("backlog")).toBe(false);
  });

  it("withholds every breakdown until the sample can support one", () => {
    const r = analyzeFunnel([outcome("applied"), outcome("screening")]);
    expect(r.trustworthy).toBe(false);
    expect(r.byCluster).toEqual([]);
    expect(r.bySource).toEqual([]);
    expect(r.componentSignal).toEqual([]);
    expect(r.power).toContain("candidatura");
  });

  it("says how many more applications are needed", () => {
    const r = analyzeFunnel([outcome("applied")]);
    expect(r.needed).toBe(48);
  });

  it("reports an interval, never a bare rate", () => {
    const r = analyzeFunnel([outcome("applied"), outcome("applied")]);
    expect(r.overall.point).toBe(0);
    // Two failures do not prove the true rate is zero.
    expect(r.overall.high).toBeGreaterThan(0.5);
  });

  it("produces breakdowns once there is enough data", () => {
    const many = [
      ...Array.from({ length: 20 }, () => outcome("screening")),
      ...Array.from({ length: 20 }, () => outcome("applied", { cluster: "backend" })),
    ];
    const r = analyzeFunnel(many);
    expect(r.trustworthy).toBe(true);
    expect(r.byCluster).toHaveLength(2);
    expect(r.power).toBeNull();
    const architect = r.byCluster.find((g) => g.group === "architect")!;
    expect(architect.rate.point).toBe(1);
  });

  it("handles an empty funnel without dividing by zero", () => {
    const r = analyzeFunnel([]);
    expect(r.applied).toBe(0);
    expect(r.overall.high).toBe(1);
    expect(r.power).toContain("Nenhuma candidatura");
  });
});
