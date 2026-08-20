import { describe, expect, it } from "vitest";
import {
  auditCandidateSkill,
  listCandidateSkills,
} from "../src/contexts/skills/app/candidate-skills.ts";
import {
  listSkillCatalog,
  seedSkillCatalog,
} from "../src/contexts/skills/app/catalog.ts";
import { measureSkillDemand } from "../src/contexts/skills/app/measure-skill-demand.ts";
import { SKILL_CATALOG } from "../src/contexts/skills/domain/catalog.ts";
import { SKILL_CATEGORIES } from "../src/contexts/skills/domain/types.ts";
import type {
  CandidateSkillView,
  SkillDefinition,
} from "../src/contexts/skills/domain/types.ts";

const catalog: SkillDefinition[] = [
  { slug: "python", name: "Python", category: "language", aliases: ["py"] },
  { slug: "go", name: "Go", category: "language", aliases: ["golang"] },
];

const candidateRows: CandidateSkillView[] = [
  {
    id: 7,
    slug: "python",
    name: "Python",
    category: "language",
    status: "confirmed",
    source: "cv",
    evidence: "Built services in Python",
    occurrences: 3,
    level: null,
    auditedAt: "2026-08-19T12:00:00.000Z",
  },
  {
    id: 8,
    slug: "go",
    name: "Go",
    category: "language",
    status: "detected",
    source: "cv",
    evidence: "Golang",
    occurrences: 1,
    level: null,
    auditedAt: null,
  },
];

describe("skills catalogue use cases", () => {
  it("seeds the complete typed catalogue through its port", async () => {
    let received: readonly SkillDefinition[] = [];
    const result = await seedSkillCatalog({
      catalog: {
        async sync(entries) {
          received = entries;
          return { inserted: entries.length, updated: 0 };
        },
      },
    });

    expect(result.inserted).toBe(100);
    expect(received).toBe(SKILL_CATALOG);
    expect(received.every((entry) => SKILL_CATEGORIES.includes(entry.category))).toBe(true);
  });

  it("filters listing in the application layer", async () => {
    await expect(
      listSkillCatalog("language", { catalog: { all: async () => catalog } }),
    ).resolves.toEqual(catalog);
    await expect(
      listSkillCatalog("cloud", { catalog: { all: async () => catalog } }),
    ).resolves.toEqual([]);
  });
});

describe("candidate skill use cases", () => {
  it("keeps candidate scope in list and audit operations", async () => {
    let listedCandidate: number | undefined;
    const detected = await listCandidateSkills(
      { candidateId: 42, status: "detected" },
      {
        store: {
          async list(candidateId) {
            listedCandidate = candidateId;
            return candidateRows;
          },
        },
      },
    );
    expect(listedCandidate).toBe(42);
    expect(detected.map((row) => row.slug)).toEqual(["go"]);

    let auditScope: { candidateId: number; id: number } | undefined;
    await auditCandidateSkill(
      { candidateId: 42, id: 8, status: "confirmed", by: "owner" },
      {
        store: {
          async audit(candidateId, id) {
            auditScope = { candidateId, id };
            return true;
          },
        },
      },
    );
    expect(auditScope).toEqual({ candidateId: 42, id: 8 });
  });

  it("fails loudly when a scoped audit changes no row", async () => {
    await expect(
      auditCandidateSkill(
        { candidateId: 42, id: 999, status: "rejected" },
        { store: { audit: async () => false } },
      ),
    ).rejects.toThrow("not found for candidate 42");
  });
});

describe("market demand use case", () => {
  it("uses the canonical matcher and candidate-scoped corpus", async () => {
    let corpusScope: unknown;
    const result = await measureSkillDemand(
      { candidateId: 42, minFit: 70, corpusLimit: 12 },
      {
        catalog: { all: async () => catalog },
        candidates: { list: async () => candidateRows },
        corpus: {
          async targetTexts(opts) {
            corpusScope = opts;
            return ["Python platform", "We are going forward"];
          },
        },
      },
    );

    expect(corpusScope).toEqual({ candidateId: 42, minFit: 70, limit: 12 });
    expect(result).toEqual([
      {
        slug: "python",
        name: "Python",
        category: "language",
        demand: 0.5,
        postings: 1,
        candidateStatus: "confirmed",
      },
    ]);
  });
});
