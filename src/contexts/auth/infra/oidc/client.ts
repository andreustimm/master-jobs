/**
 * O cliente OpenID Connect comum ao Google e ao LinkedIn (#464, ADR-008).
 *
 * `oauth4webapi` faz o que é especificação — descoberta, PKCE S256, troca do
 * código, validação das afirmações (`iss`, `aud`, `exp`, `iat`, `nonce`) e da
 * assinatura contra o JWKS do emissor. Este arquivo decide o que a porta
 * promete: erro do provedor é valor, nunca exceção, e só a identidade mínima
 * sai daqui (ADR-003).
 *
 * **Transporte.** É o único arquivo do login social que sai para a rede, pelo
 * `fetch` injetado (`fetchImpl`); por isso está no inventário de
 * `tests/outbound-transport-boundary.test.ts`. Nenhuma tentativa de novo dentro
 * de uma requisição: o provedor fora do ar vira "não conseguimos falar com o
 * Google" e a pessoa tenta de novo (US-001.EC-3).
 *
 * **HTTP sem TLS** só para o emissor falso do E2E, e só quando o emissor veio
 * do desvio que `issuerFor` aceita (`JHO_ENV` `local`/`e2e`, fora da Vercel).
 */
import * as oauth from "oauth4webapi";
import { normalizeEmail } from "../../domain/identity-resolution.ts";
import type { OidcProviderId } from "../../domain/oidc-config.ts";
import type { OidcCompletion, OidcFlowState, OidcProvider, OidcStart, VerifiedIdentity } from "../../ports.ts";

/** Tempo máximo de cada chamada ao provedor. Mais que isto, a pessoa tenta de novo. */
const REQUEST_TIMEOUT_MS = 10_000;

export type OidcClientSettings = {
  id: OidcProviderId;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Exatamente os escopos pedidos ao provedor, separados por espaço. */
  scopes: string;
  /** Aceita `http://` — só o emissor falso de loopback do E2E. */
  allowInsecure: boolean;
  /** Relógio do `createdAt` do fluxo. O teste fixa; produção usa o de parede. */
  now?: () => Date;
};

/** O que o teste e a composição injetam num adapter: transporte e relógio. */
export type OidcAdapterOptions = { fetchImpl?: typeof fetch; now?: () => Date };

/** `true` só para a afirmação explícita. Ausente, `false` ou texto estranho: não verificado. */
function verifiedClaim(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * O que sai do ID token: sujeito, e-mail e verificação. Nada mais (ADR-003).
 *
 * O LinkedIn às vezes omite `email_verified`; ausência conta como não
 * verificado, e o vínculo automático não acontece (ADR-001).
 */
export function identityFromClaims(provider: OidcProviderId, claims: oauth.IDToken): VerifiedIdentity | null {
  const subject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  if (subject === "") return null;
  const rawEmail = typeof claims.email === "string" ? normalizeEmail(claims.email) : "";
  return {
    provider,
    subject,
    email: rawEmail === "" ? null : rawEmail,
    emailVerified: rawEmail !== "" && verifiedClaim(claims.email_verified),
  };
}

/** Erros que dizem "o token não presta", e não "o provedor não respondeu". */
const VALIDATION_CODES = new Set<string>([
  oauth.KEY_SELECTION,
  oauth.INVALID_RESPONSE,
  oauth.JWT_TIMESTAMP_CHECK,
  oauth.JWT_CLAIM_COMPARISON,
  oauth.JSON_ATTRIBUTE_COMPARISON,
  oauth.PARSE_ERROR,
]);

function validationFailure(error: unknown): boolean {
  return error instanceof oauth.OperationProcessingError && VALIDATION_CODES.has(error.code ?? "");
}

export function oidcProvider(settings: OidcClientSettings, fetchImpl: typeof fetch = fetch): OidcProvider {
  const issuer = new URL(settings.issuer);
  const client: oauth.Client = { client_id: settings.clientId };
  const clientAuth = oauth.ClientSecretPost(settings.clientSecret);
  const http = {
    [oauth.customFetch]: fetchImpl,
    [oauth.allowInsecureRequests]: settings.allowInsecure,
    signal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  const now = settings.now ?? (() => new Date());

  async function discover(): Promise<oauth.AuthorizationServer> {
    const response = await oauth.discoveryRequest(issuer, { ...http, algorithm: "oidc" });
    return oauth.processDiscoveryResponse(issuer, response);
  }

  return {
    id: settings.id,

    async start({ redirectUri, intent, next }): Promise<OidcStart> {
      // Lança se o provedor não responde: quem chama transforma em "não
      // conseguimos falar com o provedor" antes de gravar qualquer cookie.
      const as = await discover();
      if (!as.authorization_endpoint) throw new Error(`emissor ${settings.id} sem authorization_endpoint`);
      const codeVerifier = oauth.generateRandomCodeVerifier();
      const state = oauth.generateRandomState();
      const nonce = oauth.generateRandomNonce();
      const url = new URL(as.authorization_endpoint);
      url.searchParams.set("client_id", settings.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", settings.scopes);
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      const flow: OidcFlowState = {
        provider: settings.id,
        state,
        nonce,
        codeVerifier,
        intent,
        next,
        createdAt: now().toISOString(),
      };
      return { url: url.toString(), flow };
    },

    async complete({ redirectUri, callbackUrl, flow }): Promise<OidcCompletion> {
      // Recusa no consentimento chega como `?error=`; é decisão da pessoa e não
      // depende de o provedor estar no ar, então nem consulta a descoberta.
      const error = callbackUrl.searchParams.get("error");
      if (error !== null) {
        return { ok: false, reason: error === "access_denied" ? "cancelled" : "provider_error" };
      }

      let as: oauth.AuthorizationServer;
      try {
        as = await discover();
      } catch {
        return { ok: false, reason: "provider_error" };
      }

      let params: URLSearchParams;
      try {
        params = oauth.validateAuthResponse(as, client, callbackUrl, flow.state);
      } catch (failure) {
        if (failure instanceof oauth.AuthorizationResponseError) {
          return { ok: false, reason: failure.error === "access_denied" ? "cancelled" : "provider_error" };
        }
        return { ok: false, reason: "invalid_response" };
      }

      let response: Response;
      try {
        response = await oauth.authorizationCodeGrantRequest(
          as,
          client,
          clientAuth,
          params,
          redirectUri,
          flow.codeVerifier,
          http,
        );
      } catch {
        return { ok: false, reason: "provider_error" };
      }
      // Erro HTTP do endpoint de token (500, `invalid_grant`…) é o provedor
      // dizendo não — não um token inválido.
      if (!response.ok) return { ok: false, reason: "provider_error" };

      let claims: oauth.IDToken | undefined;
      try {
        const tokens = await oauth.processAuthorizationCodeResponse(as, client, response, {
          expectedNonce: flow.nonce,
          requireIdToken: true,
        });
        // A especificação dispensa a assinatura quando o token vem direto do
        // endpoint por TLS; a ADR-008 pede a validação completa mesmo assim.
        await oauth.validateApplicationLevelSignature(as, response, http);
        claims = oauth.getValidatedIdTokenClaims(tokens);
      } catch (failure) {
        return { ok: false, reason: validationFailure(failure) ? "invalid_response" : "provider_error" };
      }

      const identity = claims === undefined ? null : identityFromClaims(settings.id, claims);
      if (identity === null) return { ok: false, reason: "invalid_response" };
      return { ok: true, identity };
    },
  };
}
