/**
 * The skills context, composed.
 *
 * Callers get one function and never see a port. Dependency injection here is
 * plain function composition — no container, which would be illegal anyway
 * under the erasable-TypeScript constraint (ADR 0006).
 */
import { analyzeVocabularyGap, type AnalyzeGapInput } from "./app/analyze-gap.ts";
import {
  auditCandidateSkill,
  listCandidateSkills,
} from "./app/candidate-skills.ts";
import { listSkillCatalog, seedSkillCatalog } from "./app/catalog.ts";
import {
  compareJobVocabulary,
  type CompareJobVocabularyInput,
} from "./app/compare-job.ts";
import {
  extractCandidateSkills,
  type ExtractSkillsInput,
  type ExtractSkillsResult,
} from "./app/extract-skills.ts";
import {
  measureSkillDemand,
  type MeasureSkillDemandInput,
} from "./app/measure-skill-demand.ts";
import type { GapReport } from "./domain/gap.ts";
import type {
  SkillAuditStatus,
  SkillCategory,
  SkillStatus,
} from "./domain/types.ts";
import {
  drizzleCandidateSkills,
  drizzleCatalog,
  drizzleTargetCorpus,
} from "./infra/drizzle-adapters.ts";

export { extractSkills, groupByCategory } from "./domain/extractor.ts";
export { DEFAULT_STRATEGIES, aliasStrategy, appliedStrategy, declaredStrategy } from "./domain/strategies.ts";
export { SKILL_CATALOG } from "./domain/catalog.ts";
export {
  findSkillOccurrences,
  matchesSkillTerm,
  skillTermRegex,
  skillTerms,
} from "./domain/matcher.ts";
export {
  SKILL_CATEGORIES,
  SKILL_SOURCES,
  SKILL_STATUSES,
  isSkillCategory,
  isSkillSource,
  isSkillStatus,
  parseSkillCategory,
  parseSkillSource,
  parseSkillStatus,
} from "./domain/types.ts";
export type {
  CandidateSkillView,
  Detection,
  ExtractionStrategy,
  MarketSkillDemand,
  SkillAuditStatus,
  SkillCategory,
  SkillDefinition,
  SkillSource,
  SkillStatus,
} from "./domain/types.ts";
export { analyzeGap, measureDemand } from "./domain/gap.ts";
export type { GapItem, GapKind, GapReport } from "./domain/gap.ts";

export function seedCatalog(): Promise<{ inserted: number; updated: number }> {
  return seedSkillCatalog({ catalog: drizzleCatalog });
}

export function listCatalog(category?: SkillCategory) {
  return listSkillCatalog(category, { catalog: drizzleCatalog });
}

export function candidateSkills(candidateId: number, status?: SkillStatus) {
  return listCandidateSkills({ candidateId, status }, { store: drizzleCandidateSkills });
}

export function auditSkill(
  candidateId: number,
  id: number,
  status: SkillAuditStatus,
  opts: { level?: string; by?: string } = {},
): Promise<void> {
  return auditCandidateSkill(
    { candidateId, id, status, ...opts },
    { store: drizzleCandidateSkills },
  );
}

export function skillDemand(input: MeasureSkillDemandInput) {
  return measureSkillDemand(input, {
    catalog: drizzleCatalog,
    candidates: drizzleCandidateSkills,
    corpus: drizzleTargetCorpus,
  });
}

/** The wired use case, for application code. */
export function skillExtraction(input: ExtractSkillsInput): Promise<ExtractSkillsResult> {
  return extractCandidateSkills(input, {
    catalog: drizzleCatalog,
    store: drizzleCandidateSkills,
  });
}

/** The wired gap analysis, for application code. */
export function vocabularyGap(input: AnalyzeGapInput): Promise<GapReport> {
  return analyzeVocabularyGap(input, {
    catalog: drizzleCatalog,
    corpus: drizzleTargetCorpus,
  });
}

/** Compare one posting with the wording of the current candidate document. */
export function jobVocabularyComparison(
  input: CompareJobVocabularyInput,
): Promise<GapReport> {
  return compareJobVocabulary(input, { catalog: drizzleCatalog });
}
