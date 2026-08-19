import { cookies } from "next/headers";
import {
  authorize,
  resolveSession,
  type Action,
  type Resource,
  type Session,
} from "../src/contexts/auth/index.ts";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";

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
  // In single-user mode the candidate comes from profile.yaml, which is the
  // same identity the CLI uses; the two must never disagree about who this is.
  const candidateId = await syncCandidateFromProfile().catch(() => null);
  return resolveSession(await sessionToken(), candidateId);
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
    authorize(null, action);
    throw new Error("unreachable");
  }
  authorize(session, action, { kind: "candidate", candidateId });
  return { session: session as Session, candidateId };
}
