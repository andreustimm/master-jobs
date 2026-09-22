import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { authLoginToken, authUser, candidate } from "../src/core/db/schema.ts";
import { drizzleSessions, magicLink } from "../src/contexts/auth/infra/drizzle-store.ts";
import { setPassword, verifyLogin } from "../src/contexts/auth/infra/password-login.ts";
import { seedOwner } from "../src/contexts/auth/app/seed.ts";
import { addUser, claimOwnCandidate } from "../src/contexts/auth/app/accounts.ts";
import { authorize, candidateScope } from "../src/contexts/auth/domain/policy.ts";
import { ensureCandidate, syncCandidateFromProfile } from "../src/core/candidate.ts";
import { isOwner } from "../src/contexts/matching/infra/drizzle-tracks.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * INCIDENTE (v1.20.5): o admin assumiu a identidade de um convidado e
 * `/candidate` mostrou o currículo, a visibilidade e as versões do DONO.
 *
 * Causa: `jho auth add-user` ligava toda conta de papel candidato ao candidato
 * `default`, e a sessão confiava em `auth_user.candidate_id` como prova de
 * posse. Estes casos travam as duas metades: a leitura da sessão nega o
 * candidato compartilhado mesmo com o dado errado já gravado, e os caminhos de
 * cadastro não gravam mais esse dado.
 */

let db: DB;
const EXPIRA = "2026-09-19T12:00:00.000Z";

beforeEach(async () => {
  db = await useTestDb();
  setClock(fixedClock("2026-08-19T12:00:00.000Z"));
});

afterEach(async () => {
  resetClock();
  await releaseTestDb();
});

async function novoCandidato(slug: string): Promise<number> {
  const [row] = await db.insert(candidate).values({ slug, name: slug }).returning({ id: candidate.id });
  return row!.id;
}

async function novaConta(email: string, candidateId: number | null, roles = ["candidate"]) {
  const [row] = await db
    .insert(authUser)
    .values({ email, roles, candidateId })
    .returning({ id: authUser.id });
  return row!.id;
}

/**
 * O dado de produção de antes da migração 0009: duas contas no mesmo
 * candidato. O índice único recusa gravá-lo, então o teste da leitura o
 * derruba primeiro — a sessão precisa negar mesmo com o índice ausente.
 */
async function semIndiceUnico() {
  await db.execute(sql`drop index production.auth_user_candidate_idx`);
}

async function sessao(userId: number, impersonatedBy: number | null = null) {
  const token = await drizzleSessions.create({ userId, expiresAt: EXPIRA, impersonatedBy });
  return drizzleSessions.resolve(token);
}

describe("escopo de candidato na sessão", () => {
  it("o dono continua vendo o próprio candidato", async () => {
    const doDono = await novoCandidato("default");
    const dono = await novaConta("dono@test", doDono, ["admin", "candidate"]);

    const s = await sessao(dono);

    expect(candidateScope(s)).toBe(doDono);
  });

  it("conta posterior apontada para o candidato do dono não recebe escopo", async () => {
    // O dado errado que `add-user` gravou em produção.
    await semIndiceUnico();
    const doDono = await novoCandidato("default");
    const dono = await novaConta("dono@test", doDono, ["admin", "candidate"]);
    const convidado = await novaConta("convidado@test", doDono);

    const s = await sessao(convidado);

    expect(candidateScope(s)).toBeNull();
    expect(() => authorize(s, "candidate:read", { kind: "candidate", candidateId: doDono })).toThrow();
    expect(() => authorize(s, "candidate:write", { kind: "candidate", candidateId: doDono })).toThrow();
    // E o dono não perde o próprio perfil pelo erro de cadastro alheio.
    expect(candidateScope(await sessao(dono))).toBe(doDono);
  });

  it("sessão emprestada do admin para convidado sem candidato próprio não alcança o dono", async () => {
    await semIndiceUnico();
    const doDono = await novoCandidato("default");
    const dono = await novaConta("dono@test", doDono, ["admin", "candidate"]);
    const convidado = await novaConta("convidado@test", doDono);

    const s = await sessao(convidado, dono);

    expect(s!.impersonatedBy).toBe(dono);
    expect(candidateScope(s)).toBeNull();
    expect(() => authorize(s, "candidate:read", { kind: "candidate", candidateId: doDono })).toThrow();
  });

  it("sessão emprestada para convidado sem candidato nenhum não herda o do admin", async () => {
    const doDono = await novoCandidato("default");
    const dono = await novaConta("dono@test", doDono, ["admin", "candidate"]);
    const convidado = await novaConta("convidado@test", null);

    const s = await sessao(convidado, dono);

    expect(candidateScope(s)).toBeNull();
  });

  it("convidado com candidato próprio vê o dele, nunca o do dono", async () => {
    const doDono = await novoCandidato("default");
    await novaConta("dono@test", doDono, ["admin", "candidate"]);
    const proprio = await novoCandidato("user-convidado-test");
    const convidado = await novaConta("convidado@test", proprio);

    const s = await sessao(convidado);

    expect(candidateScope(s)).toBe(proprio);
    expect(() => authorize(s, "candidate:read", { kind: "candidate", candidateId: doDono })).toThrow();
  });

  it("login por senha e por link também negam o candidato compartilhado", async () => {
    await semIndiceUnico();
    const doDono = await novoCandidato("default");
    await novaConta("dono@test", doDono, ["admin", "candidate"]);
    await novaConta("convidado@test", doDono);

    await setPassword("convidado@test", "senha-bem-longa-2026");
    const porSenha = await verifyLogin("convidado@test", "senha-bem-longa-2026");
    expect(porSenha.ok && porSenha.identity.candidateId).toBeNull();

    const { token } = await magicLink.begin("convidado@test");
    const porLink = await magicLink.complete(token);
    expect(porLink!.candidateId).toBeNull();
    expect(await db.select().from(authLoginToken)).toHaveLength(1);
  });
});

