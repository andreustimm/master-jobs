import { describe, expect, it } from "vitest";
import { compareJobVocabulary } from "../src/contexts/skills/app/compare-job.ts";
import type { SkillDefinition } from "../src/contexts/skills/domain/types.ts";

const catalog: SkillDefinition[] = [
  {
    slug: "observability",
    name: "Observability",
    category: "practice",
    aliases: ["observability", "datadog", "rollbar"],
  },
  {
    slug: "kubernetes",
    name: "Kubernetes",
    category: "cloud",
    aliases: ["kubernetes", "k8s"],
  },
  { slug: "kafka", name: "Kafka", category: "data", aliases: ["kafka"] },
];

describe("single-job CV vocabulary comparison", () => {
  it("separates exact coverage, a synonym opportunity and missing evidence", async () => {
    const report = await compareJobVocabulary(
      {
        cvText: "Operated Kubernetes platforms and instrumented services with Datadog.",
        jobText: "This role requires Kubernetes, observability, and Kafka.",
      },
      { catalog: { all: async () => catalog } },
    );

    expect(report.totalJobs).toBe(1);
    expect(report.items.find((item) => item.skill.slug === "kubernetes")?.kind).toBe(
      "covered",
    );
    expect(report.items.find((item) => item.skill.slug === "observability")).toMatchObject({
      kind: "vocabulary",
      marketTerm: "observability",
      cvTerms: ["datadog"],
    });
    expect(report.items.find((item) => item.skill.slug === "kafka")?.kind).toBe("missing");
    expect(report.coverage).toMatchObject({ covered: 1, vocabulary: 1, missing: 1 });
  });
});
