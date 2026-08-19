import { describe, expect, it } from "vitest";
import { analyzeGap, measureDemand } from "../src/contexts/skills/domain/gap.ts";
import type { SkillDefinition } from "../src/contexts/skills/domain/types.ts";

const CATALOG: SkillDefinition[] = [
  { slug: "observability", name: "Observability", category: "practice", aliases: ["observability", "datadog", "rollbar"] },
  { slug: "kubernetes", name: "Kubernetes", category: "cloud", aliases: ["kubernetes", "k8s"] },
  { slug: "kafka", name: "Kafka", category: "data", aliases: ["kafka"] },
  { slug: "cobol", name: "COBOL", category: "language", aliases: ["cobol"] },
];

describe("measureDemand", () => {
  it("counts documents, not mentions", () => {
    // A verbose posting must not outweigh ten terse ones: one employer asking
    // for Kubernetes eleven times is still one employer.
    const jobs = ["kubernetes kubernetes kubernetes kubernetes", "kubernetes"];
    const d = measureDemand(CATALOG, jobs).find((x) => x.slug === "kubernetes")!;
    expect(d.jobCount).toBe(2);
  });

  it("ranks spellings by how often the market uses them", () => {
    const jobs = ["we need k8s", "k8s experience", "kubernetes required"];
    const d = measureDemand(CATALOG, jobs).find((x) => x.slug === "kubernetes")!;
    expect(d.termsByFrequency[0]!.term).toBe("k8s");
    expect(d.termsByFrequency[0]!.count).toBe(2);
  });

  it("respects word boundaries", () => {
    // "go" must not fire on "google"; here: no alias hides inside a longer word.
    const d = measureDemand(CATALOG, ["we use kafkaesque naming"]).find((x) => x.slug === "kafka")!;
    expect(d.jobCount).toBe(0);
  });

  it("reports zero for a skill nobody asks for", () => {
    const d = measureDemand(CATALOG, ["modern stack"]).find((x) => x.slug === "cobol")!;
    expect(d.jobCount).toBe(0);
    expect(d.termsByFrequency).toEqual([]);
  });
});

describe("analyzeGap", () => {
  const jobs = [
    "observability and kubernetes",
    "observability engineer",
    "observability, kafka",
    "kubernetes and kafka",
  ];
  const demand = measureDemand(CATALOG, jobs);

  it("separates a vocabulary gap from a real gap", () => {
    // The whole point of the file: the CV proves the experience under a
    // spelling the market does not search for. That is a find-and-replace,
    // not a career gap.
    const cv = "Instrumented services with Datadog and Rollbar. Deployed on Kubernetes.";
    const report = analyzeGap(CATALOG, cv, demand, jobs.length, { minDemand: 0 });

    const obs = report.items.find((i) => i.skill.slug === "observability")!;
    expect(obs.kind).toBe("vocabulary");
    expect(obs.marketTerm).toBe("observability");
    expect(obs.cvTerms).toEqual(["datadog", "rollbar"]);

    const kafka = report.items.find((i) => i.skill.slug === "kafka")!;
    expect(kafka.kind).toBe("missing");

    const k8s = report.items.find((i) => i.skill.slug === "kubernetes")!;
    expect(k8s.kind).toBe("covered");
  });

  it("puts only vocabulary gaps in quickWins", () => {
    const report = analyzeGap(CATALOG, "Datadog and Rollbar.", demand, jobs.length, { minDemand: 0 });
    expect(report.quickWins.map((i) => i.skill.slug)).toEqual(["observability"]);
    expect(report.realGaps.map((i) => i.skill.slug)).toContain("kafka");
  });

  it("prices a rewrite by how much of the market asks for it", () => {
    const report = analyzeGap(CATALOG, "Datadog.", demand, jobs.length, { minDemand: 0 });
    const obs = report.quickWins[0]!;
    // 3 of 4 jobs ask for observability -> 75.
    expect(obs.rewriteValue).toBe(75);
    // Nothing else earns a rewrite value.
    expect(report.items.filter((i) => i.kind !== "vocabulary").every((i) => i.rewriteValue === 0)).toBe(true);
  });

  it("drops skills below the demand floor", () => {
    // One mention in a large corpus is noise, not a market signal.
    const many = [...jobs, ...Array.from({ length: 96 }, () => "generic posting")];
    const d = measureDemand(CATALOG, many);
    const report = analyzeGap(CATALOG, "", d, many.length, { minDemand: 0.05 });
    expect(report.items.find((i) => i.skill.slug === "cobol")).toBeUndefined();
  });

  it("ignores skills nobody asks for, however absent from the CV", () => {
    const report = analyzeGap(CATALOG, "", demand, jobs.length, { minDemand: 0 });
    expect(report.items.some((i) => i.skill.slug === "cobol")).toBe(false);
  });

  it("weights coverage by demand rather than counting skills", () => {
    // Speaking the word 80% of jobs use is worth more than one 6% use. A plain
    // count would flatter the CV.
    const report = analyzeGap(CATALOG, "kubernetes", demand, jobs.length, { minDemand: 0 });
    expect(report.coverage.covered).toBe(1);
    expect(report.coverage.weighted).toBeGreaterThan(0);
    expect(report.coverage.weighted).toBeLessThan(1);
  });

  it("returns an empty report rather than dividing by zero", () => {
    const report = analyzeGap(CATALOG, "anything", [], 0);
    expect(report.items).toEqual([]);
    expect(report.coverage.weighted).toBe(0);
  });

  it("sorts by market demand, not alphabetically", () => {
    const report = analyzeGap(CATALOG, "", demand, jobs.length, { minDemand: 0 });
    const counts = report.items.map((i) => i.jobCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});
