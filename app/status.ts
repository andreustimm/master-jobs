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

export function applicationStatusOptions(t: Translator["t"], locale: LocaleId): ApplicationStatusOption[] {
  return APPLICATION_STATUSES
    .map((value) => ({ value, label: applicationStatusLabel(value, t) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
