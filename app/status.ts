import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "../src/contexts/pursuit/domain/application.ts";
import type { LocaleId, TranslationKey, Translator } from "../src/core/i18n/index.ts";

const STATUS_TRANSLATION_KEYS: Record<ApplicationStatus, TranslationKey> = {
  backlog: "applicationStatus.backlog",
  shortlisted: "applicationStatus.shortlisted",
  preparing: "applicationStatus.preparing",
  applied: "applicationStatus.applied",
  screening: "applicationStatus.screening",
  interviewing: "applicationStatus.interviewing",
  offer: "applicationStatus.offer",
  rejected: "applicationStatus.rejected",
  withdrawn: "applicationStatus.withdrawn",
  archived: "applicationStatus.archived",
};

export type ApplicationStatusOption = {
  value: ApplicationStatus;
  label: string;
};

export function applicationStatusLabel(status: string, t: Translator["t"]): string {
  if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) return status;
  return t(STATUS_TRANSLATION_KEYS[status as ApplicationStatus]);
}

/**
 * Todos os rótulos traduzidos, para quem precisa nomear um status que não está
 * na lista oferecida — a mensagem de recusa cita o estado gravado, e ele pode
 * não ser alcançável a partir de si mesmo na tela.
 */
export function applicationStatusLabels(t: Translator["t"]): Record<ApplicationStatus, string> {
  return Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, applicationStatusLabel(status, t)]),
  ) as Record<ApplicationStatus, string>;
}

/**
 * `statuses` restringe a lista ao que o domínio aceita a partir do estado
 * atual. Quem lista o funil inteiro (filtros) não passa nada; quem oferece uma
 * mudança passa `allowedTransitions(atual)`.
 */
export function applicationStatusOptions(
  t: Translator["t"],
  locale: LocaleId,
  statuses: readonly ApplicationStatus[] = APPLICATION_STATUSES,
): ApplicationStatusOption[] {
  return statuses
    .map((value) => ({ value, label: applicationStatusLabel(value, t) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
