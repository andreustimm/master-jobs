import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprint } from "../src/core/ingest/normalize.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { locationRestriction } from "../src/core/scoring/score.ts";
import { scoreJob } from "./support/score-now.ts";
import { himalayas } from "../src/core/sources/aggregators.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";

let profile: Profile;

beforeEach(async () => {
  profile = await loadProfile(true);
});

afterEach(() => resetHttpPort());

const remoteJob = (locationRaw: string, descriptionText = "Distributed systems, TypeScript and LLM products.") => ({
  title: "Senior Software Engineer",
  companyName: "Acme",
  locationRaw,
  remote: true,
  descriptionText,
});

describe("a location that says who may apply", () => {
  it("reads 'X only' as the regions allowed to apply, and anything else as neutral", () => {
    expect(locationRestriction("United States only")).toEqual({ regions: ["united states"] });
    expect(locationRestriction("Spain, Portugal only")).toEqual({ regions: ["spain", "portugal"] });
    expect(locationRestriction("Latin America only")).toEqual({ regions: ["latam"] });
    expect(locationRestriction("Remote only")).toBeUndefined();
    expect(locationRestriction("United States")).toBeUndefined();
    expect(locationRestriction(null)).toBeUndefined();
  });

  it("reads the restriction sentence in the description when the location is a bare list", () => {
    const description = "Build the billing platform.\n\nLocation restricted to: United States, Canada only.";
    expect(locationRestriction("United States, Canada", description)).toEqual({ regions: ["united states", "canada"] });
    // Only the sentence the adapter writes counts: prose that happens to say "only" does not.
    expect(locationRestriction("Remote", "English only. We hire in the United States only.")).toBeUndefined();
  });

  it("blocks a remote job restricted to countries the candidate cannot work from", () => {
    for (const location of ["United States only", "Spain only"]) {
      const result = scoreJob(remoteJob(location), profile);
      expect(result.eligibility.status, location).toBe("ineligible");
      expect(result.geoScore, location).toBe(0);
      expect(result.blockers.length, location).toBeGreaterThan(0);
    }
  });

  it("keeps eligible a restriction that includes Brazil, LATAM or the Americas", () => {
    for (const location of ["Brazil only", "United States, Brazil only", "Latin America only", "Americas only"]) {
      const result = scoreJob(remoteJob(location), profile);
      expect(result.eligibility.status, location).toBe("eligible");
      expect(result.blockers, location).toEqual([]);
    }
  });

  it("a plain location without 'only' scores as before: no blocker from missing data", () => {
    const result = scoreJob(remoteJob("United States"), profile);
    expect(result.eligibility.status).toBe("unverifiable");
    expect(result.blockers).toEqual([]);
  });

  it("answers in linear time on hostile provider text", () => {
    const started = performance.now();
    locationRestriction(`a${" ".repeat(50_000)}b`, `Location restricted to: a${" ".repeat(50_000)}b`);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("Himalayas states the restriction without touching the posting's identity", () => {
  it("keeps the bare country list as location and writes who may apply in the description", async () => {
    const page = JSON.parse(readFileSync("tests/fixtures/term-search/himalayas-laravel-page1.json", "utf8")) as {
      jobs: Array<Record<string, unknown>>;
      totalCount: number;
    };
    const unrestricted = { ...page.jobs[1], guid: "unrestricted", locationRestrictions: [] };
    setHttpPort(fixtureHttp({ "himalayas.app": { jobs: [page.jobs[0], page.jobs[1], unrestricted], totalCount: 3 } }));

    const result = await himalayas.termSearch!.search("laravel", { limit: 20, reserve: async () => true });
    const [openToBrazil, guyana, anywhere] = result.jobs;

    // Location feeds the fingerprint: a suffix here would insert every restricted job again.
    expect(guyana!.locationRaw).toBe("Guyana");
    expect(fingerprint(guyana!)).toBe(fingerprint({ ...guyana!, descriptionText: "anything" }));
    expect(guyana!.descriptionText).toMatch(/\n\nLocation restricted to: Guyana only\.$/);
    expect(openToBrazil!.descriptionText).toMatch(/Location restricted to: .*\bBrazil\b.* only\.$/);
    expect(anywhere!.locationRaw).toBe("Remote");
    expect(anywhere!.descriptionText).not.toContain("Location restricted to");

    const score = (job: typeof guyana) => scoreJob(remoteJob(job!.locationRaw!, job!.descriptionText!), profile);
    expect(score(openToBrazil).eligibility.status).toBe("eligible");
    expect(score(guyana).eligibility.status).toBe("ineligible");
    expect(score(anywhere).blockers).toEqual([]);
  });
});
