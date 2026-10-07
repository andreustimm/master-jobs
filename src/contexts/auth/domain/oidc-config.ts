/**
 * Configuração do login social e do cadastro, lida do ambiente (#464).
 *
 * Puro: recebe o `env`, não o lê, e não toca relógio, rede nem banco (regra 4).
 * Mesmo padrão de `src/core/storage/config.ts`: ausência é "não configurado",
 * configuração pela metade é "inválido", e só o completo vale.
 *
 * **Credencial não sai daqui por mensagem.** Todo motivo de recusa cita o NOME
 * da variável, nunca o valor (regra 16, G41) — client secret, client id e URL
 * de emissor incluídos.
 *
 * **Os portões de ambiente falham fechado.** O botão social só existe onde há
 * origem pública fixa (ADR-005): a URL de retorno cadastrada no Google e no
 * LinkedIn não pode depender do `Host` da requisição (G17). E os desvios de
 * teste — emissor falso (ADR-010) e sink de e-mail em arquivo (ADR-011) — só
 * valem com `JHO_ENV` declarado `local` ou `e2e`, fora da Vercel; em qualquer
 * outro ambiente são ignorados, mesmo quando alguém os cadastra por engano.
 */
import { isLocalProcess, type AuthEnvironment } from "./open-mode.ts";
import { resolvePublicOrigin } from "./public-origin.ts";

export const OIDC_PROVIDERS = ["google", "linkedin"] as const;
export type OidcProviderId = (typeof OIDC_PROVIDERS)[number];

export function isOidcProvider(value: string | null | undefined): value is OidcProviderId {
  return (OIDC_PROVIDERS as readonly string[]).includes(value ?? "");
}

/** Emissores reais. O LinkedIn publica a descoberta OIDC sob `/oauth`. */
export const DEFAULT_ISSUERS: Readonly<Record<OidcProviderId, string>> = {
  google: "https://accounts.google.com",
  linkedin: "https://www.linkedin.com/oauth",
};

/** Variáveis de cada provedor. As do LinkedIn são as do app de publicação (ADR-003). */
const CREDENTIAL_VARS: Readonly<Record<OidcProviderId, { id: string; secret: string; issuer: string }>> = {
  google: {
    id: "GOOGLE_OIDC_CLIENT_ID",
    secret: "GOOGLE_OIDC_CLIENT_SECRET",
    issuer: "JHO_OIDC_ISSUER_GOOGLE",
  },
  linkedin: {
    id: "LINKEDIN_CLIENT_ID",
    secret: "LINKEDIN_CLIENT_SECRET",
    issuer: "JHO_OIDC_ISSUER_LINKEDIN",
  },
};

export type OidcProviderSettings = {
  clientId: string;
  clientSecret: string;
  issuer: string;
  /** O emissor veio de `JHO_OIDC_ISSUER_*` (provedor falso do E2E). */
  issuerOverridden: boolean;
};

export type OidcProviderConfig =
  | { status: "configured"; settings: OidcProviderSettings }
  | { status: "unconfigured" }
  | { status: "invalid"; reason: string };

export type OidcConfig = Readonly<Record<OidcProviderId, OidcProviderConfig>>;

