/**
 * Queue administration use cases.
 *
 * Defaults and orchestration belong here; SQL and atomic-claim mechanics do
 * not. This keeps the behavior testable with a tiny in-memory port.
 */
import type {
  EnqueueOptions,
  EnqueueResult,
  QueueAdminPort,
} from "../ports.ts";

export type QueueAdministrationDeps = {
  queue: QueueAdminPort;
};

export function enqueuePending(
  input: EnqueueOptions,
  deps: QueueAdministrationDeps,
): Promise<EnqueueResult> {
  return deps.queue.enqueueEligible({
    minFit: input.minFit ?? 45,
    limit: input.limit ?? 500,
    refresh: input.refresh ?? false,
    // Above this size the source already supplied enough text to score/read.
    minExistingChars: input.minExistingChars ?? 2_000,
  });
}

/** Puts failed tasks back in line, e.g. after fixing the parser. */
export function retryFailed(deps: QueueAdministrationDeps): Promise<number> {
  return deps.queue.retryFailed();
}
