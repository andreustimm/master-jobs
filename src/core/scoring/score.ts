/**
 * Deterministic fit scoring.
 *
 * Why deterministic and not an LLM call: this runs over thousands of postings
 * on every sync, it must be reproducible for regression tests, and it must be
 * auditable — you should be able to read `reasons` and see exactly why a job
 * ranked where it did. An LLM pass is worth adding later, but only on the top
 * slice this scorer already surfaced.
 *
 * Bump SCORER_VERSION whenever weights or logic change, so stale scores are
 * detectable and `jobs score --rescore` knows what to redo.
 */
import {
  annualize,
  convert,
  formatMoney,
  money,
  parseCurrency,
  parsePeriod,
  type FxTable,
  type Money,
  type Period,
} from "../money.ts";
import type { Profile } from "../profile/schema.ts";
import {
  evaluateEligibility,
  message,
  type EligibilityResult,
  type EligibilitySignals,
  type MatchPolicy,
  type ScoreMessage,
} from "../../contexts/matching/index.ts";
import { scoreBenefits } from "./benefits.ts";
import { PLATEAU_DAYS, scoreFreshness } from "./freshness.ts";

export const SCORER_VERSION = "1.3.0";

export type ScoringContext = {
  profile: Profile;
  fx: FxTable | null;
  /** Fixed once per run so time-dependent rules remain reproducible. */
  asOf: number;
};

export type ScoreInput = {
  title: string;
  companyName: string;
  descriptionText?: string | null;
  locationRaw?: string | null;
  remote?: boolean | null;
  compMin?: number | null;
  compMax?: number | null;
  compCurrency?: string | null;
  compPeriod?: string | null;
  /** Set for fixed-price engagements; required to annualise them. */
  compDurationMonths?: number | null;
  /** Employer-stated posting date. The real freshness signal when present. */
  postedAt?: string | null;
  /** Structured facts supplied when the source exposes them. */
  eligibility?: EligibilitySignals;
};

export type ScoreResult = {
  fit: number;
  titleScore: number;
  keywordScore: number;
  seniorityScore: number;
  geoScore: number;
  compScore: number;
  freshnessScore: number;
  benefitScore: number;
  penalty: number;
  cluster: string;
  matchedKeywords: string[];
  missingKeywords: string[];
  /** Canonical benefit keys the posting mentions. Worth storing on its own. */
  detectedBenefits: string[];
  /** Days since posting, or null when no date could be established. */
  ageDays: number | null;
  reasons: ScoreMessage[];
  blockers: ScoreMessage[];
  eligibility: EligibilityResult;
};

/**
 * Component weights. They sum to 100 before penalties are subtracted.
 *
 * v1.2.0 took 10 points from fit-shaped components to fund two conversion-shaped
 * ones. The reasoning is a recruiting one, not an engineering one: title and
 * keywords tell you whether the job is right, but they say nothing about whether
 * applying still accomplishes anything. Freshness does, and it is the single
 * strongest lever on reply rate. Both new weights are small on purpose — they
 * break near-ties, they do not let a weak-but-new posting outrank a strong one.
 */
export const WEIGHTS = {
  title: 30,
  keyword: 27,
  seniority: 10,
  geo: 15,
  comp: 8,
  freshness: 6,
  benefits: 4,
} as const;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, " ");
}

/** Word-boundary match so "go" does not fire on "google" or "category". */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i").test(haystack);
}

/* ------------------------------ Title matching ---------------------------- */

function scoreTitle(
  title: string,
  profile: Profile,
): { score: number; cluster: string; reason: ScoreMessage } {
  const t = normalize(title);

  for (const avoid of profile.targets.avoid_titles) {
    if (containsTerm(t, avoid.toLowerCase())) {
      return { score: 0, cluster: "other", reason: message("title.avoided", { term: avoid }) };
    }
  }

  let best = { score: 0, cluster: "other", reason: message("title.noMatch") };

  for (const [name, cluster] of Object.entries(profile.targets.clusters)) {
    for (const target of cluster.titles) {
      const needle = target.toLowerCase();
      let raw = 0;
      if (t === needle) raw = 1;
      else if (containsTerm(t, needle)) raw = 0.9;
      else {
        // Partial credit when every significant word of the target appears.
        const words = needle.split(" ").filter((w) => w.length > 2);
        const hits = words.filter((w) => containsTerm(t, w)).length;
        if (words.length > 0 && hits === words.length) raw = 0.75;
        else if (words.length > 1 && hits >= words.length - 1) raw = 0.45;
      }
      const score = raw * cluster.weight * WEIGHTS.title;
      if (score > best.score) {
        best = {
          score,
          cluster: name,
          reason: message("title.match", { target, cluster: name }),
        };
      }
    }
  }
  return best;
}

