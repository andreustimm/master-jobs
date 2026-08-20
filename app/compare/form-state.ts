import type {
  ComparisonErrorCode as MatchingComparisonErrorCode,
  ComparisonField as MatchingComparisonField,
} from "../../src/contexts/matching/index.ts";

export const COMPARE_FIELDS = [
  "title",
  "companyName",
  "location",
  "url",
  "description",
  "file",
] as const;

export type CompareField = MatchingComparisonField;
export type CompareErrorCode = MatchingComparisonErrorCode;

export type CompareActionState = {
  status: "idle" | "error";
  fieldErrors?: Partial<Record<CompareField, CompareErrorCode[]>>;
  formError?: CompareErrorCode;
};

export const INITIAL_COMPARE_STATE: CompareActionState = { status: "idle" };
