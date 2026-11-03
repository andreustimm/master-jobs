/**
 * O adapter de cada provedor, montado a partir do ambiente (#464).
 *
 * Lê só o que `parseOidcConfig` já validou: credencial ausente ou pela metade
 * devolve `null`, e o emissor falso do E2E só chega aqui onde `issuerFor` o
 * aceita (ADR-010) — em produção, `JHO_OIDC_ISSUER_*` não muda o emissor.
 */
import { parseOidcConfig, type OidcProviderId } from "../../domain/oidc-config.ts";
import type { AuthEnvironment } from "../../domain/open-mode.ts";
import type { OidcProvider } from "../../ports.ts";
import type { OidcAdapterOptions } from "./client.ts";
import { googleProvider } from "./google.ts";
import { linkedinProvider } from "./linkedin.ts";

export function configuredOidcProvider(
  id: OidcProviderId,
  env: AuthEnvironment,
  options: OidcAdapterOptions = {},
): OidcProvider | null {
  const config = parseOidcConfig(env)[id];
  if (config.status !== "configured") return null;
  return id === "google" ? googleProvider(config.settings, options) : linkedinProvider(config.settings, options);
}
