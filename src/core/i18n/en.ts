import { accountEn } from "./account.en.ts";
import { adminEn } from "./admin.en.ts";
import { candidateEn } from "./candidate.en.ts";
import { cockpitEn } from "./cockpit.en.ts";
import { emailEn } from "./email.en.ts";
import { filtersEn } from "./filters.en.ts";
import { jobDetailEn } from "./job-detail.en.ts";
import { jobsEn } from "./jobs.en.ts";
import { operationsEn } from "./operations.en.ts";
import { pipelineEn } from "./pipeline.en.ts";
import { publicProfileEn } from "./public-profile.en.ts";
import { recruiterEn } from "./recruiter.en.ts";
import { recruiterAccessEn } from "./recruiter-access.en.ts";
import { scoringEn } from "./scoring.en.ts";
import { searchesEn } from "./searches.en.ts";
import { shellEn } from "./shell.en.ts";
import type { Dictionary } from "./pt-BR.ts";

/**
 * English.
 *
 * Typed as `Dictionary`, so a missing key is a compile error rather than a
 * blank space someone finds in production.
 *
 * Translated, not transliterated: "Frescor" becomes "Freshness" because that
 * is what the scoring component measures, and "Funil" becomes "Pipeline"
 * because that is what the funnel is called in English-language recruiting —
 * "Funnel" would read as marketing.
 *
 * The text lives in per-area fragments, `<area>.en.ts` next to its
 * `<area>.pt-BR.ts`; this file only joins them. A section left out here is a
 * compile error, and `tests/i18n-fragments.test.ts` names the fragment.
 */
export const en: Dictionary = {
  ...accountEn,
  ...adminEn,
  ...candidateEn,
  ...cockpitEn,
  ...emailEn,
  ...filtersEn,
  ...jobDetailEn,
  ...jobsEn,
  ...operationsEn,
  ...pipelineEn,
  ...publicProfileEn,
  ...recruiterEn,
  ...recruiterAccessEn,
  ...scoringEn,
  ...searchesEn,
  ...shellEn,
};