/* ----------------------------- Keyword matching --------------------------- */

function scoreKeywords(
  text: string,
  profile: Profile,
): { score: number; matched: string[]; missing: string[]; negatives: string[] } {
  const haystack = normalize(text);
  const groups = [
    ...profile.keywords.critical,
    ...profile.keywords.strong,
    ...profile.keywords.stack,
  ];

  const positiveMax = groups.reduce((sum, k) => sum + Math.max(0, k.weight), 0);
  let earned = 0;
  const matched: string[] = [];
  const missing: string[] = [];

  for (const k of groups) {
    if (containsTerm(haystack, k.term)) {
      earned += k.weight;
      matched.push(k.term);
    } else if (k.weight >= 7) {
      // Only high-value absences are worth reporting.
      missing.push(k.term);
    }
  }

  const negatives: string[] = [];
  let negativeHit = 0;
  for (const k of profile.keywords.negative) {
    if (containsTerm(haystack, k.term)) {
      negativeHit += Math.abs(k.weight);
      negatives.push(k.term);
    }
  }

  // Saturating curve: hitting 35% of the possible weight already scores well,
  // otherwise long job descriptions would dominate purely by being verbose.
  const ratio = positiveMax > 0 ? earned / positiveMax : 0;
  const saturated = Math.min(1, ratio / 0.35);
  const score = Math.max(0, saturated * WEIGHTS.keyword - negativeHit);

  return { score, matched, missing, negatives };
}

/* --------------------------- Seniority inference -------------------------- */

function scoreSeniority(
  text: string,
  profile: Profile,
): { score: number; reason: ScoreMessage } {
  const t = normalize(text);

  // "8+ years", "5-7 years", "minimum of 10 years"
  const match = t.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs)/);
  if (!match?.[1]) {
    return { score: WEIGHTS.seniority * 0.6, reason: message("seniority.unknown") };
  }
  const years = Number(match[1]);
  if (years < profile.seniority.reject_below_years) {
    return { score: 0, reason: message("seniority.under", { years }) };
  }
  if (years >= profile.seniority.min_years_expected) {
    return { score: WEIGHTS.seniority, reason: message("seniority.match", { years }) };
  }
  const fraction = years / profile.seniority.min_years_expected;
  return {
    score: WEIGHTS.seniority * fraction,
    reason: message("seniority.below", {
      years,
      target: profile.seniority.min_years_expected,
    }),
  };
}

/* ------------------------------ Geo eligibility --------------------------- */

function scoreGeo(
  input: ScoreInput,
  profile: Profile,
  eligibility: EligibilityResult,
): { score: number; reason: ScoreMessage } {
  const location = normalize(input.locationRaw ?? "");
  const body = normalize(input.descriptionText ?? "");
  const combined = `${location} ${body}`;

  if (eligibility.status === "ineligible") {
    return { score: 0, reason: message("geo.ineligible") };
  }
  if (eligibility.status === "eligible") {
    return { score: WEIGHTS.geo, reason: message("geo.eligible") };
  }

  // Restrictions win over generic "fully remote" wording. The former order
  // awarded worldwide credit before noticing "US only" later in the body.
  const restricted = /\b(us only|usa only|united states only|uk only|canada only|eu only|europe only|emea only)\b/.test(
    combined,
  );
  if (restricted) return { score: 0, reason: message("geo.restricted") };

  const explicitLatam = /\b(latam|latin america|south america|brazil|brasil|americas)\b/.test(
    combined,
  );
  const explicitWorldwide = /\b(worldwide|globally|anywhere|global remote|any location|fully remote)\b/.test(
    combined,
  );

  if (explicitLatam) {
    return { score: WEIGHTS.geo, reason: message("geo.latam") };
  }
  if (explicitWorldwide) {
    return { score: WEIGHTS.geo * 0.9, reason: message("geo.worldwide") };
  }

  const isRemote =
    input.remote === true || /\bremote\b/.test(location) || /\bremote\b/.test(body);

  if (
    /\b(on[- ]?site|in[- ]?office|in (?:our|the) office)\b/.test(combined) &&
    profile.constraints.remote_only
  ) {
    return { score: 0, reason: message("geo.physical") };
  }

  if (!isRemote && profile.constraints.remote_only) {
    return { score: WEIGHTS.geo * 0.5, reason: message("geo.unknown") };
  }

  return { score: WEIGHTS.geo * 0.55, reason: message("geo.remoteUnknown") };
}

