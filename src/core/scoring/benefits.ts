/**
 * Benefit detection and matching.
 *
 * Two separate jobs, deliberately not merged:
 *   1. `detectBenefits` reads a posting and says what it *mentions*.
 *   2. `scoreBenefits` compares that against what the candidate wants.
 *
 * The split matters because detection is a property of the posting and is worth
 * storing, while the comparison changes every time the profile changes.
 *
 * The load-bearing rule here: **silence is not absence**. A posting that never
 * mentions health coverage probably still has it — public job descriptions
 * routinely omit the benefits section entirely. Treating "not mentioned" as
 * "not offered" would demote well-paying roles for being tersely written, and
 * would hit hardest exactly the sources that already truncate descriptions.
 * So a posting with no usable text scores neutral and can never produce a
 * blocker.
 */

/** Minimum description length before absence of a benefit means anything. */
const MIN_TEXT_FOR_ABSENCE = 400;

/** Score for a posting we cannot read. Neutral, never punitive. */
const UNREADABLE = 0.5;

/** Score for a readable posting that lists nothing. Low, but not zero. */
const SILENT = 0.25;

const PREFERRED_VALUE = 0.3;
const NICE_VALUE = 0.12;

/**
 * Canonical benefit vocabulary.
 *
 * Keys match `compensation.benefits.*` in profile.yaml. Aliases are matched
 * case-insensitively as substrings of the normalised text, so they must be
 * distinctive enough not to fire inside unrelated prose — "pto" alone would hit
 * "Capto", hence the spaced/punctuated variants.
 */
export const BENEFIT_VOCABULARY: Record<string, string[]> = {
  paid_time_off: [
    "paid time off",
    "pto",
    "unlimited vacation",
    "vacation days",
    "annual leave",
    "paid holidays",
    "flexible time off",
  ],
  equity: ["equity", "stock options", "rsu", "share options", "esop", "ownership stake"],
  learning_budget: [
    "learning budget",
    "education budget",
    "training budget",
    "professional development budget",
    "conference budget",
    "l&d budget",
    "tuition reimbursement",
  ],
  health_stipend: [
    "health insurance",
    "healthcare",
    "health stipend",
    "medical insurance",
    "dental",
    "health coverage",
    "wellness stipend",
  ],
  home_office_stipend: [
    "home office stipend",
    "home office budget",
    "equipment stipend",
    "wfh stipend",
    "remote work stipend",
  ],
  // Not "office stipend" — it is a substring of "home office stipend".
  coworking: ["coworking", "co-working", "workspace allowance", "coworking allowance"],
  async_first: [
    "async",
    "asynchronous",
    "no meetings culture",
    "remote-first",
    "remote first",
    "distributed team",
  ],
  retirement: ["401k", "401(k)", "pension", "retirement plan", "superannuation"],
  parental_leave: ["parental leave", "maternity leave", "paternity leave", "family leave"],
  visa_sponsorship: ["visa sponsorship", "sponsor a visa", "work visa", "h-1b", "h1b"],
  relocation: ["relocation package", "relocation assistance", "relocation bonus"],
  free_lunch: ["free lunch", "catered lunch", "free meals", "snacks and drinks"],
  gym: ["gym membership", "fitness stipend", "gym reimbursement"],
  four_day_week: ["4-day week", "four-day week", "4 day work week", "9/80"],
};

export type BenefitMatch = {
  factor: number;
  /** Canonical keys the posting mentions. */
  detected: string[];
  /** Wanted and found. */
  matchedPreferred: string[];
  /** Required by the profile and demonstrably absent from a readable posting. */
  missingRequired: string[];
  readable: boolean;
  reason: string;
};

export type BenefitPreferences = {
  required: string[];
  preferred: string[];
  nice_to_have: string[];
  irrelevant: string[];
};

/** What a posting mentions, independent of who is reading it. */
export function detectBenefits(text: string | null | undefined): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  const found: string[] = [];
  for (const [key, aliases] of Object.entries(BENEFIT_VOCABULARY)) {
    if (aliases.some((a) => haystack.includes(a))) found.push(key);
  }
  return found;
}

export function scoreBenefits(
  text: string | null | undefined,
  prefs: BenefitPreferences,
): BenefitMatch {
  const readable = (text?.length ?? 0) >= MIN_TEXT_FOR_ABSENCE;
  const detected = detectBenefits(text);

  if (!readable) {
    return {
      factor: UNREADABLE,
      detected,
      matchedPreferred: [],
      missingRequired: [],
      readable: false,
      reason: "Benefits not assessable — posting text too short",
    };
  }

  const has = new Set(detected);
  const matchedPreferred = prefs.preferred.filter((b) => has.has(b));
  const matchedNice = prefs.nice_to_have.filter((b) => has.has(b));
  // Only a readable posting can be said to be missing something.
  const missingRequired = prefs.required.filter((b) => !has.has(b));

  if (detected.length === 0) {
    return {
      factor: SILENT,
      detected,
      matchedPreferred: [],
      missingRequired,
      readable: true,
      reason: "No benefits listed",
    };
  }

  const raw = matchedPreferred.length * PREFERRED_VALUE + matchedNice.length * NICE_VALUE;
  const factor = Math.max(SILENT, Math.min(1, raw));

  const wanted = [...matchedPreferred, ...matchedNice];
  const reason =
    wanted.length > 0
      ? `Offers ${wanted.join(", ").replace(/_/g, " ")}`
      : `Lists benefits, none on the wanted list`;

  return { factor, detected, matchedPreferred, missingRequired, readable: true, reason };
}
