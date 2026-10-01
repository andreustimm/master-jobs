import type {
  EligibilityReason,
  ScoreMessage,
  ScoreMessageCode,
} from "../../contexts/matching/index.ts";
import type { TranslationKey, Translator } from "./index.ts";

const MESSAGE_KEYS: Record<ScoreMessageCode, TranslationKey> = {
  "title.avoided": "scoreReason.titleAvoided",
  "title.noMatch": "scoreReason.titleNoMatch",
  "title.match": "scoreReason.titleMatch",
  "keywords.matched": "scoreReason.keywordsMatched",
  "keywords.offAxis": "scoreReason.keywordsOffAxis",
  "seniority.unknown": "scoreReason.seniorityUnknown",
  "seniority.under": "scoreReason.seniorityUnder",
  "seniority.match": "scoreReason.seniorityMatch",
  "seniority.below": "scoreReason.seniorityBelow",
  "geo.ineligible": "scoreReason.geoIneligible",
  "geo.eligible": "scoreReason.geoEligible",
  "geo.latam": "scoreReason.geoLatam",
  "geo.worldwide": "scoreReason.geoWorldwide",
  "geo.restricted": "scoreReason.geoRestricted",
  "geo.physical": "scoreReason.geoPhysical",
  "geo.unknown": "scoreReason.geoUnknown",
  "geo.remoteUnknown": "scoreReason.geoRemoteUnknown",
  "comp.undisclosed": "scoreReason.compUndisclosed",
  "comp.noCurrency": "scoreReason.compNoCurrency",
  "comp.badPeriod": "scoreReason.compBadPeriod",
  "comp.projectRejected": "scoreReason.compProjectRejected",
  "comp.projectNoDuration": "scoreReason.compProjectNoDuration",
  "comp.projectTooLong": "scoreReason.compProjectTooLong",
  "comp.ideal": "scoreReason.compIdeal",
  "comp.target": "scoreReason.compTarget",
  "comp.range": "scoreReason.compRange",
  "comp.below": "scoreReason.compBelow",
  "comp.noBasis": "scoreReason.compNoBasis",
  "freshness.unknown": "scoreReason.freshnessUnknown",
  "freshness.hot": "scoreReason.freshnessHot",
  "freshness.aged": "scoreReason.freshnessAged",
  "benefits.unknown": "scoreReason.benefitsUnknown",
  "benefits.none": "scoreReason.benefitsNone",
  "benefits.offers": "scoreReason.benefitsOffers",
  "benefits.unwanted": "scoreReason.benefitsUnwanted",
  "blocker.profile": "scoreReason.blockerProfile",
  "blocker.invalidPattern": "scoreReason.blockerInvalidPattern",
  "blocker.missingBenefit": "scoreReason.blockerMissingBenefit",
  "blocker.eligibility": "scoreReason.blockerEligibility",
  legacy: "scoreReason.legacy",
};

const ELIGIBILITY_KEYS: Record<EligibilityReason, TranslationKey> = {
  "remote-required": "scoreReason.eligibilityRemoteRequired",
  "remote-confirmed": "scoreReason.eligibilityRemoteConfirmed",
  "region-accepted": "scoreReason.eligibilityRegionAccepted",
  "region-rejected": "scoreReason.eligibilityRegionRejected",
  "contract-accepted": "scoreReason.eligibilityContractAccepted",
  "contract-rejected": "scoreReason.eligibilityContractRejected",
  "timezone-accepted": "scoreReason.eligibilityTimezoneAccepted",
  "timezone-rejected": "scoreReason.eligibilityTimezoneRejected",
  "authorization-compatible": "scoreReason.eligibilityAuthorizationCompatible",
  "sponsorship-offered": "scoreReason.eligibilitySponsorshipOffered",
  "authorization-unavailable": "scoreReason.eligibilityAuthorizationUnavailable",
  "sponsorship-unavailable": "scoreReason.eligibilitySponsorshipUnavailable",
  "data-unavailable": "scoreReason.eligibilityDataUnavailable",
};

/** Messages whose `label` is a `formatMoney` string written by the scorer. */
const MONEY_LABEL_CODES: ReadonlySet<ScoreMessageCode> = new Set([
  "comp.projectNoDuration",
  "comp.ideal",
  "comp.target",
  "comp.range",
  "comp.below",
  "comp.noBasis",
]);

const PERIOD_KEYS: Record<string, TranslationKey> = {
  month: "jobs.moneyPeriodMonth",
  week: "jobs.moneyPeriodWeek",
  day: "jobs.moneyPeriodDay",
  hour: "jobs.moneyPeriodHour",
};

/**
 * The three suffixes `formatMoney` writes when called without labels, which
 * is how the scorer calls it: `/month` (week, day, hour), ` total (N meses)`
 * and ` total`. A converted label carries the suffix mid-string
 * (`CA$5,000/month ≈ $43,800`), hence the global match.
 */
const MONEY_SUFFIX = /\/(month|week|day|hour)\b| total \((\d+) meses\)| total(?=$| ≈)/g;

/**
 * The scorer stores the pay label already formatted, with no locale: it is
 * pure domain and cannot know who will read the score later (issue #426).
 * The stored text is closed-form, so the suffix is swapped here, at the edge
 * that knows the reader's language. The amount itself stays as stored.
 *
 * Doing it at render time, rather than in the scorer, keeps the stored output
 * byte-identical: no `SCORER_VERSION` bump and no rescore of what is already
 * in the database (G08).
 */
function localizeMoneyLabel(label: string, t: Translator["t"]): string {
  return label.replace(MONEY_SUFFIX, (_match, period?: string, months?: string) => {
    const periodKey = period ? PERIOD_KEYS[period] : undefined;
    if (periodKey) return `/${t(periodKey)}`;
    if (months) return ` ${t("jobs.moneyProjectTotalWithDuration", { count: Number(months) })}`;
    return ` ${t("jobs.moneyProjectTotal")}`;
  });
}

export function renderScoreMessage(message: ScoreMessage, t: Translator["t"]): string {
  const params = { ...message.params };
  if (MONEY_LABEL_CODES.has(message.code) && typeof params.label === "string") {
    params.label = localizeMoneyLabel(params.label, t);
  }
  if (message.code === "blocker.eligibility" && typeof params.reason === "string") {
    const key = ELIGIBILITY_KEYS[params.reason as EligibilityReason];
    if (key) params.reason = t(key);
  }
  return t(MESSAGE_KEYS[message.code], params);
}
