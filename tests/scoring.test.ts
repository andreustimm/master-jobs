import { beforeAll, describe, expect, it } from "vitest";
import { loadProfile } from "../src/core/profile/load.ts";
import { scoreJob, type ScoreInput } from "../src/core/scoring/score.ts";
import type { Profile } from "../src/core/profile/schema.ts";

let profile: Profile;

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

describe("profile.yaml", () => {
  it("loads and validates", () => {
    expect(profile.identity.name).toContain("Andreus");
    expect(Object.keys(profile.targets.clusters).length).toBeGreaterThan(0);
    expect(profile.blockers.length).toBeGreaterThan(0);
  });
});

describe("title scoring", () => {
  it("ranks an on-target architect title above a generic engineer title", () => {
    const architect = scoreJob(job({ title: "AI Solutions Architect" }), profile);
    const generic = scoreJob(job({ title: "Software Engineer" }), profile);
    expect(architect.titleScore).toBeGreaterThan(generic.titleScore);
    expect(architect.cluster).toBe("architect");
  });

  it("zeroes the title score for explicitly avoided titles", () => {
    const result = scoreJob(job({ title: "Junior Software Engineer" }), profile);
    expect(result.titleScore).toBe(0);
    expect(result.cluster).toBe("other");
  });

  it("assigns the right cluster per title family", () => {
    expect(scoreJob(job({ title: "Staff Software Engineer" }), profile).cluster).toBe("staff");
    expect(scoreJob(job({ title: "Applied AI Engineer" }), profile).cluster).toBe("ai_lead");
    expect(scoreJob(job({ title: "Engineering Manager" }), profile).cluster).toBe("eng_lead");
  });
});

describe("keyword scoring", () => {
  it("rewards descriptions that match the profile vocabulary", () => {
    const onTarget = scoreJob(
      job({
        descriptionText:
          "You will design multi-agent systems, own RAG pipelines, build evals and guardrails, and lead architecture for a multi-tenant SaaS platform using TypeScript and Python.",
      }),
      profile,
    );
    const offTarget = scoreJob(job({ descriptionText: "You will update our website." }), profile);
    expect(onTarget.keywordScore).toBeGreaterThan(offTarget.keywordScore);
    expect(onTarget.matchedKeywords).toContain("rag");
  });

  it("penalises off-axis stacks", () => {
    const result = scoreJob(
      job({ descriptionText: "Maintain our WordPress and SharePoint sites." }),
      profile,
    );
    expect(result.keywordScore).toBe(0);
  });

  it("does not fire a short term on a longer word", () => {
    // "go" must not match inside "google" or "category".
    const result = scoreJob(
      job({ descriptionText: "Experience with Google Analytics in this category." }),
      profile,
    );
    expect(result.matchedKeywords).not.toContain("go");
  });
});

describe("geo eligibility", () => {
  it("gives full credit when LATAM or Brazil is explicit", () => {
    const result = scoreJob(job({ locationRaw: "Remote - Brazil / LATAM" }), profile);
    expect(result.geoScore).toBe(15);
  });

  it("zeroes a region-restricted remote role", () => {
    const result = scoreJob(
      job({ locationRaw: "Remote", descriptionText: "This role is US only." }),
      profile,
    );
    expect(result.geoScore).toBe(0);
  });

  it("zeroes a role with no remote signal at all", () => {
    const result = scoreJob(
      job({ locationRaw: "New York, NY", descriptionText: "Join us in our office." }),
      profile,
    );
    expect(result.geoScore).toBe(0);
  });
});

describe("blockers", () => {
  it("flags US work authorization requirements", () => {
    const result = scoreJob(
      job({ descriptionText: "Candidates must be authorized to work in the US." }),
      profile,
    );
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.penalty).toBeGreaterThan(0);
  });

  it("caps rather than zeroes an otherwise strong match", () => {
    const strong = job({
      title: "AI Solutions Architect",
      locationRaw: "Remote - LATAM",
      descriptionText:
        "Design multi-agent systems and RAG pipelines. US citizenship required. 10+ years experience.",
    });
    const result = scoreJob(strong, profile);
    expect(result.blockers.length).toBeGreaterThan(0);
    // Still visible, just demoted.
    expect(result.fit).toBeGreaterThan(0);
  });
});

describe("seniority", () => {
  it("rejects clearly under-levelled postings", () => {
    const result = scoreJob(job({ descriptionText: "Looking for 2 years of experience." }), profile);
    expect(result.seniorityScore).toBe(0);
  });

  it("gives full credit at or above the target", () => {
    const result = scoreJob(job({ descriptionText: "Requires 10+ years of experience." }), profile);
    expect(result.seniorityScore).toBe(12);
  });
});

