import { describe, expect, it } from "vitest";
import {
  contentHash,
  fingerprint,
  normalizeLocation,
  normalizeTitle,
  slugifyCompany,
  toIsoDate,
} from "../src/core/ingest/normalize.ts";
import type { RawJob } from "../src/core/sources/types.ts";

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    externalId: "1",
    companyName: "Acme Inc.",
    title: "Staff Software Engineer",
    url: "https://example.com/1",
    locationRaw: "Remote - LATAM",
    raw: {},
    ...overrides,
  };
}

describe("slugifyCompany", () => {
  it("strips legal suffixes so the same company matches across sources", () => {
    expect(slugifyCompany("Acme Inc.")).toBe(slugifyCompany("Acme LLC"));
    expect(slugifyCompany("Acme Technologies Ltd")).toBe("acme");
  });

  it("removes diacritics", () => {
    expect(slugifyCompany("São Paulo Tech")).toBe("sao-paulo-tech");
  });
});

describe("normalizeTitle", () => {
  it("drops board-specific decorations", () => {
    expect(normalizeTitle("Staff Engineer (Remote, LATAM)")).toBe("staff engineer");
    expect(normalizeTitle("Software Engineer (m/w/d)")).toBe("software engineer");
    expect(normalizeTitle("Backend Engineer #27294")).toBe("backend engineer");
  });

  it("keeps meaningful technical characters", () => {
    expect(normalizeTitle("C++ Engineer")).toContain("c++");
    expect(normalizeTitle("C# Developer")).toContain("c#");
  });
});

describe("normalizeLocation", () => {
  it("collapses orderings of the same location", () => {
    expect(normalizeLocation("Remote - LATAM")).toBe(normalizeLocation("LATAM (Remote)"));
  });

  it("treats a missing location as empty", () => {
    expect(normalizeLocation(null)).toBe("");
    expect(normalizeLocation(undefined)).toBe("");
  });
});

describe("fingerprint", () => {
  it("collapses the same posting seen through two different sources", () => {
    const viaAshby = raw({ externalId: "abc", url: "https://jobs.ashbyhq.com/acme/abc" });
    const viaAggregator = raw({ externalId: "999", url: "https://himalayas.app/jobs/999" });
    expect(fingerprint(viaAshby)).toBe(fingerprint(viaAggregator));
  });

  it("separates the same title opened in different regions", () => {
    const latam = raw({ locationRaw: "Remote - LATAM" });
    const us = raw({ locationRaw: "Remote - US only" });
    expect(fingerprint(latam)).not.toBe(fingerprint(us));
  });

  it("separates different roles at the same company", () => {
    expect(fingerprint(raw({ title: "Staff Engineer" }))).not.toBe(
      fingerprint(raw({ title: "Principal Engineer" })),
    );
  });
});

describe("contentHash", () => {
  it("is stable when nothing meaningful changed", () => {
    expect(contentHash(raw())).toBe(contentHash(raw()));
  });

  it("changes when the posting is edited", () => {
    const before = raw({ descriptionText: "We need an architect." });
    const after = raw({ descriptionText: "We need an architect with RAG experience." });
    expect(contentHash(before)).not.toBe(contentHash(after));
  });

  it("changes when compensation is added", () => {
    expect(contentHash(raw())).not.toBe(contentHash(raw({ compMin: 150000 })));
  });
});

describe("toIsoDate", () => {
  it("passes through valid dates and rejects junk", () => {
    expect(toIsoDate("2026-08-18T00:00:00Z")).toBe("2026-08-18T00:00:00.000Z");
    expect(toIsoDate("not a date")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});
