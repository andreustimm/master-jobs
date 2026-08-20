/**
 * The permission decision, as a pure function.
 *
 * `can(session, action, resource)` is the only place that decides. Everything
 * else — Proxy, Server Actions, CLI — asks it. That concentration is
 * deliberate: authorisation bugs come from a check that exists in four places
 * and disagrees with itself in one.
 *
 * Two rules run underneath every case:
 *
 *  1. **Deny by default.** An unknown action, an expired session or a missing
 *     role is a denial, never a fall-through. There is no `default: return
 *     ALLOW` anywhere in this file, and there must never be.
 *
 *  2. **Ownership is checked against the session, never against an argument.**
 *     A caller passing `candidateId` is stating what it wants, not proving it
 *     may. This is the single most common way multi-tenant systems leak: the
 *     UI filters correctly, and a hand-made request with someone else's id
 *     walks straight through.
 */
import {
  ALLOW,
  deny,
  type Action,
  type Decision,
  type Resource,
  type Role,
  type Session,
} from "./types.ts";

export function isExpired(session: Session, now: number): boolean {
  const expiry = Date.parse(session.expiresAt);
  // An unparseable expiry is treated as expired: a session whose lifetime
  // cannot be established is not a session to trust.
  return Number.isNaN(expiry) || expiry <= now;
}

export function hasRole(session: Session, role: Role): boolean {
  return session.roles.includes(role);
}

export function can(
  session: Session | null,
  action: Action,
  resource: Resource = { kind: "global" },
  now: number = Date.now(),
): Decision {
  if (!session) return deny("sem sessão");
  if (isExpired(session, now)) return deny("sessão expirada");

  const isAdmin = hasRole(session, "admin");
  const isOwner = hasRole(session, "owner");

  // Ownership of the resource, derived from the session and nothing else.
  const ownsCandidate =
    resource.kind === "candidate" &&
    session.candidateId !== null &&
    session.candidateId === resource.candidateId;

  switch (action) {
    case "admin:access":
    case "skill:audit":
    case "provider:manage":
      return isAdmin ? ALLOW : deny("requer papel admin");

    case "job:read":
    case "job:write":
      // The corpus is not per-candidate. Owners may add a posting they are
      // considering; admins may curate the same global catalogue.
      return isOwner || isAdmin ? ALLOW : deny("requer sessão válida");

    case "candidate:read":
    case "candidate:write":
    case "application:write":
      if (!isOwner) return deny("requer papel owner");
      // A global resource is never shorthand for private candidate data. Every
      // caller must prove the candidate scope it derived from the session.
      if (resource.kind !== "candidate") return deny("requer escopo de candidato");
      // An admin curates the global catalogue; even an accidentally associated
      // candidate id does not turn that role into a CV/funnel superuser.
      if (!ownsCandidate) return deny("recurso de outro candidato");
      return ALLOW;

    default:
      // Exhaustive in practice; a new action lands here until it is decided.
      return deny(`ação não reconhecida: ${String(action)}`);
  }
}

/** Throws unless allowed. For call sites where a denial is exceptional. */
export function authorize(
  session: Session | null,
  action: Action,
  resource: Resource = { kind: "global" },
  now: number = Date.now(),
): void {
  const decision = can(session, action, resource, now);
  if (!decision.allowed) {
    throw new AuthorizationError(action, decision.reason);
  }
}

export class AuthorizationError extends Error {
  readonly action: string;
  constructor(action: string, reason: string) {
    super(`negado: ${action} — ${reason}`);
    this.name = "AuthorizationError";
    this.action = action;
  }
}

/**
 * The candidate a session may act for.
 *
 * Call sites take the scope from here instead of accepting one, which is what
 * makes "filter by candidate" impossible to forget or forge.
 */
export function candidateScope(session: Session | null): number | null {
  return session?.candidateId ?? null;
}
