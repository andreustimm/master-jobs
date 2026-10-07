/**
 * Login social: o início do fluxo e o retorno do provedor (#464).
 *
 * Orquestra; não decide. Quem decide a identidade é
 * `domain/identity-resolution.ts`; quem fala com o provedor é o adapter da
 * porta `OidcProvider`; quem guarda é `infra/`. Tudo entra por `SocialDeps` e
 * `SocialConfig`, montados em `index.ts` — este arquivo não lê ambiente, banco
 * nem relógio por conta própria (regra 4).
 *
 * O que ele garante, em ordem:
 *
 * 1. **Disponibilidade antes de tudo** (ADR-005): provedor fora da lista do
 *    ambiente recusa no início E no retorno, com "não disponível aqui".
 * 2. **O retorno vale uma vez.** O cookie cifrado traz `state`, `nonce` e o
 *    verificador PKCE; `state` diferente, cookie vencido ou adulterado, ou
 *    `state` já consumido viram "esta tentativa expirou" (US-001.EC-4, EC-5).
 * 3. **Mesma janela de tentativas da senha** (US-001.EC-7): a conta que estourou
 *    o limite de `login_failed` também não entra pelo provedor, e as recusas
 *    sociais contam na mesma janela.
 * 4. **Sessão pelo mesmo caminho do link mágico** (`openSession`): mesma
 *    duração, token novo a cada entrada.
 * 5. **Nada criado sem e-mail verificado**; e-mail verificado sem conta vira
 *    pendência de cadastro, nunca conta (US-004, US-006.EC-3).
 */
import { DEFAULT_LOCALE, isLocale, type LocaleId } from "../../../core/i18n/index.ts";
import { decideManualLink, resolveIdentity } from "../domain/identity-resolution.ts";
import { landingForSession, safeNext } from "../domain/landing.ts";
import { isOidcProvider, type OidcProviderId } from "../domain/oidc-config.ts";
import { can } from "../domain/policy.ts";
import type { Session } from "../domain/types.ts";
import type { Mailer } from "../ports-mailer.ts";
import type {
  AuthRepository,
  Identity,
  OidcFailure,
  OidcFlowState,
  OidcProvider,
  SessionStore,
  VerifiedIdentity,
} from "../ports.ts";
import { providerNoticeEmail } from "./account-emails.ts";
import { openSession } from "./session.ts";

/** Os códigos de erro que `/login` (e `/account`, no vínculo) sabem mostrar. */
export type SocialError =
  | "cancelled"
  | "provider"
  | "expired"
  | "conflict"
  | "unverified"
  | "refused"
  | "rate_limited"
  | "unavailable"
  | "taken"
  | "already_linked";

/** Validade do `state` consumido: a mesma do cookie do fluxo. */
const FLOW_MINUTES = 10;

export type SocialConfig = {
  /** Provedores que este ambiente oferece (`availableProviders`). */
  available: readonly OidcProviderId[];
  /** Origem pública confiável (G17); `null` recusa o fluxo. */
  origin: string | null;
  /** Adapter configurado do provedor, ou `null`. */
  provider(id: OidcProviderId): OidcProvider | null;
  /** Cifra o estado do fluxo para o cookie; `null` sem segredo configurado. */
  sealFlow: ((flow: OidcFlowState) => string) | null;
  /** Abre o cookie e confere o `state` do retorno; `null` se não vale. */
  readFlow(sealed: string | null, callbackState: string | null): OidcFlowState | null;
  /** Chave do HMAC do IP no cadastro (ADR-009); `null` recusa o cadastro. */
  signupIpSecret: string | null;
};

export type SocialDeps = {
  sessions: SessionStore;
  repository: AuthRepository;
  identities: {
    findLinkedUser(provider: OidcProviderId, subject: string): Promise<{ id: number; email: string; disabled: boolean } | null>;
    findUserByEmail(
      email: string,
      provider: OidcProviderId,
    ): Promise<{ id: number; email: string; disabled: boolean; hasProvider: boolean } | null>;
    userHasProvider(userId: number, provider: OidcProviderId): Promise<boolean>;
    linkIdentity(input: {
      userId: number;
      provider: OidcProviderId;
      subject: string;
      emailAtLink: string | null;
      origin: "automatic" | "manual";
      at: string;
    }): Promise<boolean>;
    touchIdentity(provider: OidcProviderId, subject: string, at: string): Promise<void>;
    identityOfUser(userId: number): Promise<Identity | null>;
    accountContact(userId: number): Promise<{ email: string; locale: string | null } | null>;
    consumeFlowState(state: string, at: string, expiresAt: string): Promise<boolean>;
  };
  signups: {
    createSocialSignup(input: {
      email: string;
      provider: OidcProviderId;
      subject: string;
      locale: string;
      ipHmac: string;
      now: Date;
    }): Promise<{ token: string; expiresAt: string }>;
    ipHmac(ip: string, secret: string): string;
  };
  /** A janela de tentativas do login por senha (`password-login.ts`). */
  attempts: { recentFailures(email: string): Promise<number>; max: number };
  mailer(): Mailer;
  now(): Date;
};

