export const SCORE_MESSAGE_CODES = [
  "title.avoided", "title.noMatch", "title.match",
  "keywords.matched", "keywords.offAxis",
  "seniority.unknown", "seniority.under", "seniority.match", "seniority.below",
  "geo.ineligible", "geo.eligible", "geo.latam", "geo.worldwide",
  "geo.restricted", "geo.physical", "geo.unknown", "geo.remoteUnknown",
  "comp.undisclosed", "comp.noCurrency", "comp.badPeriod", "comp.projectRejected",
  "comp.projectNoDuration", "comp.projectTooLong", "comp.ideal", "comp.target",
  "comp.range", "comp.below", "comp.noBasis",
  "freshness.unknown", "freshness.hot", "freshness.aged",
  "benefits.unknown", "benefits.none", "benefits.offers", "benefits.unwanted",
  "blocker.profile", "blocker.invalidPattern", "blocker.missingBenefit",
  "blocker.eligibility", "legacy",
] as const;

export type ScoreMessageCode = (typeof SCORE_MESSAGE_CODES)[number];
export type ScoreMessage = {
  code: ScoreMessageCode;
  params?: Record<string, string | number>;
};

export function message(
  code: ScoreMessageCode,
  params?: Record<string, string | number>,
): ScoreMessage {
  return params ? { code, params } : { code };
}

export function scoreMessages(value: unknown): ScoreMessage[] {
  if (!Array.isArray(value)) return [];
  const codes = new Set<string>(SCORE_MESSAGE_CODES);
  return value.flatMap((item): ScoreMessage[] => {
    if (typeof item === "string") return [message("legacy", { text: item })];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.code !== "string" || !codes.has(record.code)) return [];
    const params = record.params && typeof record.params === "object"
      ? Object.fromEntries(
          Object.entries(record.params).filter((entry): entry is [string, string | number] =>
            typeof entry[1] === "string" || typeof entry[1] === "number"
          ),
        )
      : undefined;
    return [message(record.code as ScoreMessageCode, params)];
  });
}
