import { afterEach, describe, expect, it } from "vitest";
import { fingerprint } from "../src/core/ingest/normalize.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { getAdapter } from "../src/core/sources/registry.ts";

/**
 * Adapter tests without a network.
 *
 * These could not exist before the HTTP port: verifying "Lever returns an empty
 * string where the description should be" required Lever to be reachable and
 * unchanged. That is how the `??`-versus-empty-string bug survived long enough
 * to blank 4.538 descriptions — no test could have caught it, so none did.
 */

afterEach(() => resetHttpPort());

describe("lever", () => {
  it("recovers the description when descriptionPlain is an empty string", async () => {
    // The exact shape of the historical bug, now a regression test.
    setHttpPort(
      fixtureHttp({
        "api.lever.co": [
          {
            id: "abc-123",
            text: "Staff Engineer",
            hostedUrl: "https://jobs.lever.co/acme/abc-123",
            applyUrl: "https://jobs.lever.co/acme/abc-123/apply",
            categories: { location: "Remote" },
            descriptionPlain: "",
            description: "<p>We build agent infrastructure for enterprises.</p>",
            lists: [{ text: "Requirements", content: "<li>Eight years of backend</li>" }],
            createdAt: 1_700_000_000_000,
          },
        ],
      }),
    );

    const result = await getAdapter("lever").fetchJobs({
      kind: "lever",
      handle: "acme",
      label: "Acme",
    });

    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0]!;
    expect(job.title).toBe("Staff Engineer");
    // The whole point: an empty string must not win over real content.
    expect(job.descriptionText ?? "").not.toBe("");
    expect(job.descriptionText).toContain("agent infrastructure");
  });

  it("reads the lists block, where Lever keeps the requirements", async () => {
    setHttpPort(
      fixtureHttp({
        "api.lever.co": [
          {
            id: "x",
            text: "Engineer",
            hostedUrl: "https://jobs.lever.co/acme/x",
            categories: {},
            descriptionPlain: "Short intro.",
            description: "<p>Short intro.</p>",
            lists: [{ text: "You will", content: "<li>Design distributed systems</li>" }],
          },
        ],
      }),
    );

    const result = await getAdapter("lever").fetchJobs({ kind: "lever", handle: "acme", label: "Acme" });
    expect(result.jobs[0]!.descriptionText).toContain("distributed systems");
  });
});

describe("greenhouse", () => {
  it("unescapes the HTML Greenhouse double-encodes", async () => {
    setHttpPort(
      fixtureHttp({
        "boards-api.greenhouse.io": {
          jobs: [
            {
              id: 42,
              title: "Principal Engineer",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/42",
              location: { name: "Remote - Americas" },
              content: "&lt;p&gt;Build &amp;amp; scale platforms.&lt;/p&gt;",
              updated_at: "2026-08-01T00:00:00Z",
            },
          ],
        },
      }),
    );

    const result = await getAdapter("greenhouse").fetchJobs({
      kind: "greenhouse",
      handle: "acme",
      label: "Acme",
    });

    const job = result.jobs[0]!;
    expect(job.title).toBe("Principal Engineer");
    expect(job.descriptionText).toContain("Build");
    // Left encoded, the scorer would read literal "&lt;p&gt;" as content.
    expect(job.descriptionText).not.toContain("&lt;");
  });
});

