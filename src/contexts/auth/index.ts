/**
 * The auth context, composed.
 *
 * Callers get functions and never see a port. Composition by function, no
 * container — which would be illegal under the erasable-TypeScript rule anyway.
 */
import {
  drizzleAuthRepository,
  drizzleSessions,
  magicLink,
} from "./infra/drizzle-store.ts";
import { drizzlePasswords } from "./infra/password-login.ts";
import {
  beginLogin,
  completeLogin,
  isOpenMode,
  loginWithPassword,
  logout,
  revokeAllSessionsForEmail,
  singleUserSession,
  type AuthDeps,
  type LoginResult,
} from "./app/session.ts";
import type { Session } from "./domain/types.ts";

export { can, authorize, candidateScope, AuthorizationError } from "./domain/policy.ts";
export { checkPassword, MIN_LENGTH } from "./domain/password.ts";
export type { Action, Decision, Resource, Role, Session } from "./domain/types.ts";
export { ACTIONS, ROLES } from "./domain/types.ts";
export { isOpenMode, isSingleUser, singleUserSession, SESSION_DAYS } from "./app/session.ts";
export { generatePassword, seedOwner } from "./app/seed.ts";
export { addUser, claimOwnCandidate } from "./app/accounts.ts";
export type { SeedResult } from "./app/seed.ts";
export { setPassword, verifyLogin } from "./infra/password-login.ts";
import { setPassword } from "./infra/password-login.ts";
export { canReadPublicProfile } from "./domain/policy.ts";
export { authorizeCronRequest, type CronAuthorization } from "./domain/cron-authorization.ts";
export { VISIBILITIES, isVisibility, ADMIN_ACTIONS } from "./domain/types.ts";
export type { Visibility } from "./domain/types.ts";
export type { UserSummary } from "./ports.ts";
export { IMPERSONATION_HOURS } from "./app/impersonation.ts";
export { RESET_MINUTES, RESET_MAX_PER_HOUR } from "./app/password-reset.ts";
export type { Mailer, OutgoingMail, MailResult } from "./ports-mailer.ts";
export { configuredMailer, consoleMailer, resendMailer } from "./infra/resend-mailer.ts";
export { resolvePublicOrigin, type RequestOrigin } from "./domain/public-origin.ts";
export { openModeRefused } from "./domain/open-mode.ts";

import {
  createOwnCandidate as createOwnCandidateRow,
  drizzleUserDirectory,
  otherActiveAdmins,
  type OwnCandidateResult,
} from "./infra/drizzle-directory.ts";
import { hashToken, issueResetToken } from "./infra/drizzle-store.ts";
import type { OwnCandidateInput } from "../../core/candidate.ts";
import { configuredMailer } from "./infra/resend-mailer.ts";
import {
  isResetTokenLive,
  redeemPasswordReset,
  requestPasswordReset,
  type ResetDeps,
} from "./app/password-reset.ts";
import {
  startImpersonation,
  stopImpersonation,
  type ImpersonationDeps,
} from "./app/impersonation.ts";
import type { Role } from "./domain/types.ts";
import { changeOwnPassword, type ChangePasswordResult } from "./infra/password-login.ts";
import { AuthorizationError } from "./domain/policy.ts";
import { SESSION_DAYS } from "./app/session.ts";
import { clock } from "../../core/clock.ts";
import type { LocaleId } from "../../core/i18n/index.ts";
import { beginSocial, finishSocial, type SocialConfig, type SocialDeps } from "./app/oidc-login.ts";
import {
  availableProviders,
  parseSessionSecret,
  parseSignupIpSecret,
  type OidcProviderId,
} from "./domain/oidc-config.ts";
import type { AuthEnvironment } from "./domain/open-mode.ts";
import { resolvePublicOrigin, type RequestOrigin } from "./domain/public-origin.ts";
import {
  accountContact,
  consumeFlowState,
  findLinkedUser,
  findUserByEmail,
  identityOfUser,
  linkIdentity,
  touchIdentity,
  userHasProvider,
} from "./infra/drizzle-identities.ts";
import {
  accountMethods,
  providersByUser,
  setFirstPassword as storeFirstPassword,
  unlinkIdentityChecked,
  userIdByEmail,
} from "./infra/drizzle-identities.ts";
import {
  disconnectProvider,
  listMethods,
  setFirstPassword,
  type AccountAccess,
  type DisconnectResult,
  type FirstPasswordResult,
  type MethodsDeps,
} from "./app/account-methods.ts";
import { hashPassword } from "./domain/password.ts";
import { authorize } from "./domain/policy.ts";
import { createSocialSignup, signupIpHmac } from "./infra/drizzle-signups.ts";
import { checkCallbackState, flowKey, openFlow, sealFlow } from "./infra/flow-cookie.ts";
import { configuredOidcProvider } from "./infra/oidc/providers.ts";
import { MAX_ATTEMPTS, recentFailures } from "./infra/password-login.ts";
export { MAX_CHANGE_ATTEMPTS } from "./infra/password-login.ts";

