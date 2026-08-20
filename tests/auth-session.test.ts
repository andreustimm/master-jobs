import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, authLoginToken, authSession, authUser, candidate } from "../src/core/db/schema.ts";
import {
  drizzleAuthRepository,
  drizzleSessions,
  magicLink,
} from "../src/contexts/auth/infra/drizzle-store.ts";
import { drizzlePasswords } from "../src/contexts/auth/infra/password-login.ts";
import { completeLogin, isSingleUser, logout, singleUserSession } from "../src/contexts/auth/app/session.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let time: ReturnType<typeof fixedClock>;

const deps = {
  sessions: drizzleSessions,
  identity: magicLink,
  passwords: drizzlePasswords,
  repository: drizzleAuthRepository,
};

async function seedUser(email = "eu@test", candidateNumber: number | null = 1) {
  // The FK is real, so the candidate has to exist. Creating it here keeps the
  // test honest about what the schema actually requires.
  let candidateId: number | null = null;
  if (candidateNumber !== null) {
    const [row] = await db
      .insert(candidate)
      .values({ slug: `candidato-${candidateNumber}`, name: `Candidato ${candidateNumber}` })
      .returning({ id: candidate.id });
    candidateId = row!.id;
  }

  const [user] = await db
    .insert(authUser)
    .values({ email, roles: ["candidate"], candidateId })
    .returning({ id: authUser.id });
  return user!.id;
}

beforeEach(async () => {
  db = await useTestDb();
  time = fixedClock("2026-08-19T12:00:00.000Z");
  setClock(time);
});

afterEach(() => {
  resetClock();
  releaseTestDb();
});

