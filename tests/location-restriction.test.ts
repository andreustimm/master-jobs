import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { locationRestriction, scoreJob } from "../src/core/scoring/score.ts";
import { himalayas } from "../src/core/sources/aggregators.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";

let profile: Profile;

beforeEach(async () => {
  profile = await loadProfile(true);
});

afterEach(() => resetHttpPort());

const remoteJob = (locationRaw: string) => ({
  title: "Senior Software Engineer",
  companyName: "Acme",
  locationRaw,
  remote: true,
  descriptionText: "Distributed systems, TypeScript and LLM products.",
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
});

describe("Himalayas writes its restriction the way the site shows it", () => {
  it("maps locationRestrictions to 'X only' and an unrestricted job to Remote", async () => {
    const page = JSON.parse(readFileSync("tests/fixtures/term-search/himalayas-laravel-page1.json", "utf8")) as {
      jobs: Array<Record<string, unknown>>;
      totalCount: number;
    };
    const unrestricted = { ...page.jobs[1], guid: "unrestricted", locationRestrictions: [] };
    setHttpPort(fixtureHttp({ "himalayas.app": { jobs: [page.jobs[0], page.jobs[1], unrestricted], totalCount: 3 } }));

    const result = await himalayas.termSearch!.search("laravel", { limit: 20, reserve: async () => true });

    expect(result.jobs[0]!.locationRaw).toMatch(/, Brazil, .* only$/);
    expect(result.jobs[1]!.locationRaw).toBe("Guyana only");
    expect(result.jobs[2]!.locationRaw).toBe("Remote");
    expect(scoreJob({ ...remoteJob(result.jobs[0]!.locationRaw!) }, profile).eligibility.status).toBe("eligible");
    expect(scoreJob({ ...remoteJob(result.jobs[1]!.locationRaw!) }, profile).eligibility.status).toBe("ineligible");
  });
});