const deps: AuthDeps = {
  sessions: drizzleSessions,
  identity: magicLink,
  passwords: drizzlePasswords,
  repository: drizzleAuthRepository,
};

export function startLogin(email: string): Promise<{ token: string; expiresAt: string }> {
  return beginLogin(email, deps);
}

export function finishLogin(token: string): Promise<LoginResult> {
  return completeLogin(token, deps);
}

export function endSession(token: string): Promise<void> {
  return logout(token, deps);
}

export function passwordSignIn(email: string, password: string) {
  return loginWithPassword(email, password, deps);
}

export function revokeUserSessions(email: string): Promise<number | null> {
  return revokeAllSessionsForEmail(email, deps);
}

/* ----------------------------- Gestão de contas --------------------------- */

const directoryDeps: ImpersonationDeps = {
  sessions: drizzleSessions,
  users: drizzleUserDirectory,
  audit: drizzleAuthRepository,
};

export function listUsers() {
  return drizzleUserDirectory.list();
}

export function findUser(userId: number) {
  return drizzleUserDirectory.find(userId);
}

export function createUser(input: {
  email: string;
  fullName?: string | null;
  roles: Role[];
  candidateId?: number | null;
}) {
  return drizzleUserDirectory.create(input);
}

export function setUserRoles(userId: number, roles: Role[]) {
  return drizzleUserDirectory.updateRoles(userId, roles);
}

/**
 * Edita os dados da conta. Campo ausente fica como está.
 *
 * Não recebe `candidateId` de propósito, pela mesma razão que `createUser` não
 * o aceita do formulário: apontar uma conta para o candidato de outra pessoa
 * daria acesso ao currículo e ao funil dela sem passar pela impersonação
 * auditada, que é o único caminho previsto.
 */
export function updateUser(
  userId: number,
  patch: { email?: string; fullName?: string | null; roles?: Role[] },
) {
  return drizzleUserDirectory.update(userId, patch);
}

/**
 * Apaga a conta, de vez.
 *
 * Quem chama precisa ter checado antes que não é o último admin e que não é a
 * própria conta — as duas regras moram na ação, junto do `guard`, porque são
 * decisões sobre a sessão de quem pediu, e esta função não conhece sessão.
 */
export function deleteUser(userId: number) {
  return drizzleUserDirectory.remove(userId);
}

export function setUserDisabled(userId: number, disabled: boolean) {
  return drizzleUserDirectory.setDisabled(userId, disabled);
}

/** Concessões ativas de um recrutador, com id. Para a tela listar e revogar. */
export function recruiterLinks(recruiterUserId: number) {
  return drizzleUserDirectory.linksOf(recruiterUserId);
}

/**
 * Grava uma concessão ativa do recrutador ao candidato, com evento `system`.
 *
 * **Só fixture** (`tests/e2e/setup.mjs` e testes): concessão nasce do
 * consentimento do candidato (#465). Nenhuma tela nem verbo da CLI chama isto
 * — admin criando uma leria dado alheio por procuração.
 */
export function linkRecruiterToCandidate(recruiterUserId: number, candidateId: number, by: number) {
  return drizzleUserDirectory.linkCandidate(recruiterUserId, candidateId, by);
}

/**
 * O administrador `by` revoga uma concessão (ADR-008): fica `revoked`, com o
 * nome dele no histórico do candidato. Revogar só reduz exposição; conceder,
 * o admin nunca concede.
 */
export function revokeRecruiterGrant(grantId: number, by: number) {
  return drizzleUserDirectory.revokeGrant(grantId, by);
}