describe("compensation", () => {
  it("scores an hourly rate against the hourly range", () => {
    // USD 100/hour clears the hourly ideal of 120? No — but it beats target 85.
    const hourly = scoreJob(
      job({ compMax: 100, compCurrency: "USD", compPeriod: "hourly" }),
      profile,
    );
    expect(hourly.compScore).toBeGreaterThan(6);
  });

  it("recognises every period spelling the sources emit", () => {
    // "hourly" used to fall through to the annual branch, turning USD 100/hour
    // into USD 100/year and discarding the job as below floor.
    for (const spelling of ["hour", "hourly", "per hour"]) {
      const r = scoreJob(
        job({ compMax: 100, compCurrency: "USD", compPeriod: spelling }),
        profile,
      );
      expect(r.compScore, `period spelling: ${spelling}`).toBeGreaterThan(6);
    }
  });

  it("zeroes pay below the floor", () => {
    const low = scoreJob(
      job({ compMax: 40000, compCurrency: "USD", compPeriod: "year" }),
      profile,
    );
    expect(low.compScore).toBe(0);
  });

  it("refuses to compare a figure with no currency", () => {
    // Treating a bare number as USD is exactly the bug this replaced: the
    // corpus contains CAD, AUD, MXN and PHP postings.
    const noCurrency = scoreJob(job({ compMax: 200000, compPeriod: "year" }), profile);
    expect(noCurrency.reasons.some((r) => r.includes("sem moeda"))).toBe(true);
  });

  it("treats a zero amount as undisclosed, not as below floor", () => {
    // Several aggregators emit 0 instead of null.
    const zero = scoreJob(
      job({ compMax: 0, compMin: 0, compCurrency: "USD", compPeriod: "year" }),
      profile,
    );
    expect(zero.reasons.some((r) => r.includes("não divulgada"))).toBe(true);
  });

  it("converts a foreign currency before judging it", () => {
    const fx = {
      base: "USD",
      date: "2026-08-18",
      rates: { PHP: 61.78, CAD: 1.3874 },
    };
    // PHP 150k/year is about USD 2.4k — far below floor, though the raw number
    // looks like a healthy salary.
    const php = scoreJob(
      job({ compMax: 150000, compCurrency: "PHP", compPeriod: "annual" }),
      profile,
      fx,
    );
    expect(php.compScore).toBe(0);

    // CAD 330k is about USD 238k — top of the range.
    const cad = scoreJob(
      job({ compMax: 330000, compCurrency: "CAD", compPeriod: "1 YEAR" }),
      profile,
      fx,
    );
    expect(cad.compScore).toBe(8);
  });

  it("cannot annualise a fixed-price project without a duration", () => {
    const noDuration = scoreJob(
      job({ compMax: 30000, compCurrency: "USD", compPeriod: "project" }),
      profile,
    );
    expect(noDuration.reasons.some((r) => r.includes("sem duração"))).toBe(true);

    const withDuration = scoreJob(
      job({
        compMax: 30000,
        compCurrency: "USD",
        compPeriod: "project",
        compDurationMonths: 2,
      }),
      profile,
    );
    // 30k over 2 months is a 180k/year pace — above target.
    expect(withDuration.compScore).toBeGreaterThan(6);
  });
});

describe("overall fit", () => {
  it("keeps the score inside 0..100", () => {
    const perfect = scoreJob(
      job({
        title: "AI Solutions Architect",
        locationRaw: "Remote - Brazil",
        descriptionText:
          "Multi-agent, RAG, evals, guardrails, observability, distributed systems, multi-tenant SaaS, technical leadership, TypeScript, Python, AWS. 12+ years.",
        compMax: 250000,
        compPeriod: "year",
      }),
      profile,
    );
    expect(perfect.fit).toBeGreaterThan(70);
    expect(perfect.fit).toBeLessThanOrEqual(100);

    const worst = scoreJob(
      job({ title: "Junior QA Analyst", locationRaw: "On-site, Ohio", descriptionText: "Manual testing of WordPress." }),
      profile,
    );
    expect(worst.fit).toBeGreaterThanOrEqual(0);
  });

  it("always explains itself", () => {
    const result = scoreJob(job({ title: "Staff Software Engineer" }), profile);
    expect(result.reasons.length).toBeGreaterThanOrEqual(5);
  });
});
