import { describe, expect, it } from "vitest";
import { extractSkills, groupByCategory } from "../src/contexts/skills/domain/extractor.ts";
import { aliasStrategy, appliedStrategy, declaredStrategy } from "../src/contexts/skills/domain/strategies.ts";
import { buildSectionMap, contextAt, findOccurrences } from "../src/contexts/skills/domain/text.ts";
import type { SkillDefinition } from "../src/contexts/skills/domain/types.ts";

const CATALOG: SkillDefinition[] = [
  { slug: "go", name: "Go", category: "language", aliases: ["golang"] },
  { slug: "python", name: "Python", category: "language", aliases: ["python"] },
  { slug: "kafka", name: "Kafka", category: "data", aliases: ["kafka"] },
  { slug: "nodejs", name: "Node.js", category: "framework", aliases: ["node.js", "nodejs"] },
  { slug: "csharp", name: "C#", category: "language", aliases: ["c#", "csharp"] },
  { slug: "observability", name: "Observability", category: "practice", aliases: ["observability", "datadog"] },
];

/* --------------------------------------------------------------- text ---- */

describe("findOccurrences", () => {
  it("respects word boundaries", () => {
    // The classic failure: "go" firing inside "going".
    expect(findOccurrences("we are going forward", "go")).toHaveLength(0);
    expect(findOccurrences("we use Go daily", "go")).toHaveLength(1);
  });

  it("handles the characters real technology names contain", () => {
    expect(findOccurrences("built in C# and F#", "c#")).toHaveLength(1);
    expect(findOccurrences("Node.js backend", "node.js")).toHaveLength(1);
    expect(findOccurrences("CI/CD pipeline", "ci/cd")).toHaveLength(1);
  });

  it("is case-insensitive and finds every occurrence", () => {
    expect(findOccurrences("Python, python and PYTHON", "python")).toHaveLength(3);
  });

  it("does not match inside a longer word", () => {
    expect(findOccurrences("javascript", "java")).toHaveLength(0);
  });
});

describe("buildSectionMap", () => {
  const cv = [
    "# Andreus",
    "## SUMMARY",
    "Architect with 20 years.",
    "## PROFESSIONAL EXPERIENCE",
    "* Built pipelines in Python",
    "## KEY TECHNOLOGIES",
    "Go, Kafka",
  ].join("\n");

  it("labels each offset with its section", () => {
    const map = buildSectionMap(cv);
    expect(contextAt(map, cv.indexOf("Architect with"))).toBe("summary");
    expect(contextAt(map, cv.indexOf("Built pipelines"))).toBe("experience");
    expect(contextAt(map, cv.indexOf("Go, Kafka"))).toBe("skills-section");
  });

  it("recognises Portuguese headings too", () => {
    const pt = ["## EXPERIÊNCIA PROFISSIONAL", "* Construí APIs"].join("\n");
    expect(contextAt(buildSectionMap(pt), pt.indexOf("Construí"))).toBe("experience");
  });
});

/* --------------------------------------------------------- strategies ---- */

const CV = [
  "## SUMMARY",
  "Senior architect. Interested in Kafka.",
  "## PROFESSIONAL EXPERIENCE",
  "* Built ETL pipelines in Python across three teams",
  "* Designed services in Go with observability via Datadog",
  "## KEY TECHNOLOGIES",
  "Python, Go, Node.js",
].join("\n");

describe("strategies", () => {
  it("alias finds every mention regardless of section", () => {
    const hits = aliasStrategy.extract(CV, CATALOG);
    const python = hits.find((h) => h.skillSlug === "python");
    expect(python?.mentions.length).toBe(2); // experience + technologies
  });

  it("declared only reports the technologies list", () => {
    const hits = declaredStrategy.extract(CV, CATALOG);
    const kafka = hits.find((h) => h.skillSlug === "kafka");
    expect(kafka).toBeUndefined(); // Kafka is only in the summary
    expect(hits.find((h) => h.skillSlug === "go")).toBeDefined();
  });

  it("applied only reports work bullets", () => {
    const hits = appliedStrategy.extract(CV, CATALOG);
    expect(hits.find((h) => h.skillSlug === "python")).toBeDefined();
    // Listed under technologies but never used in a bullet.
    expect(hits.find((h) => h.skillSlug === "nodejs")).toBeUndefined();
  });
});

/* ---------------------------------------------------------- extractor ---- */

describe("extractSkills", () => {
  it("ranks demonstrated use above a bare mention", () => {
    const results = extractSkills(CV, CATALOG);
    const python = results.find((r) => r.skill.slug === "python");
    const kafka = results.find((r) => r.skill.slug === "kafka");

    expect(python).toBeDefined();
    expect(kafka).toBeDefined();
    // Python is used in a bullet AND listed; Kafka is a passing mention.
    expect(python!.confidence).toBeGreaterThan(kafka!.confidence);
  });

  it("explains itself in a rationale a human can audit", () => {
    const python = extractSkills(CV, CATALOG).find((r) => r.skill.slug === "python");
    expect(python?.rationale).toContain("experiência");
    expect(python?.rationale).toContain("tecnologias");
  });

  it("flags a mention with no supporting context", () => {
    const kafka = extractSkills(CV, CATALOG).find((r) => r.skill.slug === "kafka");
    expect(kafka?.rationale).toContain("menção solta");
    expect(kafka!.confidence).toBeLessThan(0.55);
  });

  it("prefers a work sentence as evidence over a stack list", () => {
    const go = extractSkills(CV, CATALOG).find((r) => r.skill.slug === "go");
    // "Designed services in Go..." settles the question; "Python, Go, Node.js" does not.
    expect(go?.evidence).toContain("Designed services");
  });

  it("finds a skill through an alias the CV never spells out", () => {
    // The CV says Datadog, never "observability" — which is the term 51% of
    // the target postings use. Catching that is the point of aliases.
    const obs = extractSkills(CV, CATALOG).find((r) => r.skill.slug === "observability");
    expect(obs).toBeDefined();
    expect(obs?.mentions.some((m) => m.alias === "datadog")).toBe(true);
  });

  it("deduplicates the same occurrence reported by several strategies", () => {
    const python = extractSkills(CV, CATALOG).find((r) => r.skill.slug === "python");
    // Three strategies see the bullet; it is still one mention.
    const offsets = python!.mentions.map((m) => m.offset);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it("honours a confidence floor", () => {
    const strict = extractSkills(CV, CATALOG, { minConfidence: 0.7 });
    expect(strict.find((r) => r.skill.slug === "kafka")).toBeUndefined();
  });

  it("returns nothing for empty input rather than throwing", () => {
    expect(extractSkills("", CATALOG)).toEqual([]);
    expect(extractSkills(CV, [])).toEqual([]);
  });

  it("never fires Go on the word 'going'", () => {
    const text = "## PROFESSIONAL EXPERIENCE\n* We are going to scale the team";
    expect(extractSkills(text, CATALOG).find((r) => r.skill.slug === "go")).toBeUndefined();
  });

  it("groups by category for display", () => {
    const grouped = groupByCategory(extractSkills(CV, CATALOG));
    expect(grouped.get("language")?.length).toBeGreaterThan(0);
  });
});