/* --------------------------------- Início --------------------------------- */

export type SocialStartOutcome =
  | { kind: "not_found" }
  | { kind: "redirect"; location: string }
  | { kind: "provider"; location: string; sealedFlow: string };

function loginError(error: SocialError, provider: OidcProviderId): string {
  return `/login?error=${error}&provider=${provider}`;
}

function accountError(error: SocialError, provider: OidcProviderId): string {
  return `/account?error=${error}&provider=${provider}`;
}

function redirectUri(origin: string, provider: OidcProviderId): string {
  return `${origin}/login/oauth/${provider}/callback`;
}

/**
 * `GET /login/oauth/[provider]`: decide se o fluxo começa e para onde ir.
 *
 * `intent=link` (ligar pela página da conta) exige sessão própria que possa
 * escrever na conta — sessão emprestada nega (`account:write`, G24).
 */
export async function beginSocial(
  input: { provider: string; intent: string | null; next: string | null; session: Session | null },
  config: SocialConfig,
  deps: Pick<SocialDeps, "repository">,
): Promise<SocialStartOutcome> {
  if (!isOidcProvider(input.provider)) return { kind: "not_found" };
  const id = input.provider;
  const intent: OidcFlowState["intent"] = input.intent === "link" ? "link" : "signin";
  const refuse = (error: SocialError) =>
    ({ kind: "redirect", location: intent === "link" ? accountError(error, id) : loginError(error, id) }) as const;

  const provider = config.available.includes(id) ? config.provider(id) : null;
  if (provider === null || config.origin === null || config.sealFlow === null) return refuse("unavailable");

  if (intent === "link" && (input.session === null || !can(input.session, "account:write").allowed)) {
    return { kind: "redirect", location: "/login?next=%2Faccount" };
  }

  const next = intent === "link" ? "/account" : safeNext(input.next);
  try {
    const { url, flow } = await provider.start({ redirectUri: redirectUri(config.origin, id), intent, next });
    return { kind: "provider", location: url, sealedFlow: config.sealFlow(flow) };
  } catch {
    // O provedor não respondeu à descoberta. Nenhum cookie é gravado.
    await deps.repository.record({ kind: "oidc_failed", detail: `${id}: provider_error (início)` });
    return refuse("provider");
  }
}

/* --------------------------------- Retorno -------------------------------- */

export type SocialCallbackOutcome =
  | { kind: "not_found" }
  | { kind: "redirect"; location: string }
  | { kind: "session"; location: string; token: string; expiresAt: string }
  | { kind: "signup"; location: string; token: string; expiresAt: string };

const FAILURE_ERROR: Readonly<Record<OidcFailure, SocialError>> = {
  cancelled: "cancelled",
  provider_error: "provider",
  // Token que não passa na validação é tentativa adulterada ou repetida: para
  // quem está na tela, "expirou, comece de novo" (US-001.EC-4).
  invalid_response: "expired",
};

/** Recusas que caem na janela de tentativas do login por senha (US-001.EC-7). */
const COUNTS_AS_LOGIN_FAILURE: ReadonlySet<SocialError> = new Set(["refused", "conflict"]);

type CallbackContext = {
  id: OidcProviderId;
  flow: OidcFlowState;
  config: SocialConfig;
  deps: SocialDeps;
  clientIp: string;
  locale: LocaleId;
};

async function fail(
  deps: SocialDeps,
  id: OidcProviderId,
  error: SocialError,
  target: "login" | "account",
  email: string | null = null,
): Promise<SocialCallbackOutcome> {
  await deps.repository.record({ kind: "oidc_failed", email, detail: `${id}: ${error}` });
  if (email !== null && COUNTS_AS_LOGIN_FAILURE.has(error)) {
    await deps.repository.record({ kind: "login_failed", email, detail: `login social ${id}: ${error}` });
  }
  return { kind: "redirect", location: target === "account" ? accountError(error, id) : loginError(error, id) };
}

/**
 * `GET /login/oauth/[provider]/callback`: conclui o fluxo.
 *
 * O cookie do fluxo é apagado por quem chama em qualquer desfecho — ele vale
 * uma vez, e este retorno é essa vez.
 */
