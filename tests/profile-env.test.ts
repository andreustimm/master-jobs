import { describe, expect, it } from "vitest";
import { expandEnv } from "../src/core/profile/load.ts";

/**
 * Personal contact details must not sit in a versioned file: Git keeps
 * history, so removing an address after publishing does not remove it.
 */
describe("expandEnv", () => {
  it("substitutes a defined variable", () => {
    const r = expandEnv("email: ${JHO_CANDIDATE_EMAIL}", { JHO_CANDIDATE_EMAIL: "a@b.com" });
    expect(r.text).toBe("email: a@b.com");
    expect(r.missing).toEqual([]);
  });

  it("expands a missing variable to empty and reports it", () => {
    // Deliberately not an exception: refusing to load the profile would stop
    // scoring, sourcing and the entire CLI over a contact field no ranking
    // depends on.
    const r = expandEnv('email: "${JHO_CANDIDATE_EMAIL}"', {});
    expect(r.text).toBe('email: ""');
    expect(r.missing).toEqual(["JHO_CANDIDATE_EMAIL"]);
  });

  it("treats an empty value as missing", () => {
    expect(expandEnv("x: ${FOO}", { FOO: "" }).missing).toEqual(["FOO"]);
  });

  it("reports each missing variable once", () => {
    expect(expandEnv("${A} ${A} ${B}", {}).missing).toEqual(["A", "B"]);
  });

  it("leaves text without references untouched", () => {
    const yaml = "name: Andreus\nprice: $100\nshell: ${lowercase}";
    expect(expandEnv(yaml, {}).text).toBe(yaml);
  });

  it("does not expand lowercase or malformed references", () => {
    // Only SCREAMING_CASE is a variable, so ordinary text with braces survives.
    expect(expandEnv("${notAVar} ${1BAD}", {}).missing).toEqual([]);
  });
});

describe("the real profile", () => {
  it("keeps no personal e-mail under version control", async () => {
    const { readFile } = await import("node:fs/promises");
    const yaml = await readFile("profile/profile.yaml", "utf8");
    expect(yaml).not.toMatch(/[\w.+-]+@(?:gmail|hotmail|outlook|yahoo|icloud)\.com/i);
    expect(yaml).toContain("${JHO_CANDIDATE_EMAIL}");
  });
});
