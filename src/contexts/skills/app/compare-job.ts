/**
 * Use case: which skills named by one job are evidenced in the current CV?
 *
 * This deliberately does not produce the canonical fit score. Fit is graded
 * against the structured profile by `core/scoring`; this report answers the
 * different, complementary question of whether the current CV uses the same
 * vocabulary as this specific posting.
 */
import { analyzeGap, measureDemand, type GapReport } from "../domain/gap.ts";
import type { SkillCatalogPort } from "../ports.ts";

export type CompareJobVocabularyInput = {
  cvText: string;
  jobText: string;
};

export type CompareJobVocabularyDeps = {
  catalog: Pick<SkillCatalogPort, "all">;
};

export async function compareJobVocabulary(
  input: CompareJobVocabularyInput,
  deps: CompareJobVocabularyDeps,
): Promise<GapReport> {
  const catalog = await deps.catalog.all();
  const demand = measureDemand(catalog, [input.jobText]);
  return analyzeGap(catalog, input.cvText, demand, 1, { minDemand: 0 });
}
