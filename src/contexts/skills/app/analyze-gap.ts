/**
 * Use case: which words does the market use that this CV does not?
 *
 * Orchestration only — fetch the catalogue and the target corpus through ports,
 * call the pure analysis, return. The interesting part lives in `domain/gap.ts`
 * and is testable without a database.
 */
import { analyzeGap, measureDemand, type GapReport } from "../domain/gap.ts";
import type { SkillCatalogPort, TargetCorpusPort } from "../ports.ts";

export type AnalyzeGapInput = {
  candidateId: number;
  /** The CV or profile text to compare against the market. */
  cvText: string;
  /**
   * Only jobs at or above this fit define "the market". Comparing against the
   * whole corpus would measure the vocabulary of jobs the candidate does not
   * want — 2.491 of them are not even in a target cluster.
   */
  minFit?: number;
  /** Cap on jobs read, newest-best first. Keeps the analysis quick. */
  limit?: number;
  /** Ignore skills asked by fewer than this share of target jobs. */
  minDemand?: number;
};

export type AnalyzeGapDeps = {
  catalog: Pick<SkillCatalogPort, "all">;
  corpus: TargetCorpusPort;
};

export async function analyzeVocabularyGap(
  input: AnalyzeGapInput,
  deps: AnalyzeGapDeps,
): Promise<GapReport> {
  const catalog = await deps.catalog.all();
  const texts = await deps.corpus.targetTexts({
    candidateId: input.candidateId,
    minFit: input.minFit ?? 60,
    limit: input.limit ?? 400,
  });

  const demand = measureDemand(catalog, texts);
  return analyzeGap(catalog, input.cvText, demand, texts.length, {
    minDemand: input.minDemand,
  });
}