describe("cadastro não liga conta nova ao candidato do dono", () => {
  it("a primeira conta da instalação fica com o candidato do perfil", async () => {
    const r = await addUser({ email: "dono@test", roles: ["admin", "candidate"] });

    const [row] = await db.select().from(candidate).where(eq(candidate.id, r.candidateId!));
    expect(row!.slug).toBe("default");
  });

  it("addUser com papel candidato cria candidato próprio", async () => {
    await seedOwner({ email: "dono@test" });
    const doDono = await syncCandidateFromProfile();

    const r = await addUser({ email: "Convidado@Test", roles: ["candidate"] });

    expect(r.candidateId).not.toBeNull();
    expect(r.candidateId).not.toBe(doDono);
    const [row] = await db.select().from(candidate).where(eq(candidate.id, r.candidateId!));
    expect(row!.slug).toBe("user-convidado-test");
  });

  it("addUser não troca o vínculo de conta existente", async () => {
    const primeiro = await addUser({ email: "eu@test", roles: ["candidate"] });
    const segundo = await addUser({ email: "eu@test", roles: ["admin", "candidate"] });

    expect(segundo.candidateId).toBe(primeiro.candidateId);
    const [row] = await db.select().from(authUser);
    expect(row!.roles).toEqual(["admin", "candidate"]);
  });

  it("seedOwner com outro e-mail recusa em vez de criar segunda conta no candidato do dono", async () => {
    await seedOwner({ email: "dono@test" });

    await expect(seedOwner({ email: "outro@test" })).rejects.toThrow(/dono@test/);

    expect(await db.select().from(authUser)).toHaveLength(1);
  });
});

describe("um candidato, uma conta", () => {
  it("o banco recusa a segunda conta no mesmo candidato", async () => {
    const doDono = await novoCandidato("default");
    await novaConta("dono@test", doDono, ["admin", "candidate"]);

    await expect(novaConta("convidado@test", doDono)).rejects.toMatchObject({
      cause: { constraint_name: "auth_user_candidate_idx" },
    });
    // Várias contas sem candidato continuam possíveis.
    await novaConta("admin2@test", null, ["admin"]);
    await novaConta("recrutador@test", null, ["recruiter"]);
  });

  it("slug que colide com candidato de outra conta não é reaproveitado", async () => {
    // `a.b@x.test` e `a-b@x.test` derivam o mesmo slug.
    const primeiro = await claimOwnCandidate({ email: "a.b@x.test", name: "A" });
    await novaConta("a.b@x.test", primeiro);

    const segundo = await claimOwnCandidate({ email: "a-b@x.test", name: "B" });

    expect(segundo).not.toBe(primeiro);
    const [row] = await db.select().from(candidate).where(eq(candidate.id, segundo));
    expect(row!.slug).toBe("user-a-b-x-test-2");
  });

  it("candidato órfão de conta apagada nunca é reaproveitado", async () => {
    // Apagar a conta não apaga o candidato: o currículo de quem saiu continua lá.
    const orfao = await claimOwnCandidate({ email: "volta@test", name: "Volta" });

    expect(await claimOwnCandidate({ email: "volta@test", name: "Volta" })).not.toBe(orfao);
  });

  it("o dono que entrou só como admin ganha o candidato do perfil ao virar candidato", async () => {
    await addUser({ email: "dono@test", roles: ["admin"] });

    const r = await addUser({ email: "dono@test", roles: ["admin", "candidate"] });

    const [row] = await db.select().from(candidate).where(eq(candidate.id, r.candidateId!));
    expect(row!.slug).toBe("default");
  });

  it("slug `default` é o dono mesmo com convidado padrão legado mais antigo", async () => {
    const [legado] = await db
      .insert(candidate)
      .values({ slug: "user-legado-test", name: "Legado", isDefault: true })
      .returning({ id: candidate.id });
    const doDono = await syncCandidateFromProfile();

    expect(await isOwner(doDono)).toBe(true);
    expect(await isOwner(legado!.id)).toBe(false);
  });
});

describe("candidato de convidado não é o dono", () => {
  it("ensureCandidate só marca como padrão o candidato `default`", async () => {
    const doDono = await syncCandidateFromProfile();
    const convidado = await ensureCandidate({ slug: "user-convidado-test", name: "Convidado" });

    expect(await isOwner(doDono)).toBe(true);
    // Marcado como padrão, o convidado era pontuado com o `profile.yaml` do
    // dono — piso salarial incluído.
    expect(await isOwner(convidado)).toBe(false);
  });

  it("linha já gravada como padrão depois do dono não vira dono", async () => {
    // O que `ensureCandidate` gravou em produção antes da correção.
    const doDono = await syncCandidateFromProfile();
    const [row] = await db
      .insert(candidate)
      .values({ slug: "user-antigo-test", name: "Antigo", isDefault: true })
      .returning({ id: candidate.id });

    expect(await isOwner(row!.id)).toBe(false);
    expect(await isOwner(doDono)).toBe(true);
  });
});
