import type { cockpitPtBR } from "./cockpit.pt-BR.ts";
import type { Translated } from "./shape.ts";

/**
 * Cockpit, the home dashboard.
 *
 * Part of the `en.ts` dictionary; typed against `cockpit.pt-BR.ts`, so a missing key is a
 * compile error.
 */
export const cockpitEn: Translated<typeof cockpitPtBR> = {
  cockpit: {
    eyebrow: "COCKPIT",
    title: "What deserves your time today",
    lead: "Deterministic ranking against your profile. Each bar shows",
    leadStrong: "where the score came from",
    leadTail:
      "— a high fit held up by eligibility and salary alone is usually a false positive.",
    openJobs: "open jobs",
    companies: "companies",
    namedEmployer: "named employer",
    unblocked: "no blockers",
    lastThreeDays: "last 3 days",
    bestFit: "best fit",
    inPipeline: "in pipeline",
    topRanked: "Top ranked",
    matching: "{count} matching",
    seeAll: "see all",
    openJobsHint: "Every open job, with no score cut and no filter",
    companiesHint: "Every company in the catalog",
    withinCutHint: "Within the score cut and the filters on this screen",
    bestFitHint: "The highest score on your primary track",
    inPipelineHint: "Applications at any pipeline stage",
  },
};