export async function finishSocial(
  input: { provider: string; callbackUrl: URL; sealedFlow: string | null; session: Session | null; clientIp: string; locale: LocaleId },
  config: SocialConfig,
  deps: SocialDeps,
): Promise<SocialCallbackOutcome> {
  if (!isOidcProvider(input.provider)) return { kind: "not_found" };
  const id = input.provider;

  const provider = config.available.includes(id) ? config.provider(id) : null;
  if (provider === null || config.origin === null) return fail(deps, id, "unavailable", "login");

  const flow = config.readFlow(input.sealedFlow, input.callbackUrl.searchParams.get("state"));
  if (flow === null || flow.provider !== id) return fail(deps, id, "expired", "login");
  const target = flow.intent === "link" ? "account" : "login";

  // Queima o `state` antes de falar com o provedor: um segundo retorno com o
  // mesmo cookie (outra aba, cópia) para aqui, mesmo concorrente.
  const now = deps.now();
  const expiresAt = new Date(Date.parse(flow.createdAt) + FLOW_MINUTES * 60_000).toISOString();
  if (!(await deps.identities.consumeFlowState(flow.state, now.toISOString(), expiresAt))) {
    return fail(deps, id, "expired", target);
  }

  const completion = await provider.complete({
    redirectUri: redirectUri(config.origin, id),
    callbackUrl: input.callbackUrl,
    flow,
  });
  if (!completion.ok) return fail(deps, id, FAILURE_ERROR[completion.reason], target);

  const context: CallbackContext = { id, flow, config, deps, clientIp: input.clientIp, locale: input.locale };
  return flow.intent === "link"
    ? linkToSession(completion.identity, input.session, context)
    : signIn(completion.identity, context);
}

/** A conta ou o e-mail estourou a janela de tentativas? */
async function throttled(deps: SocialDeps, emails: Array<string | null>): Promise<string | null> {
  for (const email of new Set(emails.filter((value): value is string => value !== null))) {
    if ((await deps.attempts.recentFailures(email)) >= deps.attempts.max) return email;
  }
  return null;
}

async function signIn(identity: VerifiedIdentity, context: CallbackContext): Promise<SocialCallbackOutcome> {
  const { id, deps } = context;
  const linked = await deps.identities.findLinkedUser(id, identity.subject);

  const blocked = await throttled(deps, [linked?.email ?? null, identity.email]);
  if (blocked !== null) {
    // O mesmo registro do login por senha bloqueado: a janela é uma só.
    await deps.repository.record({ kind: "login_failed", email: blocked, detail: "bloqueado por tentativas" });
    return fail(deps, id, "rate_limited", "login", blocked);
  }

  // A conta do e-mail só importa sem vínculo e com e-mail verificado; fora
  // disso a decisão nem a lê, e a resposta não depende de ela existir.
  const emailUser =
    linked === null && identity.emailVerified && identity.email !== null
      ? await deps.identities.findUserByEmail(identity.email, id)
      : null;

  const decision = resolveIdentity({
    identity,
    linkedUser: linked === null ? null : { id: linked.id, disabled: linked.disabled },
    emailUser,
  });

  switch (decision.kind) {
    case "signin":
      return enter(decision.userId, identity, context, "signin");
    case "auto_link":
      return autoLink(decision.userId, identity, context);
    case "conflict": {
      // Corrida (US-002.EC-5): entre ler o vínculo e ler a conta do e-mail,
      // outra aba pode ter ligado ESTA identidade. Aí não é conflito — entra
      // por ela, como a decisão teria dito um instante depois.
      const raced = await deps.identities.findLinkedUser(id, identity.subject);
      if (raced !== null) {
        return raced.disabled
          ? fail(deps, id, "refused", "login", raced.email)
          : enter(raced.id, identity, context, "signin");
      }
      return fail(deps, id, "conflict", "login", identity.email);
    }
    case "refused":
      return fail(deps, id, "refused", "login", linked?.email ?? identity.email);
    case "unverified":
      return fail(deps, id, "unverified", "login", identity.email);
    case "signup":
      return startSignup(decision.email, identity, context);
  }
}

async function autoLink(userId: number, identity: VerifiedIdentity, context: CallbackContext): Promise<SocialCallbackOutcome> {
  const { id, deps } = context;
  const at = deps.now().toISOString();
  const linked = await deps.identities.linkIdentity({
    userId,
    provider: id,
    subject: identity.subject,
    emailAtLink: identity.email,
    origin: "automatic",
    at,
  });
  if (!linked) {
    // Outra requisição ligou primeiro (US-002.EC-5). Se ligou ESTA identidade
    // a ESTA conta, entra por ela; qualquer outro desfecho é tentativa vencida.
    const winner = await deps.identities.findLinkedUser(id, identity.subject);
    if (winner !== null && winner.id === userId && !winner.disabled) return enter(userId, identity, context, "signin");
    return fail(deps, id, "expired", "login");
  }
  await deps.repository.record({ kind: "identity_linked", userId, detail: `${id}: automatic` });
  await notifyLinked(userId, id, "automatic", deps);
  return enter(userId, identity, context, "automatic");
}

