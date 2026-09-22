import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginImpersonation,
  changePasswordForSession,
  createUser,
  endSession,
  MAX_CHANGE_ATTEMPTS,
  passwordSignIn,
  renameForSession,
  resolveSession,
  setPassword,
  type Role,
  type Session,
} from "../src/contexts/auth/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, authSession, authUser } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Minha conta (#236): trocar a própria senha e o próprio nome.
 *
 * O que se trava aqui é o que tornaria a tela uma porta: senha atual exigida,
 * limite de tentativas que não deixa rajada concorrente passar junto, hash
 * corrompido negando, sessões antigas caindo e a sessão emprestada sem acesso
 * à conta do alvo. A negação antes de efeito para sessão ausente, forjada,
 * vencida e revogada é varrida em `tests/entry-denial.test.ts` para toda
 * action descoberta; aqui ela é afirmada também para a sessão emprestada.
 */

const boundary = vi.hoisted(() => ({
  token: undefined as string | undefined,
  effects: [] as string[],
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "jho_session" && boundary.token !== undefined ? { name, value: boundary.token } : undefined,
    set: (name: string, value: string) => {
      boundary.effects.push(`cookies.set(${name})`);
      boundary.cookies.set(name, value);
    },
  }),
  headers: async () => new Headers({ host: "127.0.0.1:3000" }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    boundary.effects.push(`redirect(${to})`);
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  forbidden: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => void boundary.effects.push(`revalidatePath(${path})`),
}));

const { changePasswordAction, renameAction } = await import("../app/account/actions.ts");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "executou";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const SENHA = "senha-atual-bem-longa";
const NOVA = "senha-nova-bem-longa-2";

let db: DB;

async function account(email: string, roles: Role[] = ["candidate"]): Promise<{ id: number; token: string; session: Session }> {
  const { id } = await createUser({ email, fullName: email, roles });
  await setPassword(email, SENHA);
  const login = await passwordSignIn(email, SENHA);
  if (!login.ok) throw new Error(`login de ${email} falhou`);
  return { id, token: login.token, session: login.session };
}

async function events(userId: number, kind: string) {
  return db.select().from(authEvent).where(and(eq(authEvent.userId, userId), eq(authEvent.kind, kind)));
}

beforeEach(async () => {
  db = await useTestDb();
  boundary.token = undefined;
  boundary.effects = [];
  boundary.cookies.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await releaseTestDb();
});

