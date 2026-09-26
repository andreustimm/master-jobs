import {
  APPLICATION_STATUSES,
  FUNNEL_STATUSES,
  type ApplicationStatus,
} from "../src/contexts/pursuit/domain/application.ts";
import type { Translator } from "../src/core/i18n/index.ts";

const STATUS_TRANSLATION_KEYS = {
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
  untracked: "applicationStatus.untracked",
} as const satisfies Record<ApplicationStatus, string>;

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
 * Opções na ORDEM DO FUNIL, e não alfabética: "Candidatura enviada" antes de
 * "Preparando" escondia a hierarquia que a pessoa usa para decidir (#316).
 *
 * `statuses` restringe a lista ao que o domínio aceita a partir do estado
 * atual; quem lista o funil inteiro (filtros) não passa nada. "Fora do funil"
 * nunca é opção: só o desfazer chega lá.
 */
export function applicationStatusOptions(
  t: Translator["t"],
  statuses: readonly ApplicationStatus[] = FUNNEL_STATUSES,
): ApplicationStatusOption[] {
  return APPLICATION_STATUSES
    .filter((value) => statuses.includes(value))
    .map((value) => ({ value, label: applicationStatusLabel(value, t) }));
}
