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

export function renderScoreMessage(message: ScoreMessage, t: Translator["t"]): string {
  const params = { ...message.params };
  if (message.code === "blocker.eligibility" && typeof params.reason === "string") {
    const key = ELIGIBILITY_KEYS[params.reason as EligibilityReason];
    if (key) params.reason = t(key);
  }
  return t(MESSAGE_KEYS[message.code], params);
}
