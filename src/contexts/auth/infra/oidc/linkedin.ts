/**
 * Login com LinkedIn pelo produto oficial "Sign In with LinkedIn using OpenID
 * Connect" (#464, ADR-003, regra 1).
 *
 * Escopos **exatamente** `openid profile email`: o LinkedIn só devolve o e-mail
 * no ID token com `profile` junto. **Nunca `w_member_social`** — publicar é
 * outro uso, com outra invariante (`docs/linkedin-policy.md` §6). Do token sai
 * só sujeito, e-mail e verificação; nome, foto e título ficam no adapter e
 * morrem com a requisição. O LinkedIn às vezes omite `email_verified`, e aí o
 * vínculo automático não acontece (`identityFromClaims`).
 */
import type { OidcProviderSettings } from "../../domain/oidc-config.ts";
import type { OidcProvider } from "../../ports.ts";
import { oidcProvider, type OidcAdapterOptions } from "./client.ts";

export const LINKEDIN_SCOPES = "openid profile email";

export function linkedinProvider(settings: OidcProviderSettings, options: OidcAdapterOptions = {}): OidcProvider {
  return oidcProvider(
    {
      id: "linkedin",
      issuer: settings.issuer,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      scopes: LINKEDIN_SCOPES,
      allowInsecure: settings.issuerOverridden,
      ...(options.now === undefined ? {} : { now: options.now }),
    },
    options.fetchImpl,
  );
}
