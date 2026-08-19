/**
 * The skills context, composed.
 *
 * Callers get one function and never see a port. Dependency injection here is
 * plain function composition — no container, which would be illegal anyway
 * under the erasable-TypeScript constraint (ADR 0006).
 */
import { analyzeVocabularyGap, type AnalyzeGapInput } from "./app/analyze-gap.ts";
import { extractCandidateSkills, type ExtractSkillsInput, type ExtractSkillsResult } from "./app/extract-skills.ts";
import type { GapReport } from "./domain/gap.ts";
import {
  drizzleCandidateSkills,
  drizzleCatalog,
  drizzleTargetCorpus,
} from "./infra/drizzle-adapters.ts";

export { extractSkills, groupByCategory } from "./domain/extractor.ts";
export { DEFAULT_STRATEGIES, aliasStrategy, appliedStrategy, declaredStrategy } from "./domain/strategies.ts";
export type { Detection, ExtractionStrategy, SkillDefinition } from "./domain/types.ts";
export { analyzeGap, measureDemand } from "./domain/gap.ts";
export type { GapItem, GapKind, GapReport } from "./domain/gap.ts";

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
