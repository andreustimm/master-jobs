import {
  loadCandidateMatchingProfile,
  saveCandidateMatchingProfile,
} from "./infra/drizzle-profile.ts";

export {
  evaluateEligibility,
  type EligibilityResult,
  type EligibilityReason,
  type EligibilitySignals,
  type EligibilityStatus,
  type MatchPolicy,
} from "./domain/eligibility.ts";
export {
  SCORE_MESSAGE_CODES,
  message,
  scoreMessages,
  type ScoreMessage,
  type ScoreMessageCode,
} from "./domain/score-message.ts";

export const matchingProfile = loadCandidateMatchingProfile;
export const setMatchingProfile = saveCandidateMatchingProfile;

// Matching owns the candidate-to-job board and cockpit projections. This
// boundary keeps presentation adapters independent of the Drizzle composition
// root without creating a second copy of the queries.
export {
  boardFacets,
  clusterBreakdown,
  corpusStats,
  countBoard,
  listBoard,
  type BoardFilters,
  type BoardRow,
} from "../../core/db/repo.ts";

export {
  ComparisonInputError,
  createManualComparison,
  getComparisonDetail,
  type ComparisonErrorCode,
  type ComparisonField,
  type ManualComparisonInput,
} from "./app/manual-comparison.ts";
