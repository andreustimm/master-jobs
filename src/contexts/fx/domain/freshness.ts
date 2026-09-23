import type { FxTable } from "../../../core/money.ts";

/**
 * Days since the table was quoted. Used to warn about stale rates.
 *
 * `now` comes from the caller: the domain does not read the clock.
 */
export function ageInDays(fx: FxTable, now: Date): number {
  const quoted = Date.parse(`${fx.date}T00:00:00Z`);
  if (Number.isNaN(quoted)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - quoted) / 86_400_000);
}

/** ECB skips weekends and holidays; a week is a meaningful stale boundary. */
export const STALE_AFTER_DAYS = 7;

