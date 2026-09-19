import { beforeAll, describe, expect, it } from "vitest";
import {
  effectiveProfile,
  evidenceInherited,
  evidenceSupport,
  inheritedFields,
  isRelevant,
  preselectTrack,
  suggestTrack,
  targetOf,
  validateTrackName,
  validateTrackTarget,
  type TrackTarget,
} from "../src/contexts/matching/domain/track.ts";
import { deriveMatchingProfile } from "../src/contexts/matching/index.ts";
import type { SkillDefinition } from "../src/contexts/skills/index.ts";
import type { FxTable } from "../src/core/money.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { scoreJob } from "../src/core/scoring/score.ts";

const RATES: FxTable = { base: "USD", rates: { BRL: 5, EUR: 0.9 }, date: "2026-09-18" };
const LARAVEL: SkillDefinition = { slug: "laravel", name: "Laravel", category: "framework", aliases: ["laravel php"] };
const REACT: SkillDefinition = { slug: "react", name: "React", category: "framework", aliases: ["react.js"] };

let person: Profile;
let primary: TrackTarget;
let php: TrackTarget;

beforeAll(async () => {
  person = await loadProfile(true);
  primary = targetOf(person);
  php = suggestTrack({ term: "Laravel", catalog: [LARAVEL], primary }).target;
  php.keywords.stack.push({ term: "php", weight: 5 });
  php.keywords.negative.push({ term: "wordpress", weight: -6 });
});

function withTarget(mutate: (target: TrackTarget) => void): TrackTarget {
  const target = structuredClone(php);
  mutate(target);
  return target;
}

