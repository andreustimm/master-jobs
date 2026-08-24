import { scrypt as scryptCb } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkPassword,
  hashPassword,
  KdfIndisponivelError,
  MIN_LENGTH,
  verifyPassword,
} from "../src/contexts/auth/domain/password.ts";
import {
  MAX_ATTEMPTS,
  recentFailures,
  setPassword,
  verifyLogin,
} from "../src/contexts/auth/infra/password-login.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { authUser, candidate } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Login-flow tests own address isolation, database events and account state.
 * The production work factor is exercised above by hashPassword/verifyPassword;
 * repeating its 64 MB allocation for every control-flow assertion makes those
 * assertions depend on runner memory instead of the behavior they protect.
 */
async function loginFixtureHash(password: string): Promise<string> {
  const salt = Buffer.alloc(16, 7);
  const params = { N: 2 ** 10, r: 8, p: 1 } as const;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, 32, { ...params, maxmem: 8 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

describe("hashPassword / verifyPassword", () => {
  it("round-trips", async () => {
    const hash = await hashPassword("uma-senha-bem-longa");
    expect(await verifyPassword("uma-senha-bem-longa", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("uma-senha-bem-longa");
    expect(await verifyPassword("uma-senha-bem-long", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    // Without a salt, identical passwords share a hash and one rainbow table
    // breaks every account at once.
    const a = await hashPassword("mesma-senha-aqui-ok");
    const b = await hashPassword("mesma-senha-aqui-ok");
    expect(a).not.toBe(b);
    expect(await verifyPassword("mesma-senha-aqui-ok", a)).toBe(true);
    expect(await verifyPassword("mesma-senha-aqui-ok", b)).toBe(true);
  });

  it("carries its parameters, so the cost can be raised later", async () => {
    const hash = await hashPassword("uma-senha-bem-longa");
    expect(hash.startsWith("scrypt$65536$8$1$")).toBe(true);
  });

  it("treats a malformed stored value as a wrong password, never an error", async () => {
    // A throw here would be a 500 that tells an attacker the account exists.
    for (const junk of ["", "nao-e-hash", "scrypt$x$y$z$a$b", "bcrypt$1$2$3$4$5"]) {
      expect(await verifyPassword("qualquer", junk), junk).toBe(false);
    }
    expect(await verifyPassword("qualquer", null)).toBe(false);
  });
});

describe("checkPassword", () => {
  it("requires length and nothing else", () => {
    // Composition rules push people to Password1! and are worse than length —
    // NIST dropped them for that reason.
    expect(checkPassword("x".repeat(MIN_LENGTH - 1)).ok).toBe(false);
    expect(checkPassword("x".repeat(MIN_LENGTH)).ok).toBe(true);
    expect(checkPassword("todas minusculas sem simbolo").ok).toBe(true);
  });

  it("refuses an absurd length", () => {
    expect(checkPassword("x".repeat(2000)).ok).toBe(false);
  });
});

describe("verifyLogin", () => {
  let db: DB;
  let time: ReturnType<typeof fixedClock>;

  beforeEach(async () => {
    db = await useTestDb();
    time = fixedClock("2026-08-19T12:00:00.000Z");
    setClock(time);

    const [c] = await db
      .insert(candidate)
      .values({ slug: "eu", name: "Eu" })
      .returning({ id: candidate.id });
    await db.insert(authUser).values({
      email: "eu@test",
      roles: ["owner"],
      candidateId: c!.id,
      passwordHash: await loginFixtureHash("senha-correta-longa"),
    });
  });

  afterEach(() => {
    resetClock();
    releaseTestDb();
  });

  it("accepts the right password", async () => {
    const r = await verifyLogin("eu@test", "senha-correta-longa");
    expect(r.ok).toBe(true);
    expect(r.ok && r.identity.email).toBe("eu@test");
  });

  it("normalises the address", async () => {
    expect((await verifyLogin("  EU@TEST  ", "senha-correta-longa")).ok).toBe(true);
  });

  it("gives the same answer for a wrong password and a missing account", async () => {
    // Anything else turns the login form into an account-enumeration oracle.
    const wrong = await verifyLogin("eu@test", "errada-mesmo-longa");
    const missing = await verifyLogin("ninguem@test", "errada-mesmo-longa");
    expect(wrong).toEqual({ ok: false, reason: "invalid" });
    expect(missing).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an account with no password set", async () => {
    await db.insert(authUser).values({ email: "sem@test", roles: ["owner"], candidateId: null });
    expect((await verifyLogin("sem@test", "qualquer-coisa-longa")).ok).toBe(false);
  });

  it("refuses a disabled account even with the right password", async () => {
    await db.update(authUser).set({ disabledAt: time.iso() });
    expect((await verifyLogin("eu@test", "senha-correta-longa")).ok).toBe(false);
  });

  it("rate-limits after repeated failures", async () => {
    // scrypt makes each guess expensive; the limit makes a campaign impossible.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await verifyLogin("eu@test", `tentativa-errada-${i}`);
    }
    const blocked = await verifyLogin("eu@test", "senha-correta-longa");
    expect(blocked).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("lets the window expire", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await verifyLogin("eu@test", `errada-${i}`);
    }
    expect((await verifyLogin("eu@test", "senha-correta-longa")).ok).toBe(false);

    time.advance(16 * 60_000);
    expect((await verifyLogin("eu@test", "senha-correta-longa")).ok).toBe(true);
  });

  /**
   * O KDF que não roda.
   *
   * scrypt com os parâmetros deste sistema pede ~64 MB por chamada. Sob carga a
   * alocação falha, e o `catch` que existia devolvia `false` — dizendo a quem
   * digitou a senha CERTA que ela estava errada, com o registro do sistema
   * concordando. Erro operacional não é veredito sobre credencial.
   *
   * A falha aqui é real, não dublada: `N` alto o bastante para estourar o
   * `maxmem` faz o próprio Node recusar, que é o mesmo caminho de código que a
   * pressão de memória percorre.
   */
  function hashComKdfImpossivel(): string {
    // Formato: scrypt$N$r$p$salt$hash. O comprimento do hash precisa bater com
    // KEYLEN (32 bytes), senão a checagem anterior rejeita antes do KDF.
    const salt = Buffer.alloc(16, 7).toString("base64url");
    const hash = Buffer.alloc(32, 9).toString("base64url");
    return `scrypt$1048576$8$1$${salt}$${hash}`;
  }

  it("KDF que não roda é erro, e não senha errada", async () => {
    await expect(verifyPassword("qualquer-senha-longa", hashComKdfImpossivel())).rejects.toThrow(
      KdfIndisponivelError,
    );
  });

  it("formato inválido continua sendo `false`, e não erro", async () => {
    // A distinção que importa: ali o dado gravado É a resposta, e negar é
    // correto. Transformar isto em exceção viraria um 500 que confirma a
    // existência da conta.
    expect(await verifyPassword("qualquer", "bcrypt$1$2$3$4$5")).toBe(false);
  });

  it("login com KDF indisponível avisa que não verificou, sem culpar a senha", async () => {
    await db.update(authUser).set({ passwordHash: hashComKdfImpossivel() });

    const r = await verifyLogin("eu@test", "senha-correta-longa");

    // `unavailable`, e não `invalid`: a senha pode estar perfeitamente certa.
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });

  it("falha de infraestrutura NÃO conta para o limite de tentativas", async () => {
    await db.update(authUser).set({ passwordHash: hashComKdfImpossivel() });

    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await verifyLogin("eu@test", "senha-correta-longa");
    }

    // Se estas falhas alimentassem `login_failed`, uma indisponibilidade do
    // servidor bloquearia a conta de quem não errou nada — e a pessoa ficaria
    // trancada por um problema que não é dela.
    expect(await recentFailures("eu@test")).toBe(0);
  });

  it("limits per address, not globally", async () => {
    await db.insert(authUser).values({
      email: "outro@test",
      roles: ["owner"],
      candidateId: null,
      passwordHash: await loginFixtureHash("outra-senha-longa"),
    });
    for (let i = 0; i < MAX_ATTEMPTS; i++) await verifyLogin("eu@test", `errada-${i}`);

    // One user locking themselves out must not lock everyone else out.
    expect((await verifyLogin("outro@test", "outra-senha-longa")).ok).toBe(true);
  });
});

describe("setPassword", () => {
  let db: DB;

  beforeEach(async () => {
    db = await useTestDb();
    await db.insert(authUser).values({ email: "eu@test", roles: ["owner"], candidateId: null });
  });
  afterEach(() => releaseTestDb());

  it("stores a hash, never the password", async () => {
    await setPassword("eu@test", "nova-senha-bem-longa");
    const [row] = await db.select().from(authUser);
    expect(row!.passwordHash).not.toContain("nova-senha");
    expect(row!.passwordHash!.startsWith("scrypt$")).toBe(true);
  });

  it("reports an unknown account", async () => {
    expect(await setPassword("ninguem@test", "qualquer-senha-longa")).toBe(false);
  });

  it("makes the new password work and the old one stop", async () => {
    await setPassword("eu@test", "primeira-senha-longa");
    await setPassword("eu@test", "segunda-senha-longa");
    expect((await verifyLogin("eu@test", "segunda-senha-longa")).ok).toBe(true);
    expect((await verifyLogin("eu@test", "primeira-senha-longa")).ok).toBe(false);
  });
});
