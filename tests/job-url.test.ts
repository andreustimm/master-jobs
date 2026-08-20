import { describe, expect, it } from "vitest";
import {
  isPublicJobUrl,
  publicApplyUrl,
  publicPostingUrl,
} from "../src/core/job-url.ts";

describe("public job URL", () => {
  it("accepts only valid HTTP(S) navigation targets", () => {
    expect(isPublicJobUrl("https://jobs.example.test/role")).toBe(true);
    expect(isPublicJobUrl("http://localhost/role")).toBe(true);
    expect(isPublicJobUrl("manual://local/abc")).toBe(false);
    expect(isPublicJobUrl("https://")).toBe(false);
    expect(isPublicJobUrl(null)).toBe(false);
  });

  it("prefers a public apply URL and falls back to the posting", () => {
    expect(
      publicApplyUrl({
        url: "https://jobs.example.test/role",
        applyUrl: "https://apply.example.test/role",
      }),
    ).toBe("https://apply.example.test/role");
    expect(
      publicApplyUrl({
        url: "https://jobs.example.test/role",
        applyUrl: "manual://local/abc",
      }),
    ).toBe("https://jobs.example.test/role");
    expect(publicApplyUrl({ url: "manual://local/abc" })).toBeNull();
  });

  it("keeps posting and application destinations distinct", () => {
    const job = {
      url: "https://jobs.example.test/role",
      applyUrl: "https://apply.example.test/role",
    };
    expect(publicPostingUrl(job)).toBe(job.url);
    expect(publicApplyUrl(job)).toBe(job.applyUrl);
  });
});