async function enter(
  userId: number,
  identity: VerifiedIdentity,
  context: CallbackContext,
  how: "signin" | "automatic",
): Promise<SocialCallbackOutcome> {
  const { id, deps, flow } = context;
  const account = await deps.identities.identityOfUser(userId);
  // Desabilitada entre a decisão e aqui: a mesma recusa neutra.
  if (account === null) return fail(deps, id, "refused", "login", identity.email);

  await deps.identities.touchIdentity(id, identity.subject, deps.now().toISOString());
  const { token, session } = await openSession(account, deps, {
    kind: "oidc_signin",
    detail: how === "automatic" ? `${id} (vínculo automático)` : id,
  });
  return { kind: "session", location: landingForSession(session, flow.next), token, expiresAt: session.expiresAt };
}

async function startSignup(email: string, identity: VerifiedIdentity, context: CallbackContext): Promise<SocialCallbackOutcome> {
  const { id, deps, config } = context;
  // Sem a chave do HMAC o IP não pode ser contado sem ser gravado cru: o
  // cadastro fica fechado (ADR-009), e a pessoa vê "não disponível aqui".
  if (config.signupIpSecret === null) return fail(deps, id, "unavailable", "login");
  const pending = await deps.signups.createSocialSignup({
    email,
    provider: id,
    subject: identity.subject,
    locale: context.locale,
    ipHmac: deps.signups.ipHmac(context.clientIp, config.signupIpSecret),
    now: deps.now(),
  });
  await deps.repository.record({ kind: "signup_started", email, detail: `social ${id}` });
  return { kind: "signup", location: "/signup", token: pending.token, expiresAt: pending.expiresAt };
}

/** Ligar pela página da conta (US-007): a sessão prova a posse, não o e-mail. */
async function linkToSession(
  identity: VerifiedIdentity,
  session: Session | null,
  context: CallbackContext,
): Promise<SocialCallbackOutcome> {
  const { id, deps } = context;
  // Sessão que não pode escrever na própria conta (emprestada, G24) conta como
  // nenhuma: quem liga um provedor precisa ser a dona da conta.
  const own = session !== null && session.impersonatedBy === null && can(session, "account:write").allowed;
  const sessionUser = session === null ? null : { id: session.userId, impersonated: !own };
  const linked = await deps.identities.findLinkedUser(id, identity.subject);
  const hasProvider = own && session !== null ? await deps.identities.userHasProvider(session.userId, id) : false;
  const decision = decideManualLink({ sessionUser, linkedUserId: linked?.id ?? null, sessionHasProvider: hasProvider });

  switch (decision.kind) {
    case "session_required":
      await deps.repository.record({ kind: "oidc_failed", detail: `${id}: session_required (vínculo)` });
      return { kind: "redirect", location: "/login?next=%2Faccount" };
    case "taken":
      return fail(deps, id, "taken", "account");
    case "already_linked":
      return fail(deps, id, "already_linked", "account");
    case "link": {
      const created = await deps.identities.linkIdentity({
        userId: decision.userId,
        provider: id,
        subject: identity.subject,
        emailAtLink: identity.email,
        origin: "manual",
        at: deps.now().toISOString(),
      });
      if (!created) return fail(deps, id, "already_linked", "account");
      await deps.repository.record({ kind: "identity_linked", userId: decision.userId, detail: `${id}: manual` });
      await notifyLinked(decision.userId, id, "self", deps);
      return { kind: "redirect", location: `/account?linked=${id}` };
    }
  }
}

/**
 * Aviso de provedor ligado à conta (US-019). Falha de envio não desfaz o
 * vínculo nem barra a entrada: fica registrada para o admin (ADR-011).
 */
async function notifyLinked(
  userId: number,
  provider: OidcProviderId,
  by: "automatic" | "self",
  deps: SocialDeps,
): Promise<void> {
  const contact = await deps.identities.accountContact(userId);
  if (contact === null) return;
  const locale = isLocale(contact.locale ?? undefined) ? (contact.locale as LocaleId) : DEFAULT_LOCALE;
  const mail = providerNoticeEmail({ locale, provider, action: "linked", by, at: deps.now().toISOString() });
  const result = await deps.mailer().send({ to: contact.email, subject: mail.subject, text: mail.text });
  if (!result.ok) {
    await deps.repository.record({ kind: "email_send_failed", userId, detail: "provider_linked" });
  }
}