function value(env: AuthEnvironment, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

function present(raw: string | undefined): boolean {
  return raw !== undefined && raw !== "";
}

/** `origin` de uma URL http(s) válida; `null` para qualquer outra coisa. */
function httpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // O emissor OIDC pode ter caminho (o do LinkedIn tem). Sem barra final,
    // porque o `iss` do token é comparado literalmente.
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Ambientes em que os desvios de teste valem: a máquina de quem desenvolve e
 * a suíte E2E isolada, que se declara `e2e` sem se passar por `local` (o que
 * ligaria o modo aberto e o mailer de terminal).
 */
const TEST_OVERRIDE_ENVIRONMENTS: readonly string[] = ["local", "e2e"];

/**
 * Desvios de teste (emissor falso, sink de e-mail) podem valer aqui?
 *
 * **Lista de permissão (G27, #378):** só com `JHO_ENV` declarado `local` ou
 * `e2e`. Ausente, vazio, digitado errado (`prod`, `producao`) ou qualquer valor
 * inventado depois recusa — um emissor falso aceito num servidor público assina
 * ID token de qualquer e-mail, e o vínculo por e-mail (ADR-001) entrega a conta.
 * E nunca num deployment da Vercel (`VERCEL` ou `VERCEL_ENV` presentes, de
 * qualquer valor), mesmo que `JHO_ENV` minta — a mesma prova de deployment de
 * `isLocalProcess`.
 */
export function testOverridesAllowed(env: AuthEnvironment): boolean {
  if (present(env.VERCEL) || present(env.VERCEL_ENV)) return false;
  const declared = env.JHO_ENV?.trim().toLowerCase();
  return declared !== undefined && TEST_OVERRIDE_ENVIRONMENTS.includes(declared);
}

export type IssuerResult =
  | { ok: true; issuer: string; overridden: boolean }
  | { ok: false; reason: string };

/**
 * O emissor do provedor: o real, ou o falso do E2E onde `testOverridesAllowed`
 * deixa (ADR-010).
 *
 * Fora desses ambientes a variável de desvio é ignorada em silêncio — cair no
 * emissor real é o lado seguro. Dentro deles, desvio malformado é erro: cair no
 * emissor real faria a suíte chamar o Google de verdade.
 */
export function issuerFor(provider: OidcProviderId, env: AuthEnvironment): IssuerResult {
  const variable = CREDENTIAL_VARS[provider].issuer;
  const override = value(env, variable);
  if (override === null || !testOverridesAllowed(env)) {
    return { ok: true, issuer: DEFAULT_ISSUERS[provider], overridden: false };
  }
  const issuer = httpUrl(override);
  if (issuer === null) return { ok: false, reason: `${variable} precisa ser uma URL http(s)` };
  return { ok: true, issuer, overridden: true };
}

function parseProvider(provider: OidcProviderId, env: AuthEnvironment): OidcProviderConfig {
  const vars = CREDENTIAL_VARS[provider];
  const clientId = value(env, vars.id);
  const clientSecret = value(env, vars.secret);
  if (clientId === null && clientSecret === null) return { status: "unconfigured" };
  const missing = [
    clientId === null ? vars.id : null,
    clientSecret === null ? vars.secret : null,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) return { status: "invalid", reason: `falta ${missing.join(", ")}` };
  const issuer = issuerFor(provider, env);
  if (!issuer.ok) return { status: "invalid", reason: issuer.reason };
  return {
    status: "configured",
    settings: {
      clientId: clientId!,
      clientSecret: clientSecret!,
      issuer: issuer.issuer,
      issuerOverridden: issuer.overridden,
    },
  };
}

/** Estado de cada provedor. Um provedor sem credencial some sozinho (ADR-005). */
export function parseOidcConfig(env: AuthEnvironment): OidcConfig {
  return {
    google: parseProvider("google", env),
    linkedin: parseProvider("linkedin", env),
  };
}

/**
 * O ambiente admite login social? (ADR-005)
 *
 * Só onde a origem pública é fixa — a URL de retorno é cadastrada no provedor
 * e não pode vir do `Host` (G17):
 *
 * - **local** (`isLocalProcess`): `127.0.0.1:3000`, cadastrado no provedor;
 * - **Vercel**: só `VERCEL_ENV=production`, com origem resolvível
 *   (`JHO_PUBLIC_URL` ou `VERCEL_PROJECT_PRODUCTION_URL`). Preview muda de URL
 *   a cada deploy;
 * - **fora da Vercel** (plano B no Fly, E2E isolado): só com `JHO_PUBLIC_URL`
 *   válida.
 *
 * `JHO_ENV=preview` ou `staging` recusa em qualquer caso, mesmo que alguém
 * cadastre `JHO_PUBLIC_URL` onde não devia.
 */
export function socialAvailable(env: AuthEnvironment): boolean {
  if (isLocalProcess(env)) return true;
  const declared = env.JHO_ENV?.trim().toLowerCase();
  if (declared === "preview" || declared === "staging") return false;
  const onVercel = present(env.VERCEL) || present(env.VERCEL_ENV);
  if (onVercel) {
    if (env.VERCEL_ENV?.trim() !== "production") return false;
    return resolvePublicOrigin(env, { host: null, proto: "https" }) !== null;
  }
  const configured = value(env, "JHO_PUBLIC_URL");
  return configured !== null && httpUrl(configured) !== null;
}

/** Tamanho mínimo do segredo que deriva a chave do cookie do fluxo. */
export const SESSION_SECRET_MIN_LENGTH = 32;

export type SessionSecretConfig =
  | { status: "configured"; secret: string }
  | { status: "unconfigured" }
  | { status: "invalid"; reason: string };

/**
 * O segredo de onde sai a chave do cookie cifrado do fluxo OIDC (ADR-012).
 *
 * Sem ele não há login social: o cookie guarda `state`, `nonce` e o
 * verificador PKCE, e um cookie sem cifra e assinatura deixaria trocar o
 * `next` ou reaproveitar um fluxo alheio. Curto demais é inválido.
 */
export function parseSessionSecret(env: AuthEnvironment): SessionSecretConfig {
  const secret = value(env, "JHO_SESSION_SECRET");
  if (secret === null) return { status: "unconfigured" };
  if (secret.length < SESSION_SECRET_MIN_LENGTH) {
    return {
      status: "invalid",
      reason: `JHO_SESSION_SECRET precisa ter ao menos ${SESSION_SECRET_MIN_LENGTH} caracteres`,
    };
  }
  return { status: "configured", secret };
}

/**
 * Os provedores que a tela mostra e a rota aceita, nesta ordem.
 *
 * Os três portões juntos: ambiente (`socialAvailable`), segredo do cookie do
 * fluxo e credenciais do provedor. Qualquer um faltando esconde o botão — e a
 * rota de início recusa do mesmo jeito, para quem chegar pela URL (US-014.AC-3).
 */
export function availableProviders(env: AuthEnvironment): OidcProviderId[] {
  if (!socialAvailable(env)) return [];
  if (parseSessionSecret(env).status !== "configured") return [];
  const config = parseOidcConfig(env);
  return OIDC_PROVIDERS.filter((provider) => config[provider].status === "configured");
}

/** Limite padrão de contas criadas por IP numa janela de 60 minutos (ADR-002). */
export const DEFAULT_SIGNUP_MAX_PER_IP_HOUR = 3;

export type SignupLimits = { maxPerIpHour: number };

/**
 * Limites do cadastro aberto.
 *
 * `JHO_SIGNUP_MAX_PER_IP_HOUR` aceita só inteiro positivo; vazio, zero,
 * negativo, fração ou texto caem no padrão (US-006.EC-5). Zero não desliga o
 * cadastro: desligar seria outra decisão, e um erro de digitação não pode
 * tomá-la.
 */
export function parseSignupLimits(env: AuthEnvironment): SignupLimits {
  const raw = value(env, "JHO_SIGNUP_MAX_PER_IP_HOUR");
  if (raw === null || !/^\d+$/.test(raw)) return { maxPerIpHour: DEFAULT_SIGNUP_MAX_PER_IP_HOUR };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return { maxPerIpHour: DEFAULT_SIGNUP_MAX_PER_IP_HOUR };
  return { maxPerIpHour: parsed };
}

/**
 * Diretório do sink de e-mail em arquivo, ou `null` (ADR-011).
 *
 * Só com `JHO_ENV` `local` ou `e2e`, fora da Vercel (`testOverridesAllowed`):
 * em produção o e-mail sai pelo Resend, e em Preview fica omitido. Uma
 * `JHO_MAIL_SINK` cadastrada por engano num servidor é ignorada — o código de
 * cadastro nunca vai parar num arquivo do servidor.
 */
export function mailSinkDir(env: AuthEnvironment): string | null {
  const dir = value(env, "JHO_MAIL_SINK");
  if (dir === null || !testOverridesAllowed(env)) return null;
  return dir;
}
