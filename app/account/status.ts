import type { TranslationKey } from "../../src/core/i18n/index.ts";
import { isOidcProvider, type OidcProviderId } from "../../src/contexts/auth/index.ts";

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
  // Primeira senha de conta só social (#464, US-009).
  "first-password-set": { key: "account.firstPasswordSet", ok: true },
  "first-password-weak_password": { key: "account.errorWeak", ok: false },
  "first-password-has_password": { key: "account.errorHasPassword", ok: false },
  // Desligar provedor (#464, US-008).
  "unlink-last_method": { key: "account.errorLastMethod", ok: false },
  "unlink-not_linked": { key: "account.errorNotLinked", ok: false },
  "unlink-no_account": { key: "account.errorNotLinked", ok: false },
} as const satisfies Record<string, { key: TranslationKey; ok: boolean }>;

export type AccountStatus = keyof typeof ACCOUNT_STATUS;

export function accountStatus(raw: string | undefined): (typeof ACCOUNT_STATUS)[AccountStatus] | null {
  return raw !== undefined && Object.hasOwn(ACCOUNT_STATUS, raw) ? ACCOUNT_STATUS[raw as AccountStatus] : null;
}

/**
 * Retornos que nomeiam um provedor: `?linked=` e `?error=&provider=` vêm do
 * vínculo (`/login/oauth/[provider]/callback`, `intent=link`), e
 * `?unlinked=` da ação de desligar. O provedor passa por `isOidcProvider` e o
 * código por uma lista fechada; o resto vira "esta tentativa expirou", como no
 * `/login` — ninguém chega aqui com outro código sem mexer na URL.
 */
export function providerStatus(params: {
  linked?: string;
  unlinked?: string;
  error?: string;
  provider?: string;
}): { key: TranslationKey; ok: boolean; provider: OidcProviderId } | null {
  if (isOidcProvider(params.linked)) return { key: "account.linked", ok: true, provider: params.linked };
  if (isOidcProvider(params.unlinked)) return { key: "account.unlinked", ok: true, provider: params.unlinked };
  if (!isOidcProvider(params.provider) || !params.error) return null;
  const key: TranslationKey =
    params.error === "taken"
      ? "account.linkTaken"
      : params.error === "already_linked"
        ? "account.linkAlready"
        : params.error === "cancelled"
          ? "account.linkCancelled"
          : params.error === "provider"
            ? "account.linkProvider"
            : params.error === "unavailable"
              ? "account.linkUnavailable"
              : "account.linkExpired";
  return { key, ok: false, provider: params.provider };
}
