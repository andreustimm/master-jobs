import { describe, expect, it } from "vitest";
import { describeUnfetchable, detectJobUrl } from "../src/core/ingest/detect.ts";

describe("detectJobUrl", () => {
  it("recognises Greenhouse job boards on both hostnames", () => {
    const a = detectJobUrl("https://job-boards.greenhouse.io/stackblitz/jobs/4111216009");
    expect(a?.kind).toBe("greenhouse");
    expect(a?.handle).toBe("stackblitz");
    expect(a?.externalId).toBe("4111216009");

    const b = detectJobUrl("https://boards.greenhouse.io/stackblitz/jobs/4111216009");
    expect(b?.handle).toBe("stackblitz");
  });

  it("recognises Lever with and without a posting id", () => {
    const withId = detectJobUrl(
      "https://jobs.lever.co/jobgether/92481833-175e-4d8f-894f-ccde4ccfc3ce",
    );
    expect(withId?.kind).toBe("lever");
    expect(withId?.handle).toBe("jobgether");
    expect(withId?.externalId).toBe("92481833-175e-4d8f-894f-ccde4ccfc3ce");

    const boardOnly = detectJobUrl("https://jobs.lever.co/jobgether");
    expect(boardOnly?.handle).toBe("jobgether");
    expect(boardOnly?.externalId).toBeUndefined();
  });

  it("recognises Ashby, the source of several benchmark roles", () => {
    const d = detectJobUrl(
      "https://jobs.ashbyhq.com/textlayer/8dbad922-0f0d-48b9-bd4c-fb860d8455c6",
    );
    expect(d?.kind).toBe("ashby");
    expect(d?.handle).toBe("textlayer");
    expect(d?.externalId).toBe("8dbad922-0f0d-48b9-bd4c-fb860d8455c6");
  });

  it("recognises Ashby apply URLs, which carry a trailing segment", () => {
    const d = detectJobUrl(
      "https://jobs.ashbyhq.com/paires/4d2844ff-b108-490e-b22a-6f4f727a0f57/application",
    );
    expect(d?.kind).toBe("ashby");
    expect(d?.handle).toBe("paires");
  });

  it("recognises Recruitee subdomains", () => {
    const d = detectJobUrl("https://acme.recruitee.com/o/senior-engineer");
    expect(d?.kind).toBe("recruitee");
    expect(d?.handle).toBe("acme");
  });

  it("returns null for boards we cannot read", () => {
    expect(detectJobUrl("https://www.linkedin.com/jobs/view/4231234567")).toBeNull();
    expect(detectJobUrl("https://acme.com/careers/staff-engineer")).toBeNull();
  });

  it("derives a display label from the handle", () => {
    expect(detectJobUrl("https://jobs.ashbyhq.com/text-layer/abc123def456789a")?.label).toBe(
      "Text Layer",
    );
  });
});

describe("describeUnfetchable", () => {
  it("names hosts that are recognisable but have no public job API", () => {
    expect(describeUnfetchable("https://www.linkedin.com/jobs/view/123")).toBe("LinkedIn");
    expect(describeUnfetchable("https://cloudera.wd5.myworkdayjobs.com/x/job/y")).toBe("Workday");
    expect(describeUnfetchable("https://jobs.gem.com/11x-ai/abc")).toBe("Gem");
    expect(describeUnfetchable("https://app.loxo.co/job/abc")).toBe("Loxo");
  });

  it("returns null for an unknown host", () => {
    expect(describeUnfetchable("https://acme.com/careers")).toBeNull();
  });
});
