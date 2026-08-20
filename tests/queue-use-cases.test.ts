import { describe, expect, it } from "vitest";
import {
  enqueuePending,
  retryFailed,
} from "../src/core/scrape/app/manage-queue.ts";
import {
  decideQueueFailure,
  MAX_ATTEMPTS,
} from "../src/core/scrape/domain/retry-policy.ts";
import type {
  EnqueueCriteria,
  EnqueueResult,
  QueueAdminPort,
} from "../src/core/scrape/ports.ts";

function queueAdmin(
  enqueue: (criteria: EnqueueCriteria) => EnqueueResult | Promise<EnqueueResult>,
  retry = async () => 0,
): QueueAdminPort {
  return {
    async enqueueEligible(criteria) {
      return enqueue(criteria);
    },
    retryFailed: retry,
  };
}

describe("queue administration use cases", () => {
  it("resolves enqueue defaults before calling the adapter", async () => {
    let received: EnqueueCriteria | undefined;
    const result = { queued: 3, skipped: 1, alreadyDescribed: 7 };
    const queue = queueAdmin((criteria) => {
      received = criteria;
      return result;
    });

    await expect(enqueuePending({}, { queue })).resolves.toEqual(result);
    expect(received).toEqual({
      minFit: 45,
      limit: 500,
      refresh: false,
      minExistingChars: 2_000,
    });
  });

  it("preserves explicit zeroes instead of replacing them with defaults", async () => {
    let received: EnqueueCriteria | undefined;
    const queue = queueAdmin((criteria) => {
      received = criteria;
      return { queued: 0, skipped: 0, alreadyDescribed: 0 };
    });

    await enqueuePending(
      { minFit: 0, limit: 0, refresh: true, minExistingChars: 0 },
      { queue },
    );

    expect(received).toEqual({
      minFit: 0,
      limit: 0,
      refresh: true,
      minExistingChars: 0,
    });
  });

  it("delegates retry without exposing persistence to the use case", async () => {
    let calls = 0;
    const queue = queueAdmin(
      () => ({ queued: 0, skipped: 0, alreadyDescribed: 0 }),
      async () => {
        calls++;
        return 4;
      },
    );

    await expect(retryFailed({ queue })).resolves.toBe(4);
    expect(calls).toBe(1);
  });
});

describe("queue retry policy", () => {
  it("keeps a retryable failure pending with backoff", () => {
    expect(decideQueueFailure(0, true)).toEqual({
      attempts: 1,
      status: "pending",
      delayMinutes: 5,
    });
  });

  it("makes non-retryable and exhausted failures terminal", () => {
    expect(decideQueueFailure(0, false)).toEqual({
      attempts: 1,
      status: "failed",
      delayMinutes: null,
    });
    expect(decideQueueFailure(MAX_ATTEMPTS - 1, true)).toEqual({
      attempts: MAX_ATTEMPTS,
      status: "failed",
      delayMinutes: null,
    });
  });
});
