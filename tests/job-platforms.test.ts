import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { scoreJob } from "../src/core/scoring/score.ts";
import { hackernews } from "../src/core/sources/hackernews.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import { jobicy } from "../src/core/sources/jobicy.ts";
import type { RawJob } from "../src/core/sources/types.ts";
import { workable } from "../src/core/sources/workable.ts";

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/term-search/${name}`, "utf8")) as Record<string, unknown>;

let profile: Profile;
beforeEach(async () => {
  profile = await loadProfile(true);
});
afterEach(() => resetHttpPort());

/** Counts the reservations a search asks for, refusing after `allow`. */
function reserver(allow = Number.POSITIVE_INFINITY) {
  let calls = 0;
  return { reserve: async () => ++calls <= allow, calls: () => calls };
}

const eligibility = (job: RawJob) =>
  scoreJob({ ...job, locationRaw: job.locationRaw ?? null, descriptionText: job.descriptionText ?? null }, profile).eligibility.status;

describe("Jobicy (real response, 2026-09-19)", () => {
  it("reads the feed for the candidate's reach and keeps the README's terms", async () => {
    const http = fixtureHttp({ "jobicy.com": fixture("jobicy-typescript-latam.json") });
    setHttpPort(http);

    const { jobs } = await jobicy.fetchJobs({ kind: "jobicy", handle: "", label: "Jobicy" });

    expect(http.calls[0]).toContain("geo=latam");
    expect(http.options[0]).toEqual({ retries: 0 });
    expect(jobs.length).toBeGreaterThan(3);
    // Applications go to the feed's own URL, as the README asks.
    expect(jobs.every((job) => job.applyUrl === job.url && job.url.startsWith("https://jobicy.com/jobs/"))).toBe(true);
    expect(jobs.every((job) => /^\d+$/.test(job.externalId))).toBe(true);
  });

  it("states `jobGeo` as who may apply: Argentina alone blocks, a list with Brazil or Anywhere does not", async () => {
    setHttpPort(fixtureHttp({ "jobicy.com": fixture("jobicy-typescript-latam.json") }));
    const { jobs } = await jobicy.fetchJobs({ kind: "jobicy", handle: "latam", label: "Jobicy" });

    const argentina = jobs.find((job) => job.locationRaw === "Argentina")!;
    const withBrazil = jobs.find((job) => job.locationRaw === "Brazil, Canada, USA")!;
    const anywhere = jobs.find((job) => job.locationRaw === "Anywhere")!;
    expect(argentina.descriptionText).toMatch(/Location restricted to: Argentina only\.$/);
    expect(eligibility(argentina)).toBe("ineligible");
    expect(eligibility(withBrazil)).toBe("eligible");
    expect(anywhere.descriptionText).not.toContain("Location restricted to");
  });

  it("keeps disclosed pay, and absent pay stays null", async () => {
    setHttpPort(fixtureHttp({ "jobicy.com": fixture("jobicy-typescript-latam.json") }));
    const { jobs } = await jobicy.fetchJobs({ kind: "jobicy", handle: "latam", label: "Jobicy" });

    const paid = jobs.find((job) => job.compMax !== null)!;
    expect(paid).toMatchObject({ compCurrency: "USD", compPeriod: "yearly" });
    expect(jobs.some((job) => job.compMax === null && job.compCurrency === null)).toBe(true);
  });

  it("searches by tag within LATAM with one reservation, and spends nothing on a tag the API refuses", async () => {
    const http = fixtureHttp({ "jobicy.com": fixture("jobicy-typescript-latam.json") });
    setHttpPort(http);
    const quota = reserver();

    const found = await jobicy.termSearch!.search("typescript", { limit: 100, reserve: quota.reserve });
    expect(quota.calls()).toBe(1);
    expect(http.calls[0]).toMatch(/tag=typescript/);
    expect(http.calls[0]).toMatch(/geo=latam/);
    expect(found.jobs.length).toBeGreaterThan(0);

    const tooShort = await jobicy.termSearch!.search("go", { limit: 100, reserve: quota.reserve });
    expect(tooShort.jobs).toEqual([]);
    expect(quota.calls()).toBe(1);
    expect(http.calls).toHaveLength(1);

    const refused = await jobicy.termSearch!.search("react", { limit: 100, reserve: reserver(0).reserve });
    expect(refused.stoppedByQuota).toBe(true);
  });
});

describe("Workable (real response, 2026-09-19)", () => {
  const pages = () =>
    fixtureHttp({
      // The second page first: every URL contains the host.
      "pageToken=": fixture("workable-typescript-page2.json"),
      "jobs.workable.com": fixture("workable-typescript-page1.json"),
    });

  it("searches remote jobs in Brazil and follows the page token to the end", async () => {
    const http = pages();
    setHttpPort(http);
    const quota = reserver();

    const found = await workable.termSearch!.search("typescript", { limit: 100, reserve: quota.reserve });

    expect(found.jobs).toHaveLength(5);
    expect(found.totalHint).toBe(5);
    expect(quota.calls()).toBe(2);
    expect(http.calls[0]).toMatch(/location=Brazil/);
    expect(http.calls[0]).toMatch(/workplace=remote/);
    expect(http.calls[0]).toMatch(/query=typescript/);
    expect(http.calls[1]).toMatch(/pageToken=/);
    expect(http.options.every((opts) => opts?.retries === 0)).toBe(true);
  });

  it("maps the employer, the country and the workplace from the structured fields", async () => {
    setHttpPort(pages());
    const found = await workable.termSearch!.search("typescript", { limit: 100, reserve: reserver().reserve });

    const first = found.jobs[0]!;
    expect(first.companyName).toBe("AOA");
    expect(first.remote).toBe(true);
    expect(first.locationRaw).toContain("Brazil");
    expect(first.descriptionText).toMatch(/Senior Frontend Engineer/);
    expect(found.jobs.every((job) => job.applyUrl === job.url)).toBe(true);
  });

  it("stops at the reservation the ledger refuses and keeps what it already read", async () => {
    setHttpPort(pages());
    const found = await workable.termSearch!.search("typescript", { limit: 100, reserve: reserver(1).reserve });
    expect(found.stoppedByQuota).toBe(true);
    expect(found.jobs).toHaveLength(3);
  });

  it("reads the feed with the handle as the search text", async () => {
    const http = pages();
    setHttpPort(http);
    const { jobs } = await workable.fetchJobs({ kind: "workable", handle: "software", label: "Workable" });
    expect(jobs).toHaveLength(5);
    expect(http.calls[0]).toMatch(/query=software/);
  });
});

describe("Hacker News \"Who is hiring?\" (real thread, September 2026)", () => {
  const thread = () =>
    fixtureHttp({
      search_by_date: fixture("hn-stories.json"),
      "/search?": fixture("hn-thread.json"),
    });

  it("reads the month's hiring thread, not the \"Who wants to be hired?\" one", async () => {
    const http = thread();
    setHttpPort(http);
    await hackernews.fetchJobs({ kind: "hackernews", handle: "", label: "Hacker News" });
    expect(http.calls[1]).toContain("story_49522897");
  });

  it("keeps top-level postings in the pipe convention and drops seekers, prose and replies", async () => {
    setHttpPort(thread());
    const { jobs } = await hackernews.fetchJobs({ kind: "hackernews", handle: "", label: "Hacker News" });

    expect(jobs.map((job) => job.companyName).sort()).toEqual(["Lumen Labs", "Ours Privacy", "Pango", "Squoosh.AI"]);
    const pango = jobs.find((job) => job.companyName === "Pango")!;
    expect(pango.title).toBe("Founding Software Engineer");
    expect(pango.locationRaw).toBe("On-site (hybrid) in Stockholm, Sweden");
    expect(pango.url).toBe(`https://news.ycombinator.com/item?id=${pango.externalId}`);
    // Hex entities decoded: "Robotics &#x2F; Hardware Engineer".
    expect(jobs.find((job) => job.companyName === "Lumen Labs")!.title).toBe("Robotics / Hardware Engineer");
    // "REMOTE" inside the role still says the job is remote.
    expect(jobs.find((job) => job.companyName === "Squoosh.AI")!.remote).toBe(true);
  });

  it("searches the thread with two reservations and reports none left when refused", async () => {
    const http = thread();
    setHttpPort(http);
    const quota = reserver();

    const found = await hackernews.termSearch!.search("laravel", { limit: 100, reserve: quota.reserve });
    expect(quota.calls()).toBe(2);
    expect(http.calls[1]).toMatch(/query=laravel/);
    expect(found.jobs.every((job) => job.url.startsWith("https://news.ycombinator.com/item?id="))).toBe(true);

    const refused = await hackernews.termSearch!.search("laravel", { limit: 100, reserve: reserver(1).reserve });
    expect(refused.stoppedByQuota).toBe(true);
  });

  it("says so when there is no hiring thread", async () => {
    setHttpPort(fixtureHttp({ search_by_date: { hits: [] } }));
    const result = await hackernews.fetchJobs({ kind: "hackernews", handle: "", label: "Hacker News" });
    expect(result.jobs).toEqual([]);
    expect(result.warnings[0]).toMatch(/no "Who is hiring\?" thread/);
  });
});