describe("trocar a própria senha", () => {
  it("com a senha atual certa, troca, derruba as outras sessões e mantém quem pediu", async () => {
    const me = await account("eu@example.test");
    const other = await passwordSignIn("eu@example.test", SENHA);
    if (!other.ok) throw new Error("segunda sessão");

    const result = await changePasswordForSession(me.session, SENHA, NOVA);
    if (!result.ok) throw new Error(result.reason);

    // As duas sessões antigas caíram — inclusive o token deste navegador, que
    // é substituído por um novo. Um cookie copiado antes da troca não vale.
    expect(await resolveSession(me.token)).toBeNull();
    expect(await resolveSession(other.token)).toBeNull();
    expect((await resolveSession(result.token))?.userId).toBe(me.id);

    expect((await passwordSignIn("eu@example.test", NOVA)).ok).toBe(true);
    expect((await passwordSignIn("eu@example.test", SENHA)).ok).toBe(false);
    expect(await events(me.id, "password_changed")).toHaveLength(1);
  });

  it("senha atual errada não troca nada e fica registrada", async () => {
    const me = await account("eu@example.test");
    const [before] = await db.select({ hash: authUser.passwordHash }).from(authUser).where(eq(authUser.id, me.id));

    expect(await changePasswordForSession(me.session, "errada-errada-errada", NOVA)).toEqual({
      ok: false,
      reason: "invalid",
    });

    const [after] = await db.select({ hash: authUser.passwordHash }).from(authUser).where(eq(authUser.id, me.id));
    expect(after!.hash).toBe(before!.hash);
    expect(await resolveSession(me.token)).not.toBeNull();
    expect(await events(me.id, "password_change_failed")).toHaveLength(1);
  });

  it("senha nova fraca é recusada sem consumir tentativa", async () => {
    const me = await account("eu@example.test");
    expect(await changePasswordForSession(me.session, SENHA, "curta")).toEqual({ ok: false, reason: "weak" });
    expect(await events(me.id, "password_change_attempt")).toHaveLength(0);
  });

  it(`depois de ${MAX_CHANGE_ATTEMPTS} tentativas, nem a senha certa passa`, async () => {
    const me = await account("eu@example.test");
    for (let i = 0; i < MAX_CHANGE_ATTEMPTS; i++) {
      expect((await changePasswordForSession(me.session, `errada-${i}-bem-longa`, NOVA)).ok).toBe(false);
    }
    expect(await changePasswordForSession(me.session, SENHA, NOVA)).toEqual({ ok: false, reason: "rate_limited" });
    expect((await passwordSignIn("eu@example.test", SENHA)).ok).toBe(true);
  });

  it("rajada concorrente não passa junta pelo limite", async () => {
    // A tentativa é gravada ANTES de ser contada: a k-ésima gravação enxerga
    // pelo menos k. Contar primeiro deixaria as dez verem zero.
    const me = await account("eu@example.test");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => changePasswordForSession(me.session, `errada-${i}-bem-longa`, NOVA)),
    );
    const verified = results.filter((r) => !r.ok && r.reason === "invalid");
    expect(verified.length).toBeLessThanOrEqual(MAX_CHANGE_ATTEMPTS);
    expect(results.filter((r) => !r.ok && r.reason === "rate_limited").length).toBeGreaterThanOrEqual(10 - MAX_CHANGE_ATTEMPTS);
  });

  it("hash gravado truncado NEGA, nunca concede", async () => {
    // O caso da regra "hash de senha com tamanho errado nega acesso": hash
    // corrompido não pode virar "qualquer senha serve".
    const me = await account("eu@example.test");
    const [row] = await db.select({ hash: authUser.passwordHash }).from(authUser).where(eq(authUser.id, me.id));
    const parts = row!.hash!.split("$");
    parts[5] = "";
    await db.update(authUser).set({ passwordHash: parts.join("$") }).where(eq(authUser.id, me.id));

    for (const tentativa of ["", "qualquer-coisa-longa", SENHA]) {
      expect(await changePasswordForSession(me.session, tentativa, NOVA)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("conta sem senha não define uma por aqui", async () => {
    // Sem senha atual não há o que provar; definir a primeira por esta tela
    // deixaria uma sessão roubada virar posse permanente da conta.
    const { id } = await createUser({ email: "link@example.test", fullName: "Link", roles: ["recruiter"] });
    const session = {
      userId: id,
      candidateId: null,
      roles: ["recruiter"],
      email: "link@example.test",
      fullName: "Link",
      expiresAt: "2999-01-01T00:00:00.000Z",
      linkedCandidateIds: [],
      impersonatedBy: null,
    } satisfies Session;
    expect(await changePasswordForSession(session, "", NOVA)).toEqual({ ok: false, reason: "no_password" });
  });

  it("a troca vale só para a conta da sessão", async () => {
    const me = await account("eu@example.test");
    await account("outra@example.test");
    const result = await changePasswordForSession(me.session, SENHA, NOVA);
    expect(result.ok).toBe(true);
    expect((await passwordSignIn("outra@example.test", SENHA)).ok).toBe(true);
  });
});

describe("sessão emprestada não altera a conta do alvo", () => {
  it("nem senha nem nome, mesmo quando o alvo é admin", async () => {
    const admin = await account("admin@example.test", ["admin"]);
    const target = await account("alvo@example.test", ["admin", "candidate"]);
    const borrowed = await beginImpersonation(admin.session, target.id);
    if (!borrowed.ok) throw new Error(borrowed.reason);
    const session = await resolveSession(borrowed.token);
    expect(session?.impersonatedBy).toBe(admin.id);

    await expect(changePasswordForSession(session!, SENHA, NOVA)).rejects.toThrow(/sessão emprestada/);
    await expect(renameForSession(session!, "Outro nome")).rejects.toThrow(/sessão emprestada/);

    const [row] = await db.select().from(authUser).where(eq(authUser.id, target.id));
    expect(row!.fullName).toBe("alvo@example.test");
    expect((await passwordSignIn("alvo@example.test", SENHA)).ok).toBe(true);
    expect(await events(target.id, "password_change_attempt")).toHaveLength(0);
  });
});

describe("trocar o próprio nome", () => {
  it("muda só o nome da conta da sessão e registra", async () => {
    const me = await account("eu@example.test");
    const other = await account("outra@example.test");
    await renameForSession(me.session, "Meu Nome");

    const [mine] = await db.select().from(authUser).where(eq(authUser.id, me.id));
    const [theirs] = await db.select().from(authUser).where(eq(authUser.id, other.id));
    expect(mine!.fullName).toBe("Meu Nome");
    expect(mine!.email).toBe("eu@example.test");
    expect(theirs!.fullName).toBe("outra@example.test");
    expect(await events(me.id, "profile_updated")).toHaveLength(1);
    // O nome é lido do banco a cada requisição: o topo muda sem novo login.
    expect((await resolveSession(me.token))?.fullName).toBe("Meu Nome");
  });
});

describe("as actions da tela", () => {
  it("trocar a senha grava o cookie novo e volta com o estado na URL", async () => {
    const me = await account("eu@example.test");
    boundary.token = me.token;

    const result = await outcome(() =>
      changePasswordAction(form({ currentPassword: SENHA, newPassword: NOVA, confirmPassword: NOVA })),
    );

    expect(result).toBe("NEXT_REDIRECT;/account?status=password-changed");
    const fresh = boundary.cookies.get("jho_session");
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(me.token);
    expect((await resolveSession(fresh!))?.userId).toBe(me.id);
  });

  it("confirmação diferente volta sem gastar tentativa", async () => {
    const me = await account("eu@example.test");
    boundary.token = me.token;
    const result = await outcome(() =>
      changePasswordAction(form({ currentPassword: SENHA, newPassword: NOVA, confirmPassword: `${NOVA}x` })),
    );
    expect(result).toBe("NEXT_REDIRECT;/account?status=password-mismatch");
    expect(await events(me.id, "password_change_attempt")).toHaveLength(0);
  });

  it("id e e-mail de outra conta no formulário são ignorados: vale a sessão", async () => {
    const me = await account("eu@example.test");
    const other = await account("outra@example.test");
    boundary.token = me.token;
    const hostile = {
      userId: String(other.id),
      email: "outra@example.test",
      username: "outra@example.test",
      fullName: "Renomeada",
    };

    await outcome(() => renameAction(form(hostile)));
    await outcome(() =>
      changePasswordAction(form({ ...hostile, currentPassword: SENHA, newPassword: NOVA, confirmPassword: NOVA })),
    );

    const [theirs] = await db.select().from(authUser).where(eq(authUser.id, other.id));
    expect(theirs!.fullName).toBe("outra@example.test");
    expect((await passwordSignIn("outra@example.test", SENHA)).ok).toBe(true);
    expect(await resolveSession(other.token)).not.toBeNull();
    const [mine] = await db.select().from(authUser).where(eq(authUser.id, me.id));
    expect(mine!.fullName).toBe("Renomeada");
    expect((await passwordSignIn("eu@example.test", NOVA)).ok).toBe(true);
  });

  it("sessão emprestada, vencida ou revogada nega antes de qualquer efeito", async () => {
    const admin = await account("admin@example.test", ["admin"]);
    const target = await account("alvo@example.test", ["candidate"]);
    const borrowed = await beginImpersonation(admin.session, target.id);
    if (!borrowed.ok) throw new Error(borrowed.reason);

    const expired = await account("vencida@example.test");
    await db.update(authSession).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).where(eq(authSession.userId, expired.id));
    const revoked = await account("revogada@example.test");
    await endSession(revoked.token);

    const change = form({ currentPassword: SENHA, newPassword: NOVA, confirmPassword: NOVA });
    for (const token of [borrowed.token, expired.token, revoked.token, undefined]) {
      boundary.token = token;
      boundary.effects = [];
      expect(await outcome(() => changePasswordAction(change))).toMatch(/^negado: account:write/);
      expect(await outcome(() => renameAction(form({ fullName: "Intruso" })))).toMatch(/^negado: account:write/);
      expect(boundary.effects).toEqual([]);
    }

    const [row] = await db.select().from(authUser).where(eq(authUser.id, target.id));
    expect(row!.fullName).toBe("alvo@example.test");
    expect((await passwordSignIn("alvo@example.test", SENHA)).ok).toBe(true);
  });
});