/**
 * Cria o candidato da conta desta sessão.
 *
 * Recebe a SESSÃO, não um id: a conta é a de quem pediu, e nenhum chamador
 * consegue apontar a criação para outra. A autorização (`candidate:create`)
 * fica com quem chama, no `guard`, antes de qualquer efeito.
 */
export function createOwnCandidate(
  session: Session,
  profile: OwnCandidateInput,
): Promise<OwnCandidateResult> {
  return createOwnCandidateRow(session.userId, profile);
}
export type { OwnCandidateResult };

/**
 * Admins ativos além deste. Zero significa que ele é o último — e a instalação
 * não pode ficar sem ninguém capaz de criar contas.
 */
export function adminsBesides(userId: number) {
  return otherActiveAdmins(userId);
}

/* ------------------------------- Minha conta ------------------------------- */

export type OwnPasswordResult =
  | { ok: true; token: string; expiresAt: string }
  | Extract<ChangePasswordResult, { ok: false }>;

/**
 * Sessão emprestada nunca chega à escrita da conta.
 *
 * A política já nega `account:write` a ela, e a ação chama `guard` antes. Esta
 * segunda barreira existe porque a função recebe a sessão como argumento e
 * pode ser chamada de outro lugar amanhã: quem esquecer o `guard` ainda não
 * troca a senha do alvo.
 */
function assertOwnSession(session: Session): void {
  if (session.impersonatedBy !== null) {
    throw new AuthorizationError("account:write", "sessão emprestada não altera a conta do alvo");
  }
}

/**
 * Troca a senha da conta DA SESSÃO, provando a atual.
 *
 * Todas as sessões da conta caem, inclusive a que pediu; em seguida nasce uma
 * sessão nova, cujo token quem chama grava no cookie. O efeito para a pessoa é
 * "as outras sessões caíram e eu continuo dentro", e o token antigo deste
 * navegador também deixa de valer — um cookie copiado antes da troca não
 * sobrevive a ela.
 */
export async function changePasswordForSession(
  session: Session,
  currentPassword: string,
  newPassword: string,
): Promise<OwnPasswordResult> {
  assertOwnSession(session);
  const result = await changeOwnPassword(session.userId, currentPassword, newPassword);
  if (!result.ok) return result;
  const expiresAt = new Date(clock().now() + SESSION_DAYS * 86_400_000).toISOString();
  const token = await drizzleSessions.create({ userId: session.userId, expiresAt });
  await drizzleAuthRepository.record({
    kind: "login",
    userId: session.userId,
    email: result.email,
    detail: "sessão renovada após troca de senha",
  });
  return { ok: true, token, expiresAt };
}

/**
 * Troca o nome de exibição da conta DA SESSÃO.
 *
 * Só o nome. O e-mail é o identificador de entrada e o destino da recuperação
 * de senha; trocá-lo sem confirmar a posse do endereço novo deixaria uma
 * sessão roubada redirecionar a recuperação para o atacante. Enquanto não
 * houver confirmação por e-mail em produção, e-mail muda só por admin
 * (`docs/security.md`).
 */
export async function renameForSession(session: Session, fullName: string): Promise<void> {
  assertOwnSession(session);
  await drizzleUserDirectory.update(session.userId, { fullName });
  await drizzleAuthRepository.record({
    kind: "profile_updated",
    userId: session.userId,
    email: session.email,
    detail: "nome de exibição alterado pela própria conta",
  });
}

/* ----------------------------- Impersonação ------------------------------- */

/* --------------------------- Recuperar a senha ---------------------------- */

function resetDeps(baseUrl: string): ResetDeps {
  return {
    mailer: configuredMailer(),
    audit: drizzleAuthRepository,
    sessions: drizzleSessions,
    linkFor: (token) => `${baseUrl}/login/reset?token=${encodeURIComponent(token)}`,
    setPassword,
    issue: issueResetToken,
  };
}

/**
 * Pede a recuperação. **Sempre devolve `{ sent: true }`.**
 *
 * O retorno confirma que o pedido foi aceito, não que a conta existe. Quem
 * chama não consegue distinguir os dois casos, e é assim de propósito: um
 * formulário que responde "não encontramos esta conta" é um oráculo de
 * enumeração aberto ao mundo.
 */
export function askPasswordReset(email: string, baseUrl: string, locale?: LocaleId) {
  return requestPasswordReset(email, resetDeps(baseUrl), locale);
}

