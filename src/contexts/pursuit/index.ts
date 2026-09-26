/**
 * Public API for the candidate-owned application funnel.
 *
 * The aggregate rules live in `domain/`; persistence remains behind this
 * composition boundary so UI and CLI callers cannot couple themselves to the
 * generic database module.
 */
export {
  APPLICATION_STATUSES,
  allowedTransitions,
  FUNNEL_STATUSES,
  IllegalApplicationTransitionError,
  mailMayMove,
  OUT_OF_FUNNEL,
  parseApplicationStatus,
  transitionApplication,
  transitionDirection,
  transitionGroups,
  undoableEvent,
  undoTransition,
  type ApplicationState,
  type ApplicationStatus,
  type ApplicationTransitionResult,
  type FunnelStatus,
  type RecordedStatusChange,
  type StatusChangeEvent,
  type TransitionGroups,
} from "./domain/application.ts";

export {
  applicationTimeline,
  ApplicationTransitionConflictError,
  ApplicationUndoUnavailableError,
  getJobDetail,
  inFunnel,
  PIPELINE_PAGE_SIZE,
  pipelineCounts,
  pipelineRows,
  recruiterCandidateSummaries,
  type RecruiterCandidateSummary,
  setApplicationDocument,
  setApplicationStatus,
  undoApplicationStatus,
} from "../../core/db/repo.ts";
