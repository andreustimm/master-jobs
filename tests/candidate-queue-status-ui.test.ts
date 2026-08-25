import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { translator } from "../src/core/i18n/index.ts";

describe("candidate queue status page wiring", () => {
  it("IT-005: derives scope from the page guard and renders dictionary-backed status", () => {
    const page = readFileSync("app/candidate/page.tsx", "utf8");
    const guard = page.indexOf('requireOwnCandidatePage("candidate:read")');
    const read = page.indexOf("candidateScoreQueueStatus(candidateId)");

    expect(guard).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(guard);
    expect(page).toContain('data-testid="score-queue-status"');
    expect(page).not.toMatch(/snapshot\.lastError|queueSnapshot\.lastError/);
  });

  it("keeps every queue state translated in both locales", () => {
    const keys = [
      "candidate.queueIdleLabel",
      "candidate.queuePendingLabel",
      "candidate.queueScoringLabel",
      "candidate.queueDoneLabel",
      "candidate.queueFailedLabel",
    ] as const;

    for (const locale of ["pt-BR", "en"] as const) {
      const { t } = translator(locale);
      for (const key of keys) expect(t(key)).not.toBe(key);
    }
  });
});