describe("session store", () => {
  it("never stores the token itself", async () => {
    // A copy of the database must not be a copy of everyone's credentials.
    const userId = await seedUser();
    const token = await drizzleSessions.create({
      userId,
      expiresAt: "2026-09-19T12:00:00.000Z",
    });

    const [row] = await db.select().from(authSession);
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("resolves a valid token to its session", async () => {
    const userId = await seedUser("eu@test", 1);
    const token = await drizzleSessions.create({ userId, expiresAt: "2026-09-19T12:00:00.000Z" });

    const session = await drizzleSessions.resolve(token);
    expect(session!.candidateId).not.toBeNull();
    expect(session!.roles).toEqual(["candidate"]);
  });

  it("refuses an unknown token", async () => {
    expect(await drizzleSessions.resolve("inventado")).toBeNull();
    expect(await drizzleSessions.resolve("")).toBeNull();
  });

  it("refuses an expired session the moment it expires", async () => {
    const userId = await seedUser();
    const token = await drizzleSessions.create({ userId, expiresAt: "2026-08-19T13:00:00.000Z" });
    expect(await drizzleSessions.resolve(token)).not.toBeNull();

    time.advance(61 * 60_000);
    expect(await drizzleSessions.resolve(token)).toBeNull();
  });

  it("refuses a revoked session even before it expires", async () => {
    // A cookie the client deletes is still a valid credential to whoever
    // copied it, so logout has to mean something server-side.
    const userId = await seedUser();
    const token = await drizzleSessions.create({ userId, expiresAt: "2026-09-19T12:00:00.000Z" });
    await drizzleSessions.revoke(token);
    expect(await drizzleSessions.resolve(token)).toBeNull();
  });

  it("cuts off a disabled account immediately, not at expiry", async () => {
    const userId = await seedUser();
    const token = await drizzleSessions.create({ userId, expiresAt: "2026-09-19T12:00:00.000Z" });
    await db.update(authUser).set({ disabledAt: time.iso() }).where(eq(authUser.id, userId));
    expect(await drizzleSessions.resolve(token)).toBeNull();
  });

  it("revokes every session for a user at once", async () => {
    const userId = await seedUser();
    const tokens = await Promise.all([
      drizzleSessions.create({ userId, expiresAt: "2026-09-19T12:00:00.000Z" }),
      drizzleSessions.create({ userId, expiresAt: "2026-09-19T12:00:00.000Z" }),
    ]);
    expect(await drizzleSessions.revokeAllFor(userId)).toBe(2);
    for (const token of tokens) {
      expect(await drizzleSessions.resolve(token)).toBeNull();
    }
  });

  it("issues a different token every time", async () => {
    const userId = await seedUser();
    const tokens = new Set(
      await Promise.all(
        Array.from({ length: 20 }, () =>
          drizzleSessions.create({ userId, expiresAt: "2026-09-19T12:00:00.000Z" }),
        ),
      ),
    );
    expect(tokens.size).toBe(20);
  });
});

describe("magic link", () => {
  it("stores only a hash of the login token", async () => {
    await seedUser();
    const { token } = await magicLink.begin("eu@test");
    const [row] = await db.select().from(authLoginToken);
    expect(row!.tokenHash).not.toBe(token);
  });

  it("is single use", async () => {
    // The second redemption must fail, or a link forwarded or logged anywhere
    // stays a working credential.
    await seedUser();
    const { token } = await magicLink.begin("eu@test");
    expect(await magicLink.complete(token)).not.toBeNull();
    expect(await magicLink.complete(token)).toBeNull();
  });

  it("expires", async () => {
    await seedUser();
    const { token } = await magicLink.begin("eu@test");
    time.advance(16 * 60_000);
    expect(await magicLink.complete(token)).toBeNull();
  });

  it("creates no account for an unknown address", async () => {
    // This is a personal system, not a public sign-up. And the caller cannot
    // tell an unknown address from a bad token.
    const { token } = await magicLink.begin("estranho@test");
    expect(await magicLink.complete(token)).toBeNull();
    expect(await db.select().from(authUser)).toHaveLength(0);
  });

  it("normalises the address", async () => {
    await seedUser("eu@test");
    const { token } = await magicLink.begin("  EU@TEST  ");
    expect(await magicLink.complete(token)).not.toBeNull();
  });
});

describe("login and logout", () => {
  it("mints a fresh session token on login", async () => {
    // Defeats fixation: a value planted before authentication is not the value
    // that ends up valid.
    await seedUser();
    const { token: loginToken } = await magicLink.begin("eu@test");
    const result = await completeLogin(loginToken, deps);

    expect(result).not.toBeNull();
    expect(result!.token).not.toBe(loginToken);
    expect(await drizzleSessions.resolve(result!.token)).not.toBeNull();
  });

  it("records the login without recording the token", async () => {
    await seedUser();
    const { token: loginToken } = await magicLink.begin("eu@test");
    const result = await completeLogin(loginToken, deps);

    const events = await db.select().from(authEvent);
    expect(events.map((e) => e.kind)).toContain("login");
    // An audit log holding tokens is a credential store, and logs get pasted
    // into issues.
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(result!.token);
    expect(serialised).not.toContain(loginToken);
  });

  it("records a failure without inventing a session", async () => {
    expect(await completeLogin("lixo", deps)).toBeNull();
    const events = await db.select().from(authEvent);
    expect(events[0]!.kind).toBe("login_failed");
  });

  it("revokes on logout", async () => {
    await seedUser();
    const { token: loginToken } = await magicLink.begin("eu@test");
    const result = await completeLogin(loginToken, deps);
    await logout(result!.token, deps);
    expect(await drizzleSessions.resolve(result!.token)).toBeNull();
  });
});

describe("modo aberto", () => {
  it("exige autenticação por omissão", () => {
    // Era o contrário e estava errado: o padrão sintetizava uma sessão e
    // deixava currículo, funil e export acessíveis a qualquer requisição.
    // "Só roda em loopback" protege contra a internet, não contra outro
    // processo, outra conta da máquina, ou um bind mal configurado.
    expect(isSingleUser({})).toBe(false);
    expect(isSingleUser({ JHO_AUTH_MODE: "multi" })).toBe(false);
    expect(isSingleUser({ JHO_AUTH_MODE: "" })).toBe(false);
  });

  it("só abre quando pedido explicitamente", () => {
    expect(isSingleUser({ JHO_AUTH_MODE: "open" })).toBe(true);
  });

  it("synthesises a session that still passes through the same guard", () => {
    const session = singleUserSession(3, Date.parse("2026-08-19T12:00:00Z"));
    expect(session.candidateId).toBe(3);
    expect(session.roles).toContain("candidate");
    expect(session.roles).toContain("admin");
  });
});
