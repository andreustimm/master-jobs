import { describe, expect, it } from "vitest";
import { parsePayload } from "../src/core/ingest/import.ts";

describe("parsePayload", () => {
  it("finds the job array whatever the envelope is called", () => {
    for (const key of ["positions", "jobs", "data", "results", "content", "items"]) {
      const r = parsePayload({ [key]: [{ title: "Engineer", url: "https://x.com/1" }] });
      expect(r.jobs, `envelope: ${key}`).toHaveLength(1);
    }
  });

  it("accepts a bare array", () => {
    const r = parsePayload([{ title: "Engineer", url: "https://x.com/1" }]);
    expect(r.jobs).toHaveLength(1);
  });

  it("digs one level deeper when the array is nested", () => {
    const r = parsePayload({ data: { positions: [{ title: "Engineer", url: "https://x.com/1" }] } });
    expect(r.jobs).toHaveLength(1);
  });

  it("reads values out of nested objects", () => {
    // Revelo-shaped: company and location are objects, not strings.
    const r = parsePayload({
      positions: [
        {
          id: "abc",
          title: "Senior AI Software Architect",
          company: { name: "Acme" },
          location: { name: "Remote - LATAM" },
          url: "https://x.com/abc",
        },
      ],
    });
    expect(r.jobs[0]?.companyName).toBe("Acme");
    expect(r.jobs[0]?.locationRaw).toBe("Remote - LATAM");
  });

  it("matches field names case-insensitively", () => {
    const r = parsePayload([
      { Title: "Engineer", CompanyName: "Acme", URL: "https://x.com/1" },
    ]);
    expect(r.jobs[0]?.title).toBe("Engineer");
    expect(r.jobs[0]?.companyName).toBe("Acme");
  });

  it("builds a URL from an id when the payload has no link", () => {
    const r = parsePayload({ positions: [{ id: "xyz", title: "Engineer" }] }, {
      baseUrl: "https://app.careers.revelo.com/#/international/positions",
    });
    expect(r.jobs[0]?.url).toBe(
      "https://app.careers.revelo.com/#/international/positions/xyz",
    );
  });

  it("converts an HTML description to text", () => {
    const r = parsePayload([
      {
        title: "Engineer",
        url: "https://x.com/1",
        description: "<p>Build <strong>RAG</strong> pipelines</p>",
      },
    ]);
    expect(r.jobs[0]?.descriptionText).toContain("RAG");
    expect(r.jobs[0]?.descriptionText).not.toContain("<");
    expect(r.jobs[0]?.descriptionHtml).toContain("<p>");
  });

  it("parses compensation, including a currency and period", () => {
    const r = parsePayload([
      {
        title: "Engineer",
        url: "https://x.com/1",
        salaryMin: 9000,
        salaryMax: 13000,
        currency: "USD",
        salaryPeriod: "monthly",
      },
    ]);
    const j = r.jobs[0];
    expect(j?.compMin).toBe(9000);
    expect(j?.compMax).toBe(13000);
    expect(j?.compCurrency).toBe("USD");
    expect(j?.compPeriod).toBe("monthly");
  });

  it("skips entries with no usable title and reports it", () => {
    const r = parsePayload([
      { title: "Good", url: "https://x.com/1" },
      { description: "no title here" },
    ]);
    expect(r.jobs).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.warnings.join(" ")).toContain("ignorada");
  });

  it("reports fields it did not map, so the user can tell us about them", () => {
    const r = parsePayload([
      { title: "Engineer", url: "https://x.com/1", englishLevel: "advanced", seniorityLevel: "senior" },
    ]);
    expect(r.unmappedFields).toContain("englishLevel");
    expect(r.unmappedFields).toContain("seniorityLevel");
  });

  it("warns when nothing carried a description", () => {
    // A listing endpoint returns summaries; the keyword scorer would read zero.
    const r = parsePayload([{ title: "Engineer", url: "https://x.com/1" }]);
    expect(r.warnings.join(" ")).toContain("keywords");
  });

  it("returns a clear message when the payload holds no jobs at all", () => {
    const r = parsePayload({ meta: { total: 0 } });
    expect(r.jobs).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("Nenhum array");
  });
});