/**
 * Registra que o pedido de recuperação não pôde ser enviado por falta de
 * origem confiável (`resolvePublicOrigin` devolveu `null` — deployment sem
 * `JHO_PUBLIC_URL`). Nunca consulta se a conta existe: grava para todo
 * pedido, endereço cadastrado ou não, exatamente como `requestPasswordReset`
 * faz para as outras causas de falha — a mesma disciplina de G17.
 */
export async function recordResetSendFailure(email: string, detail: string): Promise<void> {
  await drizzleAuthRepository.record({
    kind: "reset_send_failed",
    email: email.trim().toLowerCase(),
    detail,
  });
}

/** O link ainda serve? Consulta sem consumir, para a tela avisar antes. */
export function resetTokenIsLive(token: string) {
  return isResetTokenLive(token, hashToken);
}

export function completePasswordReset(token: string, newPassword: string, baseUrl: string) {
  return redeemPasswordReset(token, newPassword, hashToken, resetDeps(baseUrl));
}

export function beginImpersonation(actor: Session | null, targetUserId: number) {
  return startImpersonation(actor, targetUserId, directoryDeps);
}

export function endImpersonation(borrowed: Session | null, token: string) {
  return stopImpersonation(borrowed, token, directoryDeps);
}

/* ------------------------------ Login social ------------------------------ */

export { FLOW_COOKIE, FLOW_TTL_MS } from "./infra/flow-cookie.ts";
export { SIGNUP_COOKIE, SOCIAL_SIGNUP_MINUTES } from "./infra/drizzle-signups.ts";
export { isOidcProvider, type OidcProviderId } from "./domain/oidc-config.ts";
export { landingFor, landingForSession, safeNext } from "./domain/landing.ts";
export type { SocialError } from "./app/oidc-login.ts";

/**
 * O que o login social precisa do ambiente, lido a cada requisição — o mesmo
 * motivo de `configuredMailer`: o teste troca a variável entre casos.
 */
function socialConfig(env: AuthEnvironment, request: RequestOrigin): SocialConfig {
  const secret = parseSessionSecret(env);
  const key = secret.status === "configured" ? flowKey(secret.secret) : null;
  const now = () => new Date(clock().now());
  return {
    available: availableProviders(env),
    origin: resolvePublicOrigin(env, request),
    provider: (id) => configuredOidcProvider(id, env, { now }),
    sealFlow: key === null ? null : (flow) => sealFlow(flow, key),
    readFlow: (sealed, callbackState) => {
      if (key === null) return null;
      const check = checkCallbackState(openFlow(sealed, key, now()), callbackState);
      return check.ok ? check.flow : null;
    },
    signupIpSecret: parseSignupIpSecret(env),
  };
}

const socialDeps: SocialDeps = {
  sessions: drizzleSessions,
  repository: drizzleAuthRepository,
  identities: {
    findLinkedUser,
    findUserByEmail,
    userHasProvider,
    linkIdentity,
    touchIdentity,
    identityOfUser,
    accountContact,
    consumeFlowState,
  },
  signups: { createSocialSignup, ipHmac: signupIpHmac },
  attempts: { recentFailures, max: MAX_ATTEMPTS },
  mailer: () => configuredMailer(),
  now: () => new Date(clock().now()),
};

/**
 * Os provedores que a tela de login mostra, nesta ordem (ADR-005). Vazio fora
 * de produção e local, sem segredo do fluxo ou sem credencial.
 */
export function socialProviders(env: AuthEnvironment = process.env): OidcProviderId[] {
  return availableProviders(env);
}

/** `GET /login/oauth/[provider]`. Ver `app/oidc-login.ts`. */
export function startSocialSignIn(
  input: { provider: string; intent: string | null; next: string | null; session: Session | null; request: RequestOrigin },
  env: AuthEnvironment = process.env,
) {
  return beginSocial(input, socialConfig(env, input.request), socialDeps);
}

/** `GET /login/oauth/[provider]/callback`. Ver `app/oidc-login.ts`. */
export function finishSocialSignIn(
  input: {
    provider: string;
    callbackUrl: URL;
    sealedFlow: string | null;
    session: Session | null;
    clientIp: string;
    locale: LocaleId;
    request: RequestOrigin;
  },
  env: AuthEnvironment = process.env,
) {
  return finishSocial(input, socialConfig(env, input.request), socialDeps);
}

