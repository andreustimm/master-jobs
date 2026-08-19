/**
 * Authentication and authorisation — domain types.
 *
 * Nothing here touches a database, a cookie or a clock. That is the point: the
 * permission decision is the part where a bug is a breach, and it is the part
 * that can be tested exhaustively for free.
 */

export const ROLES = ["owner", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type Session = {
  userId: number;
  /** The candidate this session may act for. Null for an admin-only account. */
  candidateId: number | null;
  roles: Role[];
  email: string;
  expiresAt: string;
};

/**
 * Every action the system can gate.
 *
 * An explicit union rather than free strings: a typo in `"canditate:read"`
 * would silently deny — or worse, a permissive default would silently allow.
 */
export const ACTIONS = [
  "job:read",
  "application:write",
  "candidate:read",
  "candidate:write",
  "skill:audit",
  "provider:manage",
  "admin:access",
] as const;
export type Action = (typeof ACTIONS)[number];

/** What the action is being performed on. */
export type Resource =
  | { kind: "global" }
  | { kind: "candidate"; candidateId: number };

export type Decision = { allowed: true } | { allowed: false; reason: string };

export const ALLOW: Decision = { allowed: true };
export function deny(reason: string): Decision {
  return { allowed: false, reason };
}