/* ---------------------------- Compensation ------------------------------- */

/**
 * Compensation scoring, currency-aware.
 *
 * Before v1.1.0 this compared a raw number against a USD floor while ignoring
 * `comp_currency` entirely, so a posting quoted in MXN or PHP was weighed as if
 * it were dollars. It also only recognised the period strings "hour" and
 * "month", which meant "hourly" — the spelling several APIs actually use — fell
 * through to the annual branch and turned USD 100/hour into USD 100/year.
 *
 * Matching order:
 *   1. An explicit range for the posting's own (currency, period).
 *   2. An explicit range for that currency in any period, compared annualised.
 *   3. Conversion to the reference currency, compared against its range.
 *   4. No rate available -> treated as undisclosed, never as equivalent.
 */
function scoreComp(
  input: ScoreInput,
  profile: Profile,
  fx: FxTable | null,
): { score: number; reason: ScoreMessage } {
  const { compMin, compMax } = input;
  const amount = compMax ?? compMin ?? 0;

  // Several aggregators emit 0 rather than null for "not disclosed". Treating
  // that as a real figure would either score it as below-floor or, worse, hand
  // it the undisclosed consolation score — both wrong.
  if ((compMin == null && compMax == null) || amount <= 0) {
    return { score: WEIGHTS.comp * 0.5, reason: message("comp.undisclosed") };
  }
  const currency = parseCurrency(input.compCurrency);
  const period = parsePeriod(input.compPeriod);

  // A number with no currency is unusable: we cannot tell 60000 BRL from
  // 60000 USD, and guessing is exactly the bug this rewrite removes.
  if (!currency) {
    return {
      score: WEIGHTS.comp * 0.5,
      reason: message("comp.noCurrency", { amount }),
    };
  }
  if (!period) {
    return {
      score: WEIGHTS.comp * 0.5,
      reason: message("comp.badPeriod", { period: input.compPeriod ?? "" }),
    };
  }

  const posted: Money = money(
    amount,
    currency,
    period,
    input.compDurationMonths ?? undefined,
  );

  /* --- fixed-price projects ------------------------------------------- */
  if (period === "project") {
    const project = profile.compensation.project;
    if (!project.accepted) {
      return { score: 0, reason: message("comp.projectRejected") };
    }
    if (!input.compDurationMonths) {
      return {
        score: WEIGHTS.comp * 0.4,
        reason: message("comp.projectNoDuration", { label: formatMoney(posted) }),
      };
    }
    if (input.compDurationMonths > project.max_duration_months) {
      return {
        score: WEIGHTS.comp * 0.2,
        reason: message("comp.projectTooLong", {
          months: input.compDurationMonths,
          maximum: project.max_duration_months,
        }),
      };
    }
  }

  /* --- 1. exact (currency, period) range ------------------------------- */
  const exact = profile.compensation.ranges.find(
    (r) => r.currency.toUpperCase() === currency && r.period === period,
  );
  if (exact) {
    return gradeAgainst(posted, exact, `${formatMoney(posted)}`);
  }

  /* --- 2. same currency, different period ------------------------------ */
  const annualPosted = annualize(posted);
  if (annualPosted) {
    const sameCurrency = profile.compensation.ranges.filter(
      (r) => r.currency.toUpperCase() === currency,
    );
    for (const range of sameCurrency) {
      const annualRange = annualiseRange(range);
      if (annualRange) {
        return gradeAgainst(annualPosted, annualRange, `${formatMoney(posted)}`);
      }
    }
  }

  /* --- 3. convert to the reference currency ---------------------------- */
  const reference = profile.compensation.reference_currency.toUpperCase();
  if (annualPosted && fx) {
    const converted = convert(annualPosted, reference, fx);
    if (converted) {
      const refRange = profile.compensation.ranges.find(
        (r) => r.currency.toUpperCase() === reference,
      );
      const annualRefRange = refRange ? annualiseRange(refRange) : null;
      if (annualRefRange) {
        const graded = gradeAgainst(
          converted,
          annualRefRange,
          `${formatMoney(posted)} \u2248 ${formatMoney(converted)}`,
        );
        return {
          score: graded.score,
          reason: {
            ...graded.reason,
            params: { ...graded.reason.params, fxDate: fx.date },
          },
        };
      }
    }
  }

  /* --- 4. no basis for comparison -------------------------------------- */
  return {
    score: WEIGHTS.comp * 0.5,
    reason: message("comp.noBasis", { label: formatMoney(posted), currency }),
  };
}

