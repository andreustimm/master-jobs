/**
 * Login com Google (#464). Difere do LinkedIn só em escopo (ADR-008).
 *
 * `openid email`: o mínimo para o sujeito e o e-mail verificado (ADR-003).
 * Nada de `profile` — nome e foto não servem para decidir sobre vaga.
 */
import type { OidcProviderSettings } from "../../domain/oidc-config.ts";
import type { OidcProvider } from "../../ports.ts";
import { oidcProvider, type OidcAdapterOptions } from "./client.ts";

export const GOOGLE_SCOPES = "openid email";

export function googleProvider(settings: OidcProviderSettings, options: OidcAdapterOptions = {}): OidcProvider {
  return oidcProvider(
    {
      id: "google",
      issuer: settings.issuer,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      scopes: GOOGLE_SCOPES,
      allowInsecure: settings.issuerOverridden,
      ...(options.now === undefined ? {} : { now: options.now }),
    },
    options.fetchImpl,
  );
}