describe("track domain", () => {
  it("UT-020 merges the target with the person profile", () => {
    const merged = effectiveProfile(person, php);
    expect(merged.targets).toEqual(php.targets);
    expect(merged.keywords).toEqual(php.keywords);
    expect(merged.seniority.min_years_expected).toBe(php.seniority.min_years_expected);
    expect(merged.seniority.reject_below_years).toBe(php.seniority.reject_below_years);
    expect(merged.compensation.ranges).toEqual(php.compensation.ranges);
    expect(merged.compensation.reference_currency).toBe(php.compensation.reference_currency);
    expect(merged.constraints).toEqual(person.constraints);
    expect(merged.blockers).toEqual(person.blockers);
    expect(merged.compensation.project).toEqual(person.compensation.project);
    expect(merged.compensation.benefits).toEqual(person.compensation.benefits);
    expect(merged.seniority.years_experience).toBe(person.seniority.years_experience);
    expect(merged.evidence).toEqual(person.evidence);
  });

  it("UT-021 requires at least one target title", () => {
    const target = withTarget((t) => {
      t.targets.clusters = { laravel: { weight: 1, titles: [" "], cv_variant: "laravel" } };
    });
    expect(validateTrackTarget(target, RATES)).toEqual({ ok: false, code: "track_titles_required" });
  });

  it("UT-022 requires at least one positive keyword", () => {
    const target = withTarget((t) => {
      t.keywords.critical = [];
      t.keywords.strong = [];
      t.keywords.stack = [];
    });
    expect(validateTrackTarget(target, RATES)).toEqual({ ok: false, code: "track_keywords_required" });
  });

  it("UT-023 rejects a floor above the target", () => {
    const target = withTarget((t) => {
      t.compensation.ranges = [{ currency: "USD", period: "month", floor: 9000, target: 8000 }];
    });
    expect(validateTrackTarget(target, RATES)).toEqual({ ok: false, code: "range_invalid" });
  });

  it("UT-024 rejects two ranges for the same currency and period", () => {
    const target = withTarget((t) => {
      t.compensation.ranges = [
        { currency: "USD", period: "month", floor: 5000, target: 6000 },
        { currency: "USD", period: "month", floor: 5500, target: 7000 },
      ];
    });
    expect(validateTrackTarget(target, RATES)).toEqual({ ok: false, code: "range_duplicate" });
  });

  it("UT-025 bounds range amounts", () => {
    const at = (floor: number, ideal: number) =>
      withTarget((t) => {
        t.compensation.ranges = [{ currency: "USD", period: "year", floor, target: floor, ideal }];
      });
    expect(validateTrackTarget(at(9_000_000, 10_000_000), RATES)).toEqual({ ok: true });
    expect(validateTrackTarget(at(9_000_000, 10_000_001), RATES)).toEqual({ ok: false, code: "range_invalid" });
    expect(validateTrackTarget(at(0, 1000), RATES)).toEqual({ ok: false, code: "range_invalid" });
  });

  it("UT-026 enforces the keyword weight scale", () => {
    const weight = (value: number, list: "critical" | "negative") =>
      withTarget((t) => {
        if (list === "critical") t.keywords.critical = [{ term: "laravel", weight: value }];
        else t.keywords.negative = [{ term: "wordpress", weight: value }];
      });
    expect(validateTrackTarget(weight(11, "critical"), RATES)).toEqual({ ok: false, code: "keyword_weight_invalid" });
    expect(validateTrackTarget(weight(0, "critical"), RATES)).toEqual({ ok: false, code: "keyword_weight_invalid" });
    expect(validateTrackTarget(weight(-11, "negative"), RATES)).toEqual({ ok: false, code: "keyword_weight_invalid" });
    expect(validateTrackTarget(weight(10, "critical"), RATES)).toEqual({ ok: true });
    expect(validateTrackTarget(weight(-3, "negative"), RATES)).toEqual({ ok: true });
  });

  it("UT-027 bounds the track name", () => {
    for (const name of ["", "   ", "x".repeat(41)]) {
      expect(validateTrackName(name)).toEqual({ ok: false, code: "track_name_invalid" });
    }
    expect(validateTrackName("x".repeat(40))).toMatchObject({ ok: true });
  });

  it("UT-028 requires a range and a known currency", () => {
    expect(validateTrackTarget(withTarget((t) => { t.compensation.ranges = []; }), RATES))
      .toEqual({ ok: false, code: "range_required" });
    const ars = withTarget((t) => {
      t.compensation.ranges = [
        ...t.compensation.ranges,
        { currency: "ARS", period: "month", floor: 1000, target: 2000 },
      ];
    });
    expect(validateTrackTarget(ars, RATES)).toEqual({ ok: false, code: "range_currency_unknown" });
    const noReference = withTarget((t) => {
      t.compensation.reference_currency = "USD";
      t.compensation.ranges = [{ currency: "BRL", period: "month", floor: 20000, target: 25000 }];
    });
    expect(validateTrackTarget(noReference, RATES)).toEqual({ ok: false, code: "range_reference_missing" });
    expect(validateTrackTarget(php, null)).toEqual({ ok: true });
  });

  it("UT-029 is relevant through a target title", () => {
    expect(isRelevant(php, { title: "Senior Laravel Developer", description: "" })).toBe(true);
  });

  it("UT-030 is relevant through a description keyword", () => {
    expect(isRelevant(php, { title: "Backend Engineer", description: "We use PHP 8 and MySQL" })).toBe(true);
  });

  it("UT-031 ignores the company name", () => {
    const job = { title: "Engineer", description: "Backend services", companyName: "Laravel Partners" };
    expect(isRelevant(php, job)).toBe(false);
  });

  it("UT-032 is not relevant through a negative keyword", () => {
    expect(isRelevant(php, { title: "Developer", description: "WordPress themes" })).toBe(false);
  });

  it("UT-033 suggests titles and keywords from the catalog", () => {
    const { target, thin } = suggestTrack({ term: "Laravel", catalog: [REACT, LARAVEL], primary });
    expect(Object.values(target.targets.clusters).flatMap((c) => c.titles)).toEqual([
      "Laravel Developer",
      "Senior Laravel Developer",
      "Laravel Engineer",
      "Backend Engineer (Laravel)",
    ]);
    expect(target.keywords.critical).toEqual([{ term: "laravel", weight: 10 }]);
    expect(thin).toBe(false);
    expect(target.compensation).toEqual(primary.compensation);
    expect(target.seniority).toEqual(primary.seniority);
  });

  it("UT-034 suggests deterministically", () => {
    const input = { term: "Laravel", catalog: [REACT, LARAVEL], primary };
    expect(suggestTrack(input)).toEqual(suggestTrack(input));
  });

  it("UT-035 falls back to the term with an empty catalog", () => {
    const { target, thin } = suggestTrack({ term: "Elixir", catalog: [], primary });
    expect(target.keywords.critical).toEqual([{ term: "elixir", weight: 10 }]);
    expect(Object.values(target.targets.clusters).flatMap((c) => c.titles)).toEqual(["Elixir Developer"]);
    expect(thin).toBe(true);
  });

  it("UT-036 falls back to the term when the catalog lacks it", () => {
    const { target, thin } = suggestTrack({ term: "Zig", catalog: [REACT, LARAVEL], primary });
    expect(target.keywords.critical).toEqual([{ term: "zig", weight: 10 }]);
    expect(Object.values(target.targets.clusters).flatMap((c) => c.titles)).toEqual(["Zig Developer"]);
    expect(thin).toBe(true);
  });

  const trackOf = (terms: string[]): TrackTarget =>
    withTarget((t) => {
      t.keywords.critical = terms.map((term) => ({ term, weight: 8 }));
      t.keywords.strong = [];
      t.keywords.stack = [];
    });

  it("UT-037 splits supported keywords from gaps using own evidence", () => {
    const result = evidenceSupport(trackOf(["laravel", "vue"]), {
      lines: ["MPC — enterprise multi-tenant User Management System on Laravel 12 + Jetstream"],
      confirmedSkills: [],
      inherited: false,
    });
    expect(result).toEqual({ supported: ["laravel"], gaps: ["vue"] });
  });

  it("an empty evidence list supports nothing (UT-038 lives in the integration suite)", () => {
    const result = evidenceSupport(trackOf(["kubernetes"]), { lines: [], confirmedSkills: [], inherited: false });
    expect(result.gaps).toEqual(["kubernetes"]);
  });

  it("UT-039 counts confirmed skills as support", () => {
    const result = evidenceSupport(trackOf(["react"]), { lines: [], confirmedSkills: ["React"], inherited: false });
    expect(result.supported).toEqual(["react"]);
  });

  it("UT-040 ignores inherited evidence", () => {
    const result = evidenceSupport(trackOf(["laravel"]), {
      lines: ["Laravel 12 platform"],
      confirmedSkills: [],
      inherited: true,
    });
    expect(result).toEqual({ supported: [], gaps: ["laravel"] });
  });

  it("UT-041 reports every keyword as a gap without evidence", () => {
    const result = evidenceSupport(trackOf(["laravel", "php"]), { lines: [], confirmedSkills: [], inherited: false });
    expect(result).toEqual({ supported: [], gaps: ["laravel", "php"] });
  });

  it("UT-042 marks inherited target fields for non-owners only", () => {
    const derived = deriveMatchingProfile(person, []);
    expect(inheritedFields(derived, person, { isOwner: false })).toEqual(["targets", "compensation"]);
    expect(inheritedFields(derived, person, { isOwner: true })).toEqual([]);
    expect(evidenceInherited(derived, person, { isOwner: false })).toBe(Object.keys(person.evidence).length > 0);
    expect(evidenceInherited(derived, person, { isOwner: true })).toBe(false);
  });

  it("UT-043 preselects the active track that already has the keyword", () => {
    const tracks = [
      { id: 1, status: "active" as const, position: 1, target: primary },
      { id: 2, status: "active" as const, position: 2, target: php },
      { id: 3, status: "archived" as const, position: 3, target: php },
    ];
    expect(preselectTrack("Laravel", tracks)?.id).toBe(2);
    expect(preselectTrack("Elixir", tracks)).toBeNull();
  });

  it("UT-044 ignores evidence when scoring", () => {
    const withEvidence = effectiveProfile({ ...person, evidence: { theme: ["Laravel 12"] } }, php);
    const without = effectiveProfile({ ...person, evidence: {} }, php);
    const job = { title: "Senior Laravel Developer", companyName: "Acme", descriptionText: "PHP and Laravel" };
    const asOf = Date.parse("2026-09-18T00:00:00.000Z");
    expect(scoreJob(job, { profile: withEvidence, fx: null, asOf }))
      .toEqual(scoreJob(job, { profile: without, fx: null, asOf }));
  });
});
