/**
 * Chave do dicionário de cada fato e de cada valor controlado (#327).
 *
 * Constante guarda CHAVE, nunca texto (G29). `Record` sobre a união inteira:
 * valor novo numa lista de `candidate-public-facts.ts` sem rótulo aqui é erro
 * de compilação, não `publicFacts.algo` cru na tela. Usado pela tela de
 * edição (`/candidate`) e pela página pública (`/p/[slug]`).
 */
import type {
  Availability,
  ExperienceLevel,
  PublicFactKey,
  StartTimeframe,
  WorkModel,
} from "../../src/core/candidate-public-facts.ts";
import type { TranslationKey } from "../../src/core/i18n/index.ts";

export const FACT_LABEL: Record<PublicFactKey, TranslationKey> = {
  workModel: "publicFacts.workModel",
  experienceLevel: "publicFacts.experienceLevel",
  availability: "publicFacts.availability",
  startTimeframe: "publicFacts.startTimeframe",
  openToRelocation: "publicFacts.openToRelocation",
  area: "publicFacts.area",
  languages: "publicFacts.languages",
};

/** Remoto, híbrido e presencial já existiam no dicionário (filtros de vagas). */
export const WORK_MODEL_LABEL: Record<WorkModel, TranslationKey> = {
  remote: "filters.remote",
  hybrid: "filters.hybrid",
  onsite: "filters.onsite",
  b2b: "publicFacts.workModelB2b",
  contractor: "publicFacts.workModelContractor",
  employee: "publicFacts.workModelEmployee",
};

export const EXPERIENCE_LEVEL_LABEL: Record<ExperienceLevel, TranslationKey> = {
  junior: "publicFacts.levelJunior",
  mid: "publicFacts.levelMid",
  senior: "publicFacts.levelSenior",
  lead: "publicFacts.levelLead",
  staff: "publicFacts.levelStaff",
  principal: "publicFacts.levelPrincipal",
  executive: "publicFacts.levelExecutive",
};

export const AVAILABILITY_LABEL: Record<Availability, TranslationKey> = {
  "actively-looking": "publicFacts.availabilityActivelyLooking",
  open: "publicFacts.availabilityOpen",
  "not-looking": "publicFacts.availabilityNotLooking",
};

export const START_TIMEFRAME_LABEL: Record<StartTimeframe, TranslationKey> = {
  immediate: "publicFacts.startImmediate",
  "two-weeks": "publicFacts.startTwoWeeks",
  "one-month": "publicFacts.startOneMonth",
  "two-months": "publicFacts.startTwoMonths",
  "three-months-plus": "publicFacts.startThreeMonthsPlus",
};
