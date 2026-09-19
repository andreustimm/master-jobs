import { describe, expect, it } from "vitest";
import {
  cooldownState,
  dailyRepeatPaused,
  isNew,
  termStatus,
  zeroStreak,
} from "../src/contexts/matching/index.ts";
import type { CaptureStatus } from "../src/contexts/sourcing/index.ts";

const state = (status: CaptureStatus, reasonCode: string | null = null) => ({ status, reasonCode });

describe("saved-term rules", () => {
  it("UT-045 one manual run per 24 hours, the first one included", () => {
    const anchor = "2026-09-18T10:00:00.000Z";
    expect(cooldownState(anchor, new Date("2026-09-19T09:59:00.000Z"))).toEqual({
      allowed: false,
      availableAt: "2026-09-19T10:00:00.000Z",
    });
    expect(cooldownState(anchor, new Date("2026-09-19T10:00:00.000Z"))).toEqual({ allowed: true });
    expect(cooldownState(null, new Date())).toEqual({ allowed: true });
  });

  it("UT-046 a job is new when seen after the last visit, or never visited", () => {
    const visit = "2026-09-18T10:00:00.000Z";
    expect(isNew("2026-09-01T00:00:00.000Z", null)).toBe(true);
    expect(isNew("2026-09-18T10:00:01.000Z", visit)).toBe(true);
    expect(isNew(visit, visit)).toBe(false);
    expect(isNew("2026-09-17T00:00:00.000Z", visit)).toBe(false);
  });

  it("UT-047 folds platform states into the term's state", () => {
    expect(termStatus([state("succeeded"), state("failed", "http_error")])).toBe("partial");
    expect(termStatus([state("succeeded"), state("queued")])).toBe("running");
    expect(termStatus([state("running"), state("failed", "network")])).toBe("running");
    expect(termStatus([state("succeeded"), state("succeeded")])).toBe("succeeded");
    expect(termStatus([state("skipped", "ingestion_blocked"), state("skipped", "ingestion_blocked")])).toBe(
      "captures_off",
    );
    expect(termStatus([state("skipped", "platform_disabled")])).toBe("no_platform");
    expect(termStatus([state("succeeded"), state("waiting_quota", "quota")])).toBe("waiting_quota");
    expect(termStatus([])).toBe("never_run");
  });

  it("UT-048 fourteen empty days in a row become a notice; thirteen do not", () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        windowDay: new Date(Date.UTC(2026, 8, 19) - i * 86_400_000).toISOString().slice(0, 10),
        status: "succeeded" as const,
        fetched: 0,
      }));
    expect(zeroStreak(days(14))).toBe("no_results_14d");
    expect(zeroStreak(days(13))).toBeNull();
    expect(zeroStreak([...days(14).slice(1), { windowDay: "2026-09-19", status: "succeeded", fetched: 3 }])).toBeNull();
  });

  it("UT-049 the daily repeat is paused after 36 hours without a sweep capture", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    expect(dailyRepeatPaused(null, now)).toBe(true);
    expect(dailyRepeatPaused("2026-09-18T00:00:00.000Z", now)).toBe(false);
    expect(dailyRepeatPaused("2026-09-17T23:59:59.000Z", now)).toBe(true);
    expect(dailyRepeatPaused("2026-09-18T00:01:00.000Z", now)).toBe(false);
  });
});
