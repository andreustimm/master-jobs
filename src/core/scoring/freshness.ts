/**
 * Job freshness as a scoring component.
 *
 * This is the one component that is not about fit at all — it is about the
 * probability that applying still does anything. Recruiting reality: a req that
 * has been open for six weeks either has a shortlist already, an internal
 * candidate, or was never real (the "ghost job" problem this corpus measured at
 * 25% on one source). Fit tells you whether to want the job; freshness tells you
 * whether wanting it is actionable.
 *
 * Deliberately a small weight. Freshness must reorder near-ties, not let a
 * mediocre-but-new posting outrank a strong-but-two-week-old one.
 */

/**
 * Days inside which a posting counts as fully fresh.
 *
 * Was 3, which turned out to be wrong for this corpus: half of all open jobs
 * are 0–3 days old, so a 3-day plateau handed an identical score to half the
 * board and reordered nothing. `jho stats` flagged the component as dead
 * weight — 92% utilisation, 13% variation. One day is the honest hot window
 * anyway: applying today versus in a week is a real difference in whether a
 * shortlist has formed.
 */
export const PLATEAU_DAYS = 1;

/**
 * After the plateau, value halves every this many days.
 *
 * Was 14. With 99% of the corpus under two weeks old, a 14-day half-life spent
 * its entire range on jobs that do not exist here. Seven days puts the decay
 * where the postings actually are.
 */
export const HALF_LIFE_DAYS = 7;

/**
 * Score for a posting whose age is unknown.
 *
 * Neutral by design. Many boards never expose a posting date, and punishing
 * that would systematically demote entire sources for a property of their API
 * rather than a property of the job — the exact bias the source-quality
 * invariant in CLAUDE.md exists to avoid.
 */
const UNKNOWN = 0.5;

export type FreshnessInput = {
  /** When the employer says it was posted. Preferred — it is the real signal. */
  postedAt?: string | null;
};

export type FreshnessResult = {
  /** 0..1, multiplied by the component weight by the caller. */
  factor: number;
  /** Null when the age could not be established. */
  ageDays: number | null;
  /** Whether an employer-provided date was usable. */
  basis: "posted" | "unknown";
  reason: string;
};

function parseDays(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = (now - t) / 86_400_000;
  // A future date is a source bug, not a fresher job. Clamp instead of
  // rewarding it, or a bad timezone offset buys a posting free rank.
  return days < 0 ? 0 : days;
}

export function scoreFreshness(input: FreshnessInput, now: number = Date.now()): FreshnessResult {
  const posted = parseDays(input.postedAt, now);

  // `firstSeenAt` measures crawler timing, not posting age. Using it would
  // reward sources discovered today and punish otherwise identical sources
  // found later, violating the neutral-missing-data scoring invariant.
  if (posted === null) {
    return { factor: UNKNOWN, ageDays: null, basis: "unknown", reason: "Posting date unknown" };
  }

  const decayDays = Math.max(0, posted - PLATEAU_DAYS);
  const factor = Math.pow(2, -decayDays / HALF_LIFE_DAYS);

  const rounded = Math.round(posted);
  const label =
    rounded <= PLATEAU_DAYS
      ? `Posted ${rounded === 0 ? "today" : `${rounded}d ago`} — inside the hot window`
      : `Posted ${rounded}d ago`;

  return { factor, ageDays: posted, basis: "posted", reason: label };
}
