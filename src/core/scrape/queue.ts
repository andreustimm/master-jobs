/**
 * Public composition root for the scraping queue.
 *
 * Existing CLI and UI imports keep using this module. The contract is pure in
 * `ports.ts`, use cases live in `app/`, and the local adapter lives in `infra/`.
 */
import {
  enqueuePending as enqueuePendingUseCase,
  retryFailed as retryFailedUseCase,
} from "./app/manage-queue.ts";
import { drizzleQueue, drizzleQueueAdmin } from "./infra/drizzle-queue.ts";
import type { EnqueueOptions, EnqueueResult } from "./ports.ts";

export { MAX_ATTEMPTS } from "./domain/retry-policy.ts";
export { SCRAPE_STATUSES } from "./domain/status.ts";
export type { ClaimableScrapeStatus, ScrapeStatus } from "./domain/status.ts";
export type {
  ClaimedTask,
  EnqueueCriteria,
  EnqueueOptions,
  EnqueueResult,
  QueueAdminPort,
  QueuePort,
} from "./ports.ts";

/** Backwards-compatible name for the local Drizzle adapter. */
export const dbQueue = drizzleQueue;

export function enqueuePending(opts: EnqueueOptions = {}): Promise<EnqueueResult> {
  return enqueuePendingUseCase(opts, { queue: drizzleQueueAdmin });
}

export function retryFailed(): Promise<number> {
  return retryFailedUseCase({ queue: drizzleQueueAdmin });
}
