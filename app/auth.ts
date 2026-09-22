import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import {
  authorize,
  AuthorizationError,
  can,
  candidateScope,
  isOpenMode,
  resolveSession,
  type Action,
  type Resource,
  type Session,
} from "../src/contexts/auth/index.ts";
import { getCandidate } from "../src/core/candidate.ts";

/**
 * The guard every Server Action goes through.
 *
 * One function, because an authorisation check that exists in four places will
 * disagree with itself in one. Actions call `guard(...)` and get a session, or
 * an exception — there is no variant that returns "probably fine".
 */

export const SESSION_COOKIE = "jho_session";
export { candidateScope };

/**
 * Onde a sessão do admin fica estacionada durante um empréstimo.
 *
 * Assumir identidade **substitui** o cookie de sessão pelo token emprestado e
 * guarda o do admin aqui; a volta é restaurar. A alternativa — manter os dois e
 * escolher qual vale — obrigaria todo leitor de sessão a saber da impersonação,
 * e um leitor que esquecesse leria a sessão errada.
 *
 * Mora aqui, e não em `app/admin/actions.ts`, porque um arquivo `"use server"`
 * só pode exportar função async.
 */
export const ADMIN_COOKIE = "jho_admin_session";

async function sessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function currentSession(): Promise<Session | null> {
  // Resolving a session is a read path. Updating the candidate here made every
  // page view contend for a database write and hid profile synchronisation
  // inside authentication. Seeding/syncing remains an explicit command.
  //
  // O candidato padrão só serve ao modo aberto (`resolveSession` ignora o id
  // com token de verdade), e buscá-lo custava uma ida ao banco em toda
  // requisição de produção — em série, antes da resolução da sessão.
  const defaultCandidate = isOpenMode() ? await getCandidate().catch(() => null) : null;
  return resolveSession(await sessionToken(), defaultCandidate?.id ?? null);
}

/**
 * A sessão para RENDERIZAR: resolvida uma vez por requisição.
 *
 * O layout, o `SessionBadge` e a página pediam a mesma sessão, cada um com a
 * sua ida ao banco, e disputavam as três conexões do pool. `cache()` do React
 * é por requisição, então a segunda pergunta reaproveita a primeira.
 *
 * Só leitura de tela. Ação e guarda usam `currentSession`, sem cache: a
 * impersonação e a troca de senha mudam a sessão NO MEIO da requisição, e uma
 * autorização que lesse o valor de antes da mudança seria a decisão errada.
 */
export const renderSession = cache(currentSession);

/**
 * Authorises an action, returning the session it was authorised for.
 *
 * The returned session is the *only* legitimate source of `candidateId` for
 * whatever happens next. An action that instead reads a candidate id from its
 * own FormData is forgeable, and that is the classic multi-tenant leak: the UI
 * filters correctly and a hand-made POST walks straight through.
 */
export async function guard(action: Action, resource?: Resource): Promise<Session> {
  const session = await currentSession();
  authorize(session, action, resource ?? { kind: "global" });
  return session as Session;
}

/**
 * Authorises an action against the caller's own candidate record.
 *
 * Takes no id at all — by construction, not by discipline.
 */
export async function guardOwnCandidate(action: Action): Promise<{ session: Session; candidateId: number }> {
  const session = await currentSession();
  const candidateId = candidateScope(session);
  if (candidateId === null) {
    forbidden();
  }
  authorize(session, action, { kind: "candidate", candidateId });
  return { session: session as Session, candidateId };
}

/**
 * Requires a real session for a page, or redirects to login.
 *
 * The authoritative half of the pair described in `proxy.ts`: Proxy
 * only sees whether a cookie exists, this resolves it against the database, so
 * a forged or revoked token dies here.
 *
 * Every page that reads candidate or funnel data calls this. A page that
 * forgets it is caught by the architecture test.
 */
export async function requireSession(): Promise<Session> {
  const session = await renderSession();
  if (!session) redirect("/login");
  return session;
}

/** Requires a session AND authorisation for one action. */
export async function requirePage(action: Action, resource?: Resource): Promise<Session> {
  const session = await requireSession();
  try {
    authorize(session, action, resource ?? { kind: "global" });
  } catch (error) {
    // 403, não 500. `authorize` lança, e uma exceção que sobe até o framework
    // vira erro interno: a página nega corretamente e ainda assim parece um
    // crash — em desenvolvimento com stack na tela. Apareceu ao abrir
    // /admin/users com sessão emprestada, que a política nega de propósito.
    if (error instanceof AuthorizationError) forbidden();
    throw error;
  }
  return session;
}

/** Requires a page to operate on exactly the candidate scoped by its session. */
export async function requireOwnCandidatePage(
  action: Action,
): Promise<{ session: Session; candidateId: number }> {
  const session = await requireSession();
  const candidateId = candidateScope(session);
  if (candidateId === null) forbidden();
  authorize(session, action, { kind: "candidate", candidateId });
  return { session, candidateId };
}

/**
 * A sessão que pode criar o próprio candidato, ou `null`.
 *
 * Conta de papel candidato sem candidato recebia 403 em `/candidate` e ficava
 * sem caminho nenhum. `/candidate` pergunta isto ANTES de
 * `requireOwnCandidatePage`: quem pode criar vê o formulário; quem não pode
 * (admin, recrutador, sessão emprestada) segue para a guarda de sempre e
 * recebe o mesmo 403 de antes. A decisão é de `can()`, não desta função.
 */
export async function onboardingSession(): Promise<Session | null> {
  const session = await requireSession();
  return mayCreateProfile(session) ? session : null;
}

/** A mesma pergunta, para quem já tem a sessão em mãos (o layout, no link). */
export function mayCreateProfile(session: Session | null): boolean {
  // O modo aberto sintetiza uma sessão sem conta por trás: não há linha a que
  // ligar o candidato, e o formulário só poderia responder "indisponível".
  if (session === null || isOpenMode() || candidateScope(session) !== null) return false;
  return can(session, "candidate:create").allowed;
}
