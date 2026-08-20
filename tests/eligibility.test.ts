import { describe, expect, it } from "vitest";
import {
  evaluateEligibility,
  type MatchPolicy,
} from "../src/contexts/matching/index.ts";

const policy: MatchPolicy = {
  workAuthorization: ["Brazil"],
  needsVisaSponsorshipFor: ["US", "Canada", "UK", "EU"],
  contractModels: ["b2b", "contractor", "cnpj"],
  remoteOnly: true,
  acceptableRegions: ["worldwide", "global", "latam", "americas", "brazil", "remote"],
  maxTimezoneOffsetHours: 6,
};

describe("MatchPolicy eligibility", () => {
  it("keeps missing source data neutral", () => {
    expect(evaluateEligibility(policy)).toEqual({
      status: "unverifiable",
      reasons: ["data-unavailable"],
    });
  });

  it("accepts compatible authorization, region, timezone and contract", () => {
    expect(evaluateEligibility(policy, {
      workAuthorization: ["Brazil"],
      regions: ["LATAM"],
      timezoneOffsetHours: 3,
      contractModels: ["B2B"],
      remote: true,
    }).status).toBe("eligible");
  });

  it("rejects authorization without sponsorship", () => {
    const result = evaluateEligibility(policy, {
      workAuthorization: ["US"],
      sponsorship: "not_offered",
    });
    expect(result.status).toBe("ineligible");
    expect(result.reasons).toContain("sponsorship-unavailable");
  });

  it("accepts an otherwise unavailable authorization when sponsorship is offered", () => {
    expect(evaluateEligibility(policy, {
      workAuthorization: ["US"],
      sponsorship: "offered",
    }).status).toBe("eligible");
  });

  it("rejects incompatible region, timezone and contract", () => {
    const result = evaluateEligibility(policy, {
      regions: ["Japan"],
      timezoneOffsetHours: 10,
      contractModels: ["w2"],
    });
    expect(result.status).toBe("ineligible");
    expect(result.reasons).toHaveLength(3);
  });
});
