/** Give up after this many attempts; a page that fails 4 times is not coming. */
export const MAX_ATTEMPTS = 4;

/** Backoff in minutes, indexed by the resulting attempt number. */
const BACKOFF_MINUTES = [1, 5, 20, 60] as const;

export type QueueFailureDecision = {
  attempts: number;
  status: "pending" | "failed";
  delayMinutes: number | null;
};

/** Pure retry decision; the adapter only persists its result. */
export function decideQueueFailure(
  currentAttempts: number,
  retryable: boolean,
): QueueFailureDecision {
  const attempts = currentAttempts + 1;
  const exhausted = !retryable || attempts >= MAX_ATTEMPTS;

  return {
    attempts,
    status: exhausted ? "failed" : "pending",
    delayMinutes: exhausted
      ? null
      : BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]!,
  };
}