type AnnualRange = { floor: number; target: number; ideal?: number; currency: string };

/** Express a declared range per year so it compares with an annualised offer. */
function annualiseRange(range: {
  currency: string;
  period: Period;
  floor: number;
  target: number;
  ideal?: number;
}): AnnualRange | null {
  const floor = annualize(money(range.floor, range.currency, range.period));
  const target = annualize(money(range.target, range.currency, range.period));
  if (!floor || !target) return null;
  const ideal =
    range.ideal != null ? annualize(money(range.ideal, range.currency, range.period)) : null;
  return {
    currency: range.currency.toUpperCase(),
    floor: floor.amount,
    target: target.amount,
    ideal: ideal?.amount,
  };
}

/** Grade an offer against a range expressed in the SAME currency and period. */
function gradeAgainst(
  offer: Money,
  range: { floor: number; target: number; ideal?: number },
  label: string,
): { score: number; reason: ScoreMessage } {
  const value = offer.amount;

  if (range.ideal != null && value >= range.ideal) {
    return { score: WEIGHTS.comp, reason: message("comp.ideal", { label }) };
  }
  if (value >= range.target) {
    const span = (range.ideal ?? range.target * 1.4) - range.target;
    const bonus = span > 0 ? Math.min(1, (value - range.target) / span) : 1;
    return {
      score: WEIGHTS.comp * (0.85 + 0.15 * bonus),
      reason: message("comp.target", { label }),
    };
  }
  if (value >= range.floor) {
    const span = range.target - range.floor;
    const fraction = span > 0 ? (value - range.floor) / span : 0;
    return {
      score: WEIGHTS.comp * (0.4 + 0.45 * fraction),
      reason: message("comp.range", { label }),
    };
  }
  return { score: 0, reason: message("comp.below", { label }) };
}

/* ------------------------------- Blockers -------------------------------- */

function findBlockers(input: ScoreInput, profile: Profile): ScoreMessage[] {
  const haystack = normalize(`${input.title} ${input.locationRaw ?? ""} ${input.descriptionText ?? ""}`);
  const found: ScoreMessage[] = [];
  for (const b of profile.blockers) {
    try {
      if (new RegExp(b.pattern, "i").test(haystack)) {
        found.push(message("blocker.profile", { reason: b.reason }));
      }
    } catch {
      // A malformed pattern must not take down the whole scoring run.
      found.push(message("blocker.invalidPattern", { pattern: b.pattern }));
    }
  }
  return [...new Map(found.map((item) => [JSON.stringify(item), item])).values()];
}

/* --------------------------------- Score --------------------------------- */

