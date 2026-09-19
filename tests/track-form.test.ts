import { describe, expect, it } from "vitest";
import { fieldsToTarget, type TrackFields } from "../app/searches/track-form.ts";
import { validateTrackTarget, type TrackTarget } from "../src/contexts/matching/domain/track.ts";

const BASE: TrackTarget = {
  targets: { clusters: { backend: { weight: 1, titles: ["Backend Engineer"], cv_variant: "backend" } }, avoid_titles: [] },
  keywords: { critical: [], strong: [], stack: [], negative: [] },
  seniority: { min_years_expected: 5, reject_below_years: 2 },
  compensation: { reference_currency: "USD", ranges: [{ currency: "USD", period: "month", floor: 5000, target: 8000 }] },
};

function fields(overrides: Partial<TrackFields>): TrackFields {
  return {
    name: "Laravel",
    titles: "Laravel Developer",
    positives: "laravel 10",
    negatives: "",
    minYears: "5",
    rejectBelow: "2",
    ranges: "USD month 5000 8000",
    referenceCurrency: "USD",
    ...overrides,
  };
}

describe("track form parsing", () => {
  it("reads the trailing weight whatever the spacing, positive and negative", () => {
    const parsed = fieldsToTarget(fields({ positives: "laravel    10\nphp 7", negatives: "wordpress -6" }), BASE);
    expect(parsed.ok && parsed.target.keywords).toMatchObject({
      critical: [{ term: "laravel", weight: 10 }, { term: "php", weight: 7 }],
      negative: [{ term: "wordpress", weight: -6 }],
    });
  });

  it("refuses a pathological keyword line in linear time instead of backtracking over it", () => {
    const started = performance.now();
    const parsed = fieldsToTarget(fields({ positives: `a${" ".repeat(40_000)}b` }), BASE);
    expect(parsed).toEqual({ ok: false, code: "track_too_large" });
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("refuses any field larger than the parser accepts before reading it", () => {
    expect(fieldsToTarget(fields({ titles: "x".repeat(20_001) }), BASE)).toEqual({ ok: false, code: "track_too_large" });
  });

  it("takes cluster names that shadow Object.prototype as plain clusters", () => {
    for (const cluster of ["constructor", "__proto__", "prototype"]) {
      const parsed = fieldsToTarget(fields({ titles: `${cluster}: Staff Engineer` }), BASE);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(Object.hasOwn(parsed.target.targets.clusters, cluster)).toBe(true);
    }
    expect(({} as Record<string, unknown>).titles).toBeUndefined();
  });

  it("refuses pt-BR thousands grouping instead of reading 30.000 as thirty, and keeps decimals", () => {
    expect(fieldsToTarget(fields({ ranges: "BRL month 30.000 40.000 50.000" }), BASE)).toEqual({ ok: false, code: "range_invalid" });
    const hourly = fieldsToTarget(fields({ ranges: "USD hour 62.5 80" }), BASE);
    expect(hourly.ok && hourly.target.compensation.ranges[0]).toMatchObject({ floor: 62.5, target: 80 });
  });
});

describe("track size limits", () => {
  const valid = (target: TrackTarget) => validateTrackTarget(target, null);
  const withKeywords = (count: number): TrackTarget => ({
    ...BASE,
    keywords: { ...BASE.keywords, strong: Array.from({ length: count }, (_, i) => ({ term: `skill${i}`, weight: 5 })) },
  });

  it("accepts the profile-sized track and refuses one above each ceiling", () => {
    expect(valid(withKeywords(200))).toEqual({ ok: true });
    expect(valid(withKeywords(201))).toEqual({ ok: false, code: "track_too_large" });
    const titles = Array.from({ length: 61 }, (_, i) => `Title ${i}`);
    expect(
      valid({ ...withKeywords(1), targets: { clusters: { backend: { weight: 1, titles, cv_variant: "backend" } }, avoid_titles: [] } }),
    ).toEqual({ ok: false, code: "track_too_large" });
    expect(
      valid({ ...BASE, keywords: { ...BASE.keywords, strong: [{ term: "x".repeat(61), weight: 5 }] } }),
    ).toEqual({ ok: false, code: "track_too_large" });
  });
});
