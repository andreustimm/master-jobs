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
  pipelineCounts,
  pipelineRows,
  setApplicationDocument,
  setApplicationStatus,
} from "../../core/db/repo.ts";
