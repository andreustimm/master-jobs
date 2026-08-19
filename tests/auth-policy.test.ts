import { describe, expect, it } from "vitest";
import { AuthorizationError, authorize, can, candidateScope } from "../src/contexts/auth/domain/policy.ts";
import { ACTIONS, type Action, type Session } from "../src/contexts/auth/domain/types.ts";

/**
 * The permission matrix, exhaustively.
 *
 * This is the cheapest security testing available: the decision is a pure
 * function, so every combination of role, action and ownership can be asserted
 * without a database, a server or a browser.
 */

const NOW = Date.parse("2026-08-19T12:00:00Z");
const LATER = "2026-09-19T12:00:00Z";
const EARLIER = "2026-08-18T12:00:00Z";

const owner = (candidateId: number | null = 1): Session => ({
  userId: 1,
  candidateId,
  roles: ["owner"],
  email: "owner@test",
  expiresAt: LATER,
});

const admin = (): Session => ({
  userId: 2,
  candidateId: null,
  roles: ["admin"],
  email: "admin@test",
  expiresAt: LATER,
});

describe("deny by default", () => {
  it("refuses every action without a session", () => {
    for (const action of ACTIONS) {
      expect(can(null, action, { kind: "global" }, NOW).allowed, action).toBe(false);
    }
  });

  it("refuses every action on an expired session", () => {
    const expired = { ...owner(), expiresAt: EARLIER };
    for (const action of ACTIONS) {
      expect(can(expired, action, { kind: "global" }, NOW).allowed, action).toBe(false);
    }
  });

  it("treats an unparseable expiry as expired", () => {
    // A session whose lifetime cannot be established is not one to trust.
    const broken = { ...owner(), expiresAt: "não é data" };
    expect(can(broken, "job:read", { kind: "global" }, NOW).allowed).toBe(false);
  });

  it("refuses an action nobody granted", () => {
    const rogue = { ...owner(), roles: [] as never };
    for (const action of ACTIONS) {
      expect(can(rogue, action, { kind: "global" }, NOW).allowed, action).toBe(false);
    }
  });
});

describe("candidate isolation", () => {
  it("lets an owner reach their own record", () => {
    for (const action of ["candidate:read", "candidate:write", "application:write"] as Action[]) {
      expect(can(owner(1), action, { kind: "candidate", candidateId: 1 }, NOW).allowed, action).toBe(true);
    }
  });

  it("refuses another candidate's record, for every action", () => {
    // The classic multi-tenant leak: the UI filters correctly and a hand-made
    // request with someone else's id walks straight through.
    for (const action of ["candidate:read", "candidate:write", "application:write"] as Action[]) {
      const decision = can(owner(1), action, { kind: "candidate", candidateId: 2 }, NOW);
      expect(decision.allowed, action).toBe(false);
      expect(decision.allowed === false && decision.reason).toContain("outro candidato");
    }
  });

  it("refuses a session with no candidate from reaching any candidate", () => {
    expect(can(owner(null), "candidate:read", { kind: "candidate", candidateId: 1 }, NOW).allowed).toBe(false);
  });

  it("does not let an admin read a candidate's CV", () => {
    // Administering the global catalogue is not the same as being a superuser.
    // Collapsing the two is how "admin" quietly becomes "reads everyone's
    // salary expectations".
    expect(can(admin(), "candidate:read", { kind: "candidate", candidateId: 1 }, NOW).allowed).toBe(false);
    expect(can(admin(), "candidate:write", { kind: "candidate", candidateId: 1 }, NOW).allowed).toBe(false);
  });
});

describe("admin actions", () => {
  it("requires the admin role", () => {
    for (const action of ["admin:access", "skill:audit", "provider:manage"] as Action[]) {
      expect(can(owner(), action, { kind: "global" }, NOW).allowed, action).toBe(false);
      expect(can(admin(), action, { kind: "global" }, NOW).allowed, action).toBe(true);
    }
  });
});

describe("job corpus", () => {
  it("is readable by any valid session — it is not per-candidate", () => {
    expect(can(owner(), "job:read", { kind: "global" }, NOW).allowed).toBe(true);
    expect(can(admin(), "job:read", { kind: "global" }, NOW).allowed).toBe(true);
  });
});

describe("authorize", () => {
  it("throws with the action named, for a log that is useful", () => {
    expect(() => authorize(null, "job:read", { kind: "global" }, NOW)).toThrow(AuthorizationError);
    try {
      authorize(owner(1), "candidate:read", { kind: "candidate", candidateId: 9 }, NOW);
      expect.unreachable("deveria ter negado");
    } catch (error) {
      expect((error as AuthorizationError).action).toBe("candidate:read");
      expect((error as Error).message).toContain("outro candidato");
    }
  });

  it("stays silent when allowed", () => {
    expect(() => authorize(owner(1), "candidate:read", { kind: "candidate", candidateId: 1 }, NOW)).not.toThrow();
  });
});

describe("candidateScope", () => {
  it("comes from the session and nowhere else", () => {
    expect(candidateScope(owner(7))).toBe(7);
    expect(candidateScope(admin())).toBeNull();
    expect(candidateScope(null)).toBeNull();
  });
});
