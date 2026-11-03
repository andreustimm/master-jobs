/**
 * Formas de entrar numa conta: o que a tela mostra e o que pode ser desligado
 * (#464, US-008–US-011, ADR-004).
 *
 * Puro: recebe o estado já lido e devolve decisão ou vista. Quem lê é
 * `infra/drizzle-identities.ts`; quem aplica é `app/account-methods.ts`.
 */
import { OIDC_PROVIDERS, type OidcProviderId } from "./oidc-config.ts";

/** Como a identidade foi ligada: pelo e-mail verificado ou pela tela da conta. */
export type IdentityOrigin = "automatic" | "manual";

/** Uma identidade ligada, como o banco a guarda — com campos que a vista descarta. */
export type IdentityRecord = {
  provider: OidcProviderId;
  origin: IdentityOrigin;
  linkedAt: string;
  lastUsedAt: string | null;
};

/** O que a tela da conta, o admin e a CLI leem sobre como a conta entra (US-010). */
export type AccountMethodsRecord = {
  email: string;
  locale: string | null;
  hasPassword: boolean;
  disabled: boolean;
  identities: IdentityRecord[];
  /** Versões dos Termos e da Política aceitas, e quando (US-021.AC-3). */
  terms: { termsVersion: string | null; privacyVersion: string | null; acceptedAt: string | null };
};

/** Desfecho de desligar um provedor, conferido sob trava da linha da conta. */
export type UnlinkOutcome = "unlinked" | "last_method" | "not_linked" | "no_account";

/**
 * Pode desligar `provider` sem deixar a conta sem jeito de entrar?
 *
 * O link mágico não conta: só a CLI o emite, e a pessoa não o controla
 * (ADR-004). Provedor que nem está ligado também é `false` — não há o que
 * desligar.
 */
export function canDisconnect(
  state: { hasPassword: boolean; providers: readonly OidcProviderId[] },
  provider: OidcProviderId,
): boolean {
  if (!state.providers.includes(provider)) return false;
  if (state.hasPassword) return true;
  return state.providers.some((other) => other !== provider);
}

export type ProviderMethod =
  | {
      provider: OidcProviderId;
      linked: true;
      origin: IdentityOrigin;
      linkedAt: string;
      /** ISO 8601, ou `"never"` quando nunca entrou por ela depois de ligar. */
      lastUsed: string;
      availableHere: boolean;
    }
  | { provider: OidcProviderId; linked: false; availableHere: boolean };

export type MethodsView = {
  password: boolean;
  /** Um item por provedor conhecido, na ordem de `OIDC_PROVIDERS`. */
  providers: ProviderMethod[];
};

/**
 * A lista de métodos da conta (US-010).
 *
 * Só provedor, datas, origem e disponibilidade saem daqui — nunca sujeito,
 * e-mail do provedor, nome ou foto (US-010.AC-2). O objeto de saída é montado
 * campo a campo, e não por espalhamento, para que um campo novo no registro
 * não vaze para a tela sem alguém decidir.
 */
export function methodsView(
  state: { hasPassword: boolean; identities: readonly IdentityRecord[] },
  available: readonly OidcProviderId[],
): MethodsView {
  return {
    password: state.hasPassword,
    providers: OIDC_PROVIDERS.map((provider): ProviderMethod => {
      const availableHere = available.includes(provider);
      const identity = state.identities.find((item) => item.provider === provider);
      if (identity === undefined) return { provider, linked: false, availableHere };
      return {
        provider,
        linked: true,
        origin: identity.origin,
        linkedAt: identity.linkedAt,
        lastUsed: identity.lastUsedAt ?? "never",
        availableHere,
      };
    }),
  };
}
