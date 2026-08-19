/**
 * The clock as a port (MIGRATION passo 2).
 *
 * Injected where time is a **decision**, not where it is a stamp.
 *
 * That distinction is the whole design. `createdAt: new Date().toISOString()`
 * records when something happened and nothing branches on it — wrapping it
 * would add indirection and buy nothing. But a backoff that must not fire for
 * five minutes, or a claim that becomes reclaimable after fifteen, is logic;
 * testing it against the real clock means either sleeping or asserting nothing.
 *
 * So this exists for the second kind, and the first kind is left alone. ADR
 * 0007 is explicit that a port with no variation to absorb is ceremony.
 */

export type Clock = {
  /** Epoch millis. */
  now(): number;
  /** ISO-8601, the format every timestamp column in this schema uses. */
  iso(): string;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

/**
 * A clock a test drives by hand.
 *
 * `advance` moves it forward, so a backoff window can be crossed in a
 * microsecond instead of waited out.
 */
export function fixedClock(startIso = "2026-08-19T12:00:00.000Z"): Clock & {
  advance(ms: number): void;
  set(iso: string): void;
} {
  let current = Date.parse(startIso);
  return {
    now: () => current,
    iso: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    },
    set: (iso: string) => {
      current = Date.parse(iso);
    },
  };
}

let active: Clock = systemClock;

export function clock(): Clock {
  return active;
}

export function setClock(next: Clock): void {
  active = next;
}

export function resetClock(): void {
  active = systemClock;
}
