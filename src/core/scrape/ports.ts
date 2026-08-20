import type { ClaimableScrapeStatus, ScrapeStatus } from "./domain/status.ts";

/** A task a worker may act on. */
export type ClaimedTask = {
  id: number;
  jobId: number;
  url: string;
  attempts: number;
};

/**
 * Runtime queue operations used by capture and parsing workers.
 *
 * No persistence type crosses this boundary: an SQLite row and an Upstash
 * message both map to the same small domain value above.
 */
export type QueuePort = {
  claim(status: ClaimableScrapeStatus, worker: string): Promise<ClaimedTask | null>;
  complete(id: number, next: ScrapeStatus): Promise<void>;
  fail(id: number, error: string, retryable: boolean): Promise<void>;
  stats(): Promise<Record<string, number>>;
};

export type EnqueueOptions = {
  /** Only jobs at or above this fit. Pages for jobs nobody will read are waste. */
  minFit?: number;
  limit?: number;
  /** Re-queue jobs whose page was already captured. */
  refresh?: boolean;
  /** Skip jobs whose adapter already returned a usable description. */
  minExistingChars?: number;
};

/** Defaults have been resolved by the application use case. */
export type EnqueueCriteria = {
  minFit: number;
  limit: number;
  refresh: boolean;
  minExistingChars: number;
};

export type EnqueueResult = {
  queued: number;
  skipped: number;
  alreadyDescribed: number;
};

/** Administrative queue operations used by the enqueue/retry use cases. */
export type QueueAdminPort = {
  enqueueEligible(criteria: EnqueueCriteria): Promise<EnqueueResult>;
  retryFailed(): Promise<number>;
};
