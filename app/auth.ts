import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import {
  authorize,
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

async function sessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function currentSession(): Promise<Session | null> {
  // Resolving a session is a read path. Updating the candidate here made every
  // page view contend for a database write and hid profile synchronisation
  // inside authentication. Seeding/syncing remains an explicit command.
  const defaultCandidate = await getCandidate().catch(() => null);
  return resolveSession(await sessionToken(), defaultCandidate?.id ?? null);
}

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
  const candidateId = session?.candidateId ?? null;
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
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

/** Requires a session AND authorisation for one action. */
export async function requirePage(action: Action, resource?: Resource): Promise<Session> {
  const session = await requireSession();
  authorize(session, action, resource ?? { kind: "global" });
  return session;
}

/** Requires a page to operate on exactly the candidate scoped by its session. */
export async function requireOwnCandidatePage(
  action: Action,
): Promise<{ session: Session; candidateId: number }> {
  const session = await requireSession();
  const candidateId = session.candidateId;
  if (candidateId === null) forbidden();
  authorize(session, action, { kind: "candidate", candidateId });
  return { session, candidateId };
}