describe("SmartRecruiters and Recruitee registry fixtures", () => {
  it("normalizes a SmartRecruiters listing through the registry", async () => {
    const fixtures = fixtureHttp({
      "api.smartrecruiters.com": {
        content: [
          {
            id: "principal-1",
            name: " Principal Architect ",
            location: { city: "São Paulo", region: "SP", country: "br" },
          },
        ],
      },
    });
    setHttpPort(fixtures);

    const result = await getAdapter("smartrecruiters").fetchJobs({
      kind: "smartrecruiters",
      handle: "verified-fixture",
      label: "Acme",
    });

    expect(fixtures.calls).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      title: "Principal Architect",
      url: "https://jobs.smartrecruiters.com/verified-fixture/principal-1",
      locationRaw: "São Paulo, SP, br",
      descriptionHtml: null,
      descriptionText: null,
    });
  });

  it("joins Recruitee description and requirements through the registry", async () => {
    const fixtures = fixtureHttp({
      "fixture.recruitee.com/api/offers": {
        offers: [
          {
            id: 55,
            title: "Staff Engineer",
            slug: "staff-engineer",
            careers_url: "https://fixture.recruitee.com/o/staff-engineer",
            careers_apply_url: "https://fixture.recruitee.com/o/staff-engineer/c/new",
            description: "<p>Build the platform.</p>",
            requirements: "<ul><li>Run Kubernetes in production.</li></ul>",
          },
        ],
      },
    });
    setHttpPort(fixtures);

    const result = await getAdapter("recruitee").fetchJobs({
      kind: "recruitee",
      handle: "fixture",
      label: "Acme",
    });

    expect(fixtures.calls).toHaveLength(1);
    expect(result.jobs[0]!.descriptionText).toContain("Build the platform");
    expect(result.jobs[0]!.descriptionText).toContain("Kubernetes in production");
    expect(result.jobs[0]!.applyUrl).toBe(
      "https://fixture.recruitee.com/o/staff-engineer/c/new",
    );
  });

  it("keeps partial fields nullable and accepts an empty envelope", async () => {
    setHttpPort(
      fixtureHttp({
        "api.smartrecruiters.com": { content: [{ id: "partial", name: "Partial role" }] },
      }),
    );
    const partial = await getAdapter("smartrecruiters").fetchJobs({
      kind: "smartrecruiters",
      handle: "fixture",
      label: "Acme",
    });
    expect(partial.jobs[0]).toMatchObject({
      locationRaw: null,
      remote: null,
      descriptionHtml: null,
      descriptionText: null,
    });

    setHttpPort(fixtureHttp({ "fixture.recruitee.com/api/offers": {} }));
    await expect(
      getAdapter("recruitee").fetchJobs({
        kind: "recruitee",
        handle: "fixture",
        label: "Acme",
      }),
    ).resolves.toEqual({ jobs: [], warnings: [] });
  });

  it("keeps normalized fingerprints stable when listing order changes", async () => {
    const postings = [
      {
        id: "one",
        name: "Staff Engineer (Remote - LATAM)",
        location: { city: "Remote", region: "LATAM" },
      },
      {
        id: "two",
        name: "Principal Architect",
        location: { city: "São Paulo", country: "br" },
      },
    ];
    const config = { kind: "smartrecruiters", handle: "fixture", label: "Acme" } as const;

    setHttpPort(fixtureHttp({ "api.smartrecruiters.com": { content: postings } }));
    const first = await getAdapter("smartrecruiters").fetchJobs(config);
    setHttpPort(fixtureHttp({ "api.smartrecruiters.com": { content: [...postings].reverse() } }));
    const second = await getAdapter("smartrecruiters").fetchJobs(config);

    expect(first.jobs.map(fingerprint).sort()).toEqual(second.jobs.map(fingerprint).sort());
  });
});

describe("careers", () => {
  it("reads a server-rendered listing and names the employer from config", async () => {
    const body = "Sobre esta vaga. ".repeat(40);
    setHttpPort(
      fixtureHttp({
        "acme.test/careers/staff-engineer": `<html><body><div class="job-description"><h1>Staff Engineer</h1><p>${body}</p><p>Full-time, fully remote.</p></div></body></html>`,
        "acme.test/careers": `<html><body>
          <a href="/careers/staff-engineer">Staff Engineer\nRemote</a>
          <a href="/about">About</a>
        </body></html>`,
        "acme.test/robots.txt": "User-agent: *\nDisallow: /admin",
      }),
    );

    const result = await getAdapter("careers").fetchJobs({
      kind: "careers",
      handle: "https://acme.test/careers",
      label: "Acme Corp",
    });

    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0]!;
    // The employer's name is the entire reason this adapter exists.
    expect(job.companyName).toBe("Acme Corp");
    expect(job.title).toBe("Staff Engineer");
    expect(job.locationRaw).toBe("Remote");
    expect(job.descriptionText).toContain("Sobre esta vaga");
  });

  it("warns instead of failing when the list is built in the browser", async () => {
    setHttpPort(
      fixtureHttp({
        "spa.test/careers": "<html><body><div id='root'></div></body></html>",
        "spa.test/robots.txt": "",
      }),
    );

    const result = await getAdapter("careers").fetchJobs({
      kind: "careers",
      handle: "https://spa.test/careers",
      label: "SPA Inc",
    });

    expect(result.jobs).toEqual([]);
    expect(result.warnings.join(" ")).toContain("snippet");
  });

  it("does not fetch what robots.txt forbids", async () => {
    // The invariant from ADR 0001 and 0009, asserted rather than trusted.
    const fixtures = fixtureHttp({
      "blocked.test/robots.txt": "User-agent: *\nDisallow: /careers",
      "blocked.test/careers": "<a href='/careers/x'>Role</a>",
    });
    setHttpPort(fixtures);

    const result = await getAdapter("careers").fetchJobs({
      kind: "careers",
      handle: "https://blocked.test/careers",
      label: "Blocked",
    });

    expect(result.jobs).toEqual([]);
    expect(result.warnings.join(" ")).toContain("robots.txt");
    // And it must not have requested the page anyway.
    expect(fixtures.calls.some((c) => c.endsWith("/careers"))).toBe(false);
  });
});
