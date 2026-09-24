import type { CatalogSource } from "../../../src/contexts/sourcing/index.ts";
import type { Translator } from "../../../src/core/i18n/index.ts";

type T = Translator["t"];

/** O estado da fonte em chave de dicionário — texto nunca mora aqui (regra 9). */
export function sourceStateLabel(source: Pick<CatalogSource, "enabled" | "retiredAt">) {
  if (source.retiredAt) return "platforms.retired" as const;
  return source.enabled ? ("platforms.enabled" as const) : ("platforms.disabled" as const);
}

/** Mensagens por código de recusa do catálogo e da execução. */
export function catalogErrorMessages(t: T): Record<string, string> {
  return {
    unknown_kind: t("platforms.errorUnknownKind"),
    handle_invalid: t("platforms.errorHandleInvalid"),
    handle_too_long: t("platforms.errorHandleTooLong"),
    handle_reserved: t("platforms.errorHandleReserved"),
    label_empty: t("platforms.errorLabelEmpty"),
    label_too_long: t("platforms.errorLabelTooLong"),
    duplicate: t("platforms.errorDuplicate"),
    secret_ref_invalid: t("platforms.errorSecretInvalid"),
    secret_ref_looks_like_secret: t("platforms.errorSecretLooksLikeSecret"),
    not_found_or_retired: t("platforms.errorRetired"),
    source_disabled: t("platforms.errorDisabled"),
    source_retired: t("platforms.errorRetired"),
    source_not_found: t("platforms.errorNotFound"),
    ingestion_blocked: t("platforms.errorIngestionBlocked"),
    confirm_required: t("platforms.retireNeedsConfirm"),
    reachable: t("platforms.probeReachable"),
    empty: t("platforms.probeEmpty"),
    blocked: t("platforms.probeBlocked"),
    failed: t("platforms.probeFailed"),
    enabled: t("platforms.enabledSaved"),
    disabled: t("platforms.disabledSaved"),
  };
}
