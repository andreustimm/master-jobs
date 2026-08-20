export type EligibilityStatus = "eligible" | "ineligible" | "unverifiable";

export type MatchPolicy = {
  workAuthorization: readonly string[];
  needsVisaSponsorshipFor: readonly string[];
  contractModels: readonly string[];
  remoteOnly: boolean;
  acceptableRegions: readonly string[];
  maxTimezoneOffsetHours: number;
};

export type EligibilitySignals = {
  workAuthorization?: readonly string[];
  sponsorship?: "offered" | "not_offered" | "unknown";
  regions?: readonly string[];
  timezoneOffsetHours?: number | null;
  contractModels?: readonly string[];
  remote?: boolean | null;
};

export type EligibilityResult = {
  status: EligibilityStatus;
  reasons: EligibilityReason[];
};

export type EligibilityReason =
  | "remote-required"
  | "remote-confirmed"
  | "region-accepted"
  | "region-rejected"
  | "contract-accepted"
  | "contract-rejected"
  | "timezone-accepted"
  | "timezone-rejected"
  | "authorization-compatible"
  | "sponsorship-offered"
  | "authorization-unavailable"
  | "sponsorship-unavailable"
  | "data-unavailable";

const normalize = (value: string) => value.trim().toLowerCase().replace(/[_\s]+/g, "-");
const overlap = (left: readonly string[], right: readonly string[]) => {
  const accepted = new Set(left.map(normalize));
  return right.some((value) => accepted.has(normalize(value)));
};

/** Missing structured evidence is neutral: it can never become ineligible. */
export function evaluateEligibility(
  policy: MatchPolicy,
  signals: EligibilitySignals = {},
): EligibilityResult {
  const failures: EligibilityReason[] = [];
  const evidence: EligibilityReason[] = [];

  if (policy.remoteOnly && signals.remote === false) {
    failures.push("remote-required");
  } else if (signals.remote === true) {
    evidence.push("remote-confirmed");
  }

  if (signals.regions && signals.regions.length > 0) {
    if (overlap(policy.acceptableRegions, signals.regions)) evidence.push("region-accepted");
    else failures.push("region-rejected");
  }

  if (signals.contractModels && signals.contractModels.length > 0) {
    if (overlap(policy.contractModels, signals.contractModels)) evidence.push("contract-accepted");
    else failures.push("contract-rejected");
  }

  if (signals.timezoneOffsetHours != null) {
    if (Math.abs(signals.timezoneOffsetHours) <= policy.maxTimezoneOffsetHours) {
      evidence.push("timezone-accepted");
    } else {
      failures.push("timezone-rejected");
    }
  }

  if (signals.workAuthorization && signals.workAuthorization.length > 0) {
    if (overlap(policy.workAuthorization, signals.workAuthorization)) {
      evidence.push("authorization-compatible");
    } else if (
      signals.sponsorship === "offered" &&
      overlap(policy.needsVisaSponsorshipFor, signals.workAuthorization)
    ) {
      evidence.push("sponsorship-offered");
    } else {
      failures.push(
        signals.sponsorship === "not_offered"
          ? "sponsorship-unavailable"
          : "authorization-unavailable",
      );
    }
  }

  if (failures.length > 0) return { status: "ineligible", reasons: failures };
  if (evidence.length > 0) return { status: "eligible", reasons: evidence };
  return { status: "unverifiable", reasons: ["data-unavailable"] };
}
