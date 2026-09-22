import type { TranslationKey } from "../../src/core/i18n/index.ts";

/**
 * O resultado de cada ação da conta, como volta na URL.
 *
 * Lista fechada: a página só mostra mensagem de um código daqui, então um
 * `?status=` inventado não injeta texto nenhum. `ok` separa sucesso de erro
 * para a página escolher `role="status"` ou `role="alert"`.
 */
export const ACCOUNT_STATUS = {
  "name-saved": { key: "account.nameSaved", ok: true },
  "name-required": { key: "account.nameRequired", ok: false },
  "password-changed": { key: "account.passwordChanged", ok: true },
  "password-invalid": { key: "account.errorInvalid", ok: false },
  "password-weak": { key: "account.errorWeak", ok: false },
  "password-mismatch": { key: "account.errorMismatch", ok: false },
  "password-rate_limited": { key: "account.errorRateLimited", ok: false },
  "password-unavailable": { key: "account.errorUnavailable", ok: false },
  "password-no_password": { key: "account.noPassword", ok: false },
} as const satisfies Record<string, { key: TranslationKey; ok: boolean }>;

export type AccountStatus = keyof typeof ACCOUNT_STATUS;

export function accountStatus(raw: string | undefined): (typeof ACCOUNT_STATUS)[AccountStatus] | null {
  return raw !== undefined && Object.hasOwn(ACCOUNT_STATUS, raw) ? ACCOUNT_STATUS[raw as AccountStatus] : null;
}
