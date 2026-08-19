import { describe, expect, it } from "vitest";
import { externalIdFor, findJobAnchors, splitAnchorText } from "../src/core/sources/careers.ts";

const BASE = "https://acme.com/careers";

describe("splitAnchorText", () => {
  it("keeps the role and drops the call to action", () => {
    // Taking the raw anchor text produces "Account Executive London Read more",
    // which matches no target cluster and scores zero for a formatting reason.
    const r = splitAnchorText("Account Executive, Commercial\nLondon\nRead more");
    expect(r.title).toBe("Account Executive, Commercial");
    expect(r.location).toBe("London");
  });

  it("joins several office lines", () => {
    const r = splitAnchorText("Staff Engineer\nAustin\nNew York");
    expect(r.location).toBe("Austin · New York");
  });

  it("returns no location when the anchor is only a title", () => {
    expect(splitAnchorText("Staff Engineer").location).toBeNull();
  });

  it("drops a location line that is really a paragraph", () => {
    // A long tail is the posting summary, not an office.
    const long = "x".repeat(200);
    expect(splitAnchorText(`Staff Engineer\n${long}`).location).toBeNull();
  });

  it("strips the call to action even when it is the only tail", () => {
    expect(splitAnchorText("Staff Engineer\nRead more").location).toBeNull();
  });
});

describe("findJobAnchors", () => {
  it("finds postings by URL shape, not by class name", () => {
    // Every site names its markup differently; a job URL almost always says so.
    const html = `
      <a href="/careers/staff-engineer">Staff Engineer</a>
      <a href="/jobs/123-backend">Backend Engineer</a>
      <a href="/about">About us</a>
      <a href="/blog/hiring">Our hiring post</a>`;
    const found = findJobAnchors(html, BASE);
    expect(found.map((a) => a.text)).toEqual(["Staff Engineer", "Backend Engineer"]);
  });

  it("ignores navigation that happens to sit on a job path", () => {
    const html = `<a href="/careers/all">View all</a><a href="/careers/eng-lead">Eng Lead</a>`;
    expect(findJobAnchors(html, BASE).map((a) => a.text)).toEqual(["Eng Lead"]);
  });

  it("resolves relative links against the listing page", () => {
    const found = findJobAnchors('<a href="/careers/x-1">Role</a>', BASE);
    expect(found[0]!.href).toBe("https://acme.com/careers/x-1");
  });

  it("deduplicates the same posting linked twice", () => {
    const html = `<a href="/jobs/a-1">Role</a><a href="/jobs/a-1">Role again</a>`;
    expect(findJobAnchors(html, BASE)).toHaveLength(1);
  });

  it("refuses non-http schemes", () => {
    // `javascript:` and `mailto:` links appear on real careers pages.
    const html = `<a href="javascript:void(0)">/jobs/fake</a><a href="mailto:a@b.com">/jobs/x</a>`;
    expect(findJobAnchors(html, BASE)).toHaveLength(0);
  });

  it("accepts Portuguese paths", () => {
    const found = findJobAnchors('<a href="/vagas/engenheiro-senior">Engenheiro Sênior</a>', BASE);
    expect(found).toHaveLength(1);
  });
});

describe("externalIdFor", () => {
  it("derives a stable id from the path", () => {
    expect(externalIdFor("https://acme.com/careers/staff-engineer")).toBe("careers-staff-engineer");
  });

  it("is unaffected by a trailing slash", () => {
    expect(externalIdFor("https://acme.com/jobs/a-1/")).toBe(externalIdFor("https://acme.com/jobs/a-1"));
  });

  it("falls back to the raw string for an unparseable URL", () => {
    expect(externalIdFor("nao é uma url")).toBe("nao é uma url");
  });
});