/* ---------------------------- Formas de entrar ---------------------------- */

export type { AccountAccess, DisconnectResult, FirstPasswordResult } from "./app/account-methods.ts";
export type { MethodsView, ProviderMethod } from "./domain/methods.ts";
export { OIDC_PROVIDERS } from "./domain/oidc-config.ts";

function methodsDeps(env: AuthEnvironment = process.env): MethodsDeps {
  return {
    store: { accountMethods, unlinkIdentityChecked, setFirstPassword: storeFirstPassword },
    repository: drizzleAuthRepository,
    mailer: () => configuredMailer(env),
    hashPassword,
    available: () => availableProviders(env),
    now: () => new Date(clock().now()),
  };
}

/** As formas de entrar e os termos aceitos da conta DA SESSÃO (US-010, US-021.AC-3). */
export function accountAccess(session: Session, env: AuthEnvironment = process.env): Promise<AccountAccess | null> {
  return listMethods(session.userId, methodsDeps(env));
}

/**
 * Desliga um provedor da conta DA SESSÃO (US-008).
 *
 * Segunda barreira além do `guard` da action, como `assertOwnSession`: a
 * função recebe a sessão e pode ser chamada de outro lugar amanhã.
 */
export function disconnectOwnProvider(
  session: Session,
  provider: OidcProviderId,
  env: AuthEnvironment = process.env,
): Promise<DisconnectResult> {
  authorize(session, "account:manage-methods");
  return disconnectProvider({ userId: session.userId, provider, actor: { by: "self" } }, methodsDeps(env));
}

/** Primeira senha da conta DA SESSÃO, que até aqui só entrava por provedor (US-009). */
export function setFirstPasswordForSession(session: Session, password: string): Promise<FirstPasswordResult> {
  authorize(session, "account:manage-methods");
  return setFirstPassword({ userId: session.userId, email: session.email, password }, methodsDeps());
}

/**
 * O admin desliga o provedor de OUTRA conta (US-011.AC-2), com a mesma
 * proteção do último método. Não existe o inverso: admin não liga provedor em
 * conta de ninguém (US-011.AC-3).
 */
export function adminDisconnectProvider(
  actor: Session | null,
  targetUserId: number,
  provider: OidcProviderId,
  env: AuthEnvironment = process.env,
): Promise<DisconnectResult> {
  authorize(actor, "user:manage");
  const admin = actor as Session;
  return disconnectProvider(
    { userId: targetUserId, provider, actor: { by: "admin", adminUserId: admin.userId, adminEmail: admin.email } },
    methodsDeps(env),
  );
}

/** As contas com os provedores ligados de cada uma, para `/admin/users` (US-011.AC-1). */
export async function listUsersWithMethods() {
  const [users, providers] = await Promise.all([drizzleUserDirectory.list(), providersByUser()]);
  return users.map((user) => ({ ...user, providers: providers.get(user.id) ?? [] }));
}

/** `jho auth methods <email>`: `null` quando não há conta (US-013). */
export async function methodsForEmail(
  email: string,
  env: AuthEnvironment = process.env,
): Promise<(AccountAccess & { email: string }) | null> {
  const userId = await userIdByEmail(email);
  if (userId === null) return null;
  const access = await listMethods(userId, methodsDeps(env));
  return access === null ? null : { ...access, email: email.trim().toLowerCase() };
}

/** `jho auth unlink <email> <provider>`: mesma proteção e auditoria da tela (US-013.AC-2). */
export async function cliUnlinkProvider(
  email: string,
  provider: OidcProviderId,
  env: AuthEnvironment = process.env,
): Promise<DisconnectResult> {
  const userId = await userIdByEmail(email);
  if (userId === null) return { ok: false, error: "no_account" };
  return disconnectProvider({ userId, provider, actor: { by: "cli" } }, methodsDeps(env));
}

/**
 * The session for the current request.
 *
 * In single-user mode this synthesises one rather than returning null, so every
 * call site can treat "who is this" identically in both modes. The guard is the
 * same code path either way — a multi-user branch that only runs in production
 * is a branch nobody has tested.
 */
export async function resolveSession(
  token: string | null,
  candidateId: number | null = null,
): Promise<Session | null> {
  if (isOpenMode()) return singleUserSession(candidateId);
  if (!token) return null;
  return drizzleSessions.resolve(token);
}
