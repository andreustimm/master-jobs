/**
 * Statistical primitives.
 *
 * Pure, dependency-free, and deliberately small. Every function here answers a
 * question the product actually asks; nothing is here "for completeness".
 *
 * The bias throughout is toward **admitting uncertainty**. A job-hunt funnel
 * produces tiny samples — a dozen applications is a good month — and the
 * failure mode that matters is not a slightly wrong number, it is a confident
 * one. So proportions come back as intervals, correlations come back with the
 * sample size attached, and anything computed from too few points says so.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1). Zero for fewer than two points. */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Linear-interpolated quantile. `q` in 0..1. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

/**
 * Coefficient of variation — spread relative to level.
 *
 * This is how a scoring component gets judged. A component that returns nearly
 * the same value for every job carries no information however large its weight:
 * it shifts all scores equally and changes no ranking. Raw standard deviation
 * cannot say that, because components live on different scales (30 points vs
 * 4); dividing by the mean makes them comparable.
 */
export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return stdDev(xs) / m;
}

/** Pearson correlation. Returns null when undefined (constant input, n < 3). */
export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Average ranks, ties shared — required for a correct Spearman. */
export function rank(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = shared;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation.
 *
 * Preferred over Pearson for anything involving a score, because what matters
 * is the ordering the user sees, not the linearity of the underlying numbers.
 */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  return pearson(rank(xs), rank(ys));
}

export type Interval = { point: number; low: number; high: number; n: number };

/**
 * Wilson score interval for a proportion.
 *
 * Not the textbook normal approximation, which is actively wrong at the sample
 * sizes this product deals with: with 0 successes in 8 tries it produces the
 * interval [0, 0], claiming certainty that the true rate is zero. Wilson stays
 * honest at small n and never leaves the 0..1 range — exactly the properties
 * needed for "1 application so far".
 */
export function wilson(successes: number, total: number, z = 1.96): Interval {
  if (total === 0) return { point: 0, low: 0, high: 1, n: 0 };
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return {
    point: p,
    low: Math.max(0, (centre - spread) / denom),
    high: Math.min(1, (centre + spread) / denom),
    n: total,
  };
}

/**
 * Smallest sample at which a proportion near `p` is known to within `±margin`.
 *
 * Used to tell the user how many applications they need before a reply-rate
 * comparison means anything, instead of letting them read signal into n=3.
 */
export function sampleSizeFor(margin: number, p = 0.15, z = 1.96): number {
  if (margin <= 0) return Infinity;
  return Math.ceil((z * z * p * (1 - p)) / (margin * margin));
}
