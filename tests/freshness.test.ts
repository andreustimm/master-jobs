import { describe, expect, it } from "vitest";
import { scoreBenefits, detectBenefits } from "../src/core/scoring/benefits.ts";
import { HALF_LIFE_DAYS, PLATEAU_DAYS, scoreFreshness } from "../src/core/scoring/freshness.ts";

const NOW = Date.parse("2026-08-18T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("scoreFreshness", () => {
  it("treats anything inside the hot window as fully fresh", () => {
    // Asserted against the constant, not a literal: the curve is calibrated to
    // the corpus and moves when the corpus does. The property is what is fixed.
    expect(scoreFreshness({ postedAt: daysAgo(0) }, NOW).factor).toBe(1);
    expect(scoreFreshness({ postedAt: daysAgo(PLATEAU_DAYS) }, NOW).factor).toBe(1);
  });

  it("starts decaying immediately after the hot window", () => {
    expect(scoreFreshness({ postedAt: daysAgo(PLATEAU_DAYS + 1) }, NOW).factor).toBeLessThan(1);
  });

  it("decays monotonically after the plateau", () => {
    const ages = [4, 7, 14, 30, 60, 120];
    const factors = ages.map((d) => scoreFreshness({ postedAt: daysAgo(d) }, NOW).factor);
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]!).toBeLessThan(factors[i - 1]!);
    }
    // One half-life past the plateau is worth exactly half.
    expect(
      scoreFreshness({ postedAt: daysAgo(PLATEAU_DAYS + HALF_LIFE_DAYS) }, NOW).factor,
    ).toBeCloseTo(0.5, 2);
  });

  it("stays neutral when no date is available", () => {
    // Punishing a missing date would demote whole sources for a property of
    // their API rather than of the job.
    const r = scoreFreshness({}, NOW);
    expect(r.factor).toBe(0.5);
    expect(r.basis).toBe("unknown");
    expect(r.ageDays).toBeNull();
  });

  it("falls back to firstSeenAt and says so", () => {
    const r = scoreFreshness({ postedAt: null, firstSeenAt: daysAgo(10) }, NOW);
    expect(r.basis).toBe("first_seen");
    expect(r.reason).toContain("may be older");
  });

  it("prefers the employer's date over our own sighting", () => {
    const r = scoreFreshness({ postedAt: daysAgo(40), firstSeenAt: daysAgo(1) }, NOW);
    expect(r.basis).toBe("posted");
    expect(r.ageDays).toBeCloseTo(40, 0);
  });

  it("clamps a future date instead of rewarding it", () => {
    // A bad timezone offset must not buy a posting free rank.
    const r = scoreFreshness({ postedAt: new Date(NOW + 5 * 86_400_000).toISOString() }, NOW);
    expect(r.factor).toBe(1);
    expect(r.ageDays).toBe(0);
  });

  it("ignores an unparseable date", () => {
    expect(scoreFreshness({ postedAt: "não é uma data" }, NOW).basis).toBe("unknown");
  });
});

const PREFS = {
  required: [],
  preferred: ["paid_time_off", "equity", "learning_budget", "health_stipend"],
  nice_to_have: ["home_office_stipend", "coworking", "async_first"],
  irrelevant: ["visa_sponsorship", "relocation"],
};

const filler = "We build developer tooling for distributed engineering teams. ".repeat(10);

describe("detectBenefits", () => {
  it("maps varied phrasing onto canonical keys", () => {
    expect(detectBenefits("Unlimited vacation and RSUs")).toEqual(
      expect.arrayContaining(["paid_time_off", "equity"]),
    );
  });

  it("does not confuse home office stipend with coworking", () => {
    // "office stipend" is a substring of "home office stipend".
    expect(detectBenefits("We offer a home office stipend.")).not.toContain("coworking");
  });

  it("returns nothing for empty input", () => {
    expect(detectBenefits(null)).toEqual([]);
    expect(detectBenefits("")).toEqual([]);
  });
});

describe("scoreBenefits", () => {
  it("never punishes a posting it cannot read", () => {
    // The load-bearing rule: silence is not absence.
    const r = scoreBenefits("Senior engineer wanted.", PREFS);
    expect(r.factor).toBe(0.5);
    expect(r.readable).toBe(false);
    expect(r.missingRequired).toEqual([]);
  });

  it("never reports a missing required benefit on an unreadable posting", () => {
    const strict = { ...PREFS, required: ["health_stipend"] };
    expect(scoreBenefits("Short.", strict).missingRequired).toEqual([]);
    expect(scoreBenefits(filler, strict).missingRequired).toEqual(["health_stipend"]);
  });

  it("scores a rich posting near the ceiling", () => {
    const rich = `${filler} We offer unlimited vacation, stock options, a learning budget, health insurance and a home office stipend.`;
    expect(scoreBenefits(rich, PREFS).factor).toBe(1);
  });

  it("gives a readable but silent posting a low floor, not zero", () => {
    const r = scoreBenefits(filler, PREFS);
    expect(r.factor).toBe(0.25);
    expect(r.reason).toBe("No benefits listed");
  });

  it("ignores benefits the candidate marked irrelevant", () => {
    const onlyIrrelevant = `${filler} We provide visa sponsorship and a relocation package.`;
    const r = scoreBenefits(onlyIrrelevant, PREFS);
    expect(r.detected).toEqual(expect.arrayContaining(["visa_sponsorship", "relocation"]));
    expect(r.matchedPreferred).toEqual([]);
    // Detected, but worth nothing to this candidate — floor, not credit.
    expect(r.factor).toBe(0.25);
  });

  it("weights preferred above nice-to-have", () => {
    const pref = scoreBenefits(`${filler} Equity for everyone.`, PREFS).factor;
    const nice = scoreBenefits(`${filler} We are async and remote-first.`, PREFS).factor;
    expect(pref).toBeGreaterThan(nice);
  });
});