export function scoreJob(
  input: ScoreInput,
  contextOrProfile: ScoringContext | Profile,
  legacyFx: FxTable | null = null,
): ScoreResult {
  const context: ScoringContext = "profile" in contextOrProfile
    ? contextOrProfile
    : { profile: contextOrProfile, fx: legacyFx, asOf: Date.now() };
  const { profile, fx } = context;
  const fullText = `${input.title}\n${input.descriptionText ?? ""}`;

  const policy: MatchPolicy = {
    workAuthorization: profile.constraints.work_authorization,
    needsVisaSponsorshipFor: profile.constraints.needs_visa_sponsorship_for,
    contractModels: profile.constraints.contract_models,
    remoteOnly: profile.constraints.remote_only,
    acceptableRegions: profile.constraints.acceptable_regions,
    maxTimezoneOffsetHours: profile.constraints.max_timezone_offset_hours,
  };
  const eligibility = evaluateEligibility(policy, input.eligibility);

  const title = scoreTitle(input.title, profile);
  const keywords = scoreKeywords(fullText, profile);
  const seniority = scoreSeniority(fullText, profile);
  const geo = scoreGeo(input, profile, eligibility);
  const comp = scoreComp(input, profile, fx);
  const fresh = scoreFreshness(input, context.asOf);
  const benefits = scoreBenefits(input.descriptionText, profile.compensation.benefits);
  const blockers = findBlockers(input, profile);
  if (eligibility.status === "ineligible") {
    blockers.push(...eligibility.reasons.map((reason) =>
      message("blocker.eligibility", { reason })
    ));
  }

  // A benefit the candidate marked `required` and a readable posting does not
  // offer is a real blocker. `scoreBenefits` only ever reports this for postings
  // long enough that silence actually means something.
  for (const missing of benefits.missingRequired) {
    blockers.push(message("blocker.missingBenefit", { benefit: missing.replace(/_/g, " ") }));
  }

  // Blockers cap the score rather than zeroing it: a great role that says
  // "US preferred" is still worth seeing, just not at the top of the list.
  const penalty = blockers.length * 12 + (keywords.negatives.length > 0 ? 5 : 0);

  const freshnessScore = fresh.factor * WEIGHTS.freshness;
  const benefitScore = benefits.factor * WEIGHTS.benefits;

  const rawTotal =
    title.score +
    keywords.score +
    seniority.score +
    geo.score +
    comp.score +
    freshnessScore +
    benefitScore;
  const fit = Math.max(0, Math.min(100, rawTotal - penalty));

  const roundedAge = fresh.ageDays === null ? null : Math.round(fresh.ageDays);
  const freshnessReason = roundedAge === null
    ? message("freshness.unknown")
    : roundedAge <= PLATEAU_DAYS
      ? message("freshness.hot", { days: roundedAge })
      : message("freshness.aged", { days: roundedAge });
  const wantedBenefits = benefits.detected.filter((benefit) =>
    profile.compensation.benefits.preferred.includes(benefit) ||
    profile.compensation.benefits.nice_to_have.includes(benefit)
  );
  const benefitReason = !benefits.readable
    ? message("benefits.unknown")
    : benefits.detected.length === 0
      ? message("benefits.none")
      : wantedBenefits.length > 0
        ? message("benefits.offers", { benefits: wantedBenefits.join(", ").replace(/_/g, " ") })
        : message("benefits.unwanted");

  const reasons: ScoreMessage[] = [
    title.reason,
    message("keywords.matched", { count: keywords.matched.length }),
    seniority.reason,
    geo.reason,
    comp.reason,
    freshnessReason,
    benefitReason,
  ];
  if (keywords.negatives.length > 0) {
    reasons.push(message("keywords.offAxis", { terms: keywords.negatives.join(", ") }));
  }

  return {
    fit: Math.round(fit * 10) / 10,
    titleScore: Math.round(title.score * 10) / 10,
    keywordScore: Math.round(keywords.score * 10) / 10,
    seniorityScore: Math.round(seniority.score * 10) / 10,
    geoScore: Math.round(geo.score * 10) / 10,
    compScore: Math.round(comp.score * 10) / 10,
    freshnessScore: Math.round(freshnessScore * 10) / 10,
    benefitScore: Math.round(benefitScore * 10) / 10,
    penalty,
    cluster: title.cluster,
    matchedKeywords: keywords.matched,
    missingKeywords: keywords.missing,
    detectedBenefits: benefits.detected,
    ageDays: roundedAge,
    reasons,
    blockers,
    eligibility,
  };
}
