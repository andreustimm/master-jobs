import { describe, expect, it } from "vitest";
import { matchEvidence, significantTerms } from "../src/core/apply/dossier.ts";

describe("significantTerms", () => {
  it("keeps distinctive words and drops filler", () => {
    const terms = significantTerms("Built platforms with Kubernetes and Datadog for the team");
    expect(terms).toContain("kubernetes");
    expect(terms).toContain("datadog");
    expect(terms).not.toContain("with");
    expect(terms).not.toContain("the");
  });

  it("keeps technology names with punctuation intact", () => {
    const terms = significantTerms("Node.js, C#, and CI/CD pipelines");
    expect(terms.some((t) => t.startsWith("node"))).toBe(true);
  });

  it("deduplicates", () => {
    expect(significantTerms("kubernetes kubernetes kubernetes")).toEqual(["kubernetes"]);
  });

  it("handles accented Portuguese", () => {
    expect(significantTerms("arquitetura de sistemas distribuídos")).toContain("distribuídos");
  });
});

describe("matchEvidence", () => {
  const evidence = {
    ai_platforms: ["Built agent orchestration platforms with retries and audit trail"],
    legacy: ["Migrated a COBOL mainframe to a modern stack"],
  };

  it("surfaces evidence whose own words appear in the posting", () => {
    const posting = "We need someone to build an agent orchestration platform for enterprises.";
    const matched = matchEvidence(evidence, posting);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.area).toBe("ai_platforms");
    expect(matched[0]!.matched).toEqual(expect.arrayContaining(["agent", "orchestration"]));
  });

  it("requires more than one shared word", () => {
    // One word in common is coincidence. Claiming relevance from it would put
    // an irrelevant line in front of the user at the moment they are writing.
    const posting = "We build platforms.";
    expect(matchEvidence(evidence, posting)).toHaveLength(0);
  });

  it("ranks the strongest overlap first", () => {
    const rich = {
      weak: ["agent orchestration systems"],
      strong: ["agent orchestration platform with retries, audit trail and isolation"],
    };
    const posting = "agent orchestration platform with retries and audit trail and isolation";
    expect(matchEvidence(rich, posting)[0]!.area).toBe("strong");
  });

  it("claims nothing when nothing matches", () => {
    // Rule 6: only what is in `evidence:` may be cited, and only when it fits.
    expect(matchEvidence(evidence, "We are hiring a pastry chef.")).toEqual([]);
  });

  it("is case-insensitive", () => {
    const posting = "AGENT ORCHESTRATION PLATFORM".toLowerCase();
    expect(matchEvidence(evidence, posting).length).toBeGreaterThan(0);
  });
});
