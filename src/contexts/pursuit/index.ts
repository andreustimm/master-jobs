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
  IllegalApplicationTransitionError,
  parseApplicationStatus,
  transitionApplication,
  type ApplicationState,
  type ApplicationStatus,
  type ApplicationTransitionResult,
  type StatusChangeEvent,
} from "./domain/application.ts";

export {
  applicationTimeline,
  ApplicationTransitionConflictError,
  getJobDetail,
  PIPELINE_PAGE_SIZE,
  pipelineCounts,
  pipelineRows,
  recruiterCandidateSummaries,
  type RecruiterCandidateSummary,
  setApplicationDocument,
  setApplicationStatus,
} from "../../core/db/repo.ts";
