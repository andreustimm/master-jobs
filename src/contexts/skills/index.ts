/**
 * The skills context, composed.
 *
 * Callers get one function and never see a port. Dependency injection here is
 * plain function composition — no container, which would be illegal anyway
 * under the erasable-TypeScript constraint (ADR 0006).
 */
import { extractCandidateSkills, type ExtractSkillsInput, type ExtractSkillsResult } from "./app/extract-skills.ts";
import { drizzleCandidateSkills, drizzleCatalog } from "./infra/drizzle-adapters.ts";

export { extractSkills, groupByCategory } from "./domain/extractor.ts";
export { DEFAULT_STRATEGIES, aliasStrategy, appliedStrategy, declaredStrategy } from "./domain/strategies.ts";
export type { Detection, ExtractionStrategy, SkillDefinition } from "./domain/types.ts";

/** The wired use case, for application code. */
export function skillExtraction(input: ExtractSkillsInput): Promise<ExtractSkillsResult> {
  return extractCandidateSkills(input, {
    catalog: drizzleCatalog,
    store: drizzleCandidateSkills,
  });
}
