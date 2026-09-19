import type { TranslationKey, Translator } from "../../src/core/i18n/index.ts";

/**
 * Cada código que uma ação da tela Buscas pode devolver, e a chave do
 * dicionário que o explica.
 *
 * Constante guarda CHAVE, nunca texto (regra 9). As listas são explícitas para
 * o teste percorrê-las: código novo sem chave nos dois idiomas reprova.
 */
export const TERM_CODES = [
  "term_too_short",
  "term_too_long",
  "term_invalid_char",
  "term_no_alnum",
  "term_duplicate",
  "term_limit",
  "track_required",
  "track_archived",
  "primary_pending",
] as const;

export const TRACK_CODES = [
  "track_name_invalid",
  "track_titles_required",
  "track_keywords_required",
  "keyword_weight_invalid",
  "range_required",
  "range_invalid",
  "range_duplicate",
  "range_currency_unknown",
  "range_reference_missing",
  "track_too_large",
  "track_name_duplicate",
  "track_limit",
  "primary_pending",
  "not_found",
  "stale",
  "primary_cannot_archive",
  "track_archived",
] as const;

export const RERUN_CODES = ["cooldown", "running", "not_found"] as const;

/** Successful saves and re-runs say which way the search went. */
export const RUN_OUTCOMES = ["started", "waiting_sweep", "captures_off", "no_platform"] as const;

export const FEEDBACK_KEYS: Record<string, TranslationKey> = {
  ...Object.fromEntries(
    [...TERM_CODES, ...TRACK_CODES, ...RERUN_CODES].map((code) => [code, `searchFeedback.${code}` as TranslationKey]),
  ),
  ...Object.fromEntries(RUN_OUTCOMES.map((run) => [run, `searchFeedback.run_${run}` as TranslationKey])),
};

/** The messages a `MutationFeedbackForm` shows, by result code or run. */
export function feedbackMessages(t: Translator["t"]): Record<string, string> {
  return Object.fromEntries(Object.entries(FEEDBACK_KEYS).map(([code, key]) => [code, t(key)]));
}
