import { loadCandidateMatchingProfile } from "./infra/drizzle-profile.ts";
import { saveMatchingProfile } from "./app/tracks.ts";

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
/** Grava o perfil da pessoa e alinha o alvo da trilha principal a ele. */
export const setMatchingProfile = saveMatchingProfile;

export {
  KEYWORD_WEIGHT_MAX,
  MAX_ACTIVE_TRACKS,
  PAY_AMOUNT_MAX,
  TRACK_NAME_MAX,
  effectiveProfile,
  evidenceSupport,
  isRelevant,
  preselectTrack,
  suggestTrack,
  targetOf,
  validateTrackName,
  validateTrackTarget,
  type OwnEvidence,
  type Track,
  type TrackError,
  type TrackStatus,
  type TrackTarget,
  type UnreviewedField,
} from "./domain/track.ts";
export {
  PRIMARY_TRACK_NAME,
  archiveTrack,
  createTrack,
  ensurePrimaryTrack,
  personProfile,
  restoreTrack,
  setPrimaryTrack,
  trackOverview,
  trackScoringProfiles,
  trackSuggestion,
  trackSupport,
  updateTrack,
  type LifecycleResult,
  type TrackOverview,
  type TrackResult,
  type TrackScoringProfile,
  type TrackSuggestion,
  type UpdateTrackResult,
} from "./app/tracks.ts";
export {
  primaryScoreFilter,
  resolveClusterFilter,
  scoreTrackFilter,
  scoredJobsPerTrack,
  trackScope,
  type TrackChoice,
  type TrackScope,
} from "./app/track-scope.ts";
export { listTracks as listCandidateTracks } from "./infra/drizzle-tracks.ts";
export {
  MAX_ACTIVE_TERMS,
  RERUN_COOLDOWN_MS,
  ZERO_STREAK_DAYS,
  cooldownState,
  isNew,
  termStatus,
  zeroStreak,
  type TermRunState,
} from "./domain/saved-term.ts";
export {
  activeTermKeys,
  deleteTerm,
  listSavedTerms,
  moveTerm,
  newCount,
  recordTermVisit,
  savedTermForBoard,
  rerunTerm,
  saveTerm,
  setTermStatus,
  termAvailability,
  termOverview,
  type ActionContext,
  type CandidateScope,
  type RerunResult,
  type SaveTermResult,
  type SavedTermSummary,
  type TermAvailability,
  type TermOverview,
  type TermView,
} from "./app/saved-terms.ts";
/** Sem captura da varredura há 36 horas, a repetição diária parou. */
export { dailyRepeatPaused } from "../sourcing/index.ts";

export { WORK_MODES, WORK_MODE_ALIASES, readWorkMode, type WorkMode } from "./domain/work-mode.ts";

export {
  CONFIANCA_FORTE,
  CONFIANCA_MINIMA,
  curriculoSustentaPerfil,
  deriveMatchingProfile,
} from "./domain/derive.ts";
export { ensureMatchingProfile, type ResultadoPerfil } from "./app/ensure-profile.ts";

// Matching owns the candidate-to-job board and cockpit projections. This
// boundary keeps presentation adapters independent of the Drizzle composition
// root without creating a second copy of the queries.
export {
  boardFacets,
  clusterBreakdown,
  corpusStats,
  countBoard,
  countHiddenByPayRange,
  listBoard,
  type BoardFilters,
  type BoardRow,
  type GroupPosting,
  type PayFilter,
} from "../../core/db/repo.ts";

export {
  ComparisonInputError,
  createManualComparison,
  getComparisonDetail,
  type ComparisonErrorCode,
  type ComparisonField,
  type ManualComparisonInput,
} from "./app/manual-comparison.ts";
