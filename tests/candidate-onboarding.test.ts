import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorize,
  can,
  candidateScope,
  createOwnCandidate,
  createUser,
  setUserDisabled,
  type Session,
} from "../src/contexts/auth/index.ts";
import { currentDocument, getCandidate, syncCandidateFromProfile } from "../src/core/candidate.ts";
import { parseOwnProfile, slugAttempt, slugBaseFromName, CV_MIN } from "../src/core/candidate-identity.ts";
import type { DB } from "../src/core/db/client.ts";
import { authUser, candidate } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Conta nova cria o PRÓPRIO candidato (#234).
 *
 * O incidente de 22/09/2026 foi uma conta de seed apontada para o candidato do
 * dono. Estes testes afirmam o contrário por construção: o candidato criado é
 * sempre uma linha nova, ligada só à conta que pediu, privada, com identidade
 * digitada pela pessoa — e nunca a do `profile.yaml`.
 *
 * `guard` é dublado pela mesma sequência do `app/auth.ts` — sessão, depois a
 * política real —, porque o original lê o cookie do Next.
 */
const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("../app/auth", async () => {
  const { authorize: policy } = await import("../src/contexts/auth/index.ts");
  return {
    guard: async (action: Parameters<typeof policy>[1], resource?: Parameters<typeof policy>[2]) => {
      policy(state.session as Session | null, action, resource ?? { kind: "global" });
      return state.session;
    },
    guardOwnCandidate: async () => {
      throw new Error("não usado aqui");
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { createProfileAction } = await import("../app/candidate/actions.ts");

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  state.session = null;
});

afterEach(async () => {
  await releaseTestDb();
});

async function account(email: string, roles: Session["roles"] = ["candidate"]): Promise<number> {
  return (await createUser({ email, roles })).id;
}

function sessionOf(userId: number, overrides: Partial<Session> = {}): Session {
  return {
    userId,
    candidateId: null,
    roles: ["candidate"],
    email: `${userId}@local.test`,
    fullName: null,
    expiresAt: "2999-01-01T00:00:00.000Z",
    linkedCandidateIds: [],
    impersonatedBy: null,
    ...overrides,
  };
}

/** A sessão como ela seria resolvida agora: `candidate_id` lido da conta. */
async function reloaded(userId: number): Promise<Session> {
  const [row] = await db.select({ candidateId: authUser.candidateId }).from(authUser).where(eq(authUser.id, userId));
  return sessionOf(userId, { candidateId: row?.candidateId ?? null });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const CV = `# Maria Souza\n\n${"Engenheira de dados com experiência em pipelines e ML. ".repeat(3)}`;

describe("regras puras do formulário", () => {
  it("exige nome e aceita o resto vazio como ausente", () => {
    expect(parseOwnProfile({ name: "  " })).toEqual({ ok: false, code: "nameRequired" });
    expect(parseOwnProfile({ name: " Maria ", headline: " ", location: "", cv: "" })).toEqual({
      ok: true,
      value: { name: "Maria", headline: null, location: null, cv: null },
    });
  });

  it("recusa em vez de truncar", () => {
    expect(parseOwnProfile({ name: "x".repeat(121) })).toEqual({ ok: false, code: "nameTooLong" });
    expect(parseOwnProfile({ name: "M", headline: "x".repeat(201) })).toEqual({ ok: false, code: "headlineTooLong" });
    expect(parseOwnProfile({ name: "M", location: "x".repeat(121) })).toEqual({ ok: false, code: "locationTooLong" });
    expect(parseOwnProfile({ name: "M", cv: "x".repeat(CV_MIN - 1) })).toEqual({ ok: false, code: "cvTooShort" });
  });

  it("deriva o slug do nome, sem acento, e nunca um reservado", () => {
    expect(slugBaseFromName("João da Silva Araújo")).toBe("joao-da-silva-araujo");
    expect(slugBaseFromName("Default")).toBe("default-perfil");
    expect(slugBaseFromName("Admin")).toBe("admin-perfil");
    expect(slugBaseFromName("李小龙")).toBe("perfil");
    expect(slugBaseFromName("A".repeat(80)).length).toBeLessThanOrEqual(36);
    expect(slugAttempt("maria", 1)).toBe("maria");
    expect(slugAttempt("maria", 3)).toBe("maria-3");
  });
});

describe("createOwnCandidate", () => {
  it("cria um candidato novo, privado, ligado só à própria conta", async () => {
    const userId = await account("maria@local.test");
    const result = await createOwnCandidate(sessionOf(userId), {
      name: "Maria Souza",
      headline: "Data Engineer",
      location: "Recife, Brasil",
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    const row = await getCandidate(result.slug);
    expect(row).toMatchObject({
      id: result.candidateId,
      slug: "maria-souza",
      name: "Maria Souza",
      headline: "Data Engineer",
      location: "Recife, Brasil",
      visibility: "private",
      publicCv: false,
      isDefault: false,
    });
    expect((await reloaded(userId)).candidateId).toBe(result.candidateId);
  });

  it("nunca reaproveita candidato existente, nem com o mesmo slug", async () => {
    const [other] = await db
      .insert(candidate)
      .values({ slug: "maria-souza", name: "Outra Maria" })
      .returning({ id: candidate.id });
    const userId = await account("maria@local.test");

    const result = await createOwnCandidate(sessionOf(userId), { name: "Maria Souza", headline: null, location: null });

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.candidateId).not.toBe(other!.id);
    expect(result.slug).toBe("maria-souza-2");
    expect((await getCandidate("maria-souza"))?.name).toBe("Outra Maria");
  });

  it("duplo envio concorrente cria UM candidato só", async () => {
    const userId = await account("maria@local.test");
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createOwnCandidate(sessionOf(userId), { name: "Maria Souza", headline: null, location: null }),
      ),
    );

    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    const ids = new Set(results.map((r) => ("candidateId" in r ? r.candidateId : null)));
    expect(ids.size).toBe(1);
    expect(await db.select().from(candidate)).toHaveLength(1);
  });

  it("duas contas de mesmo nome ao mesmo tempo ganham slugs distintos", async () => {
    const a = await account("a@local.test");
    const b = await account("b@local.test");
    const [ra, rb] = await Promise.all([
      createOwnCandidate(sessionOf(a), { name: "Ana Lima", headline: null, location: null }),
      createOwnCandidate(sessionOf(b), { name: "Ana Lima", headline: null, location: null }),
    ]);

    expect(ra.status).toBe("created");
    expect(rb.status).toBe("created");
    if (ra.status !== "created" || rb.status !== "created") return;
    expect(ra.candidateId).not.toBe(rb.candidateId);
    expect(new Set([ra.slug, rb.slug])).toEqual(new Set(["ana-lima", "ana-lima-2"]));
  });

  it("conta que já tem candidato não ganha outro", async () => {
    const userId = await account("maria@local.test");
    const first = await createOwnCandidate(sessionOf(userId), { name: "Maria", headline: null, location: null });
    const again = await createOwnCandidate(sessionOf(userId), { name: "Outro Nome", headline: null, location: null });

    expect(again).toEqual({ status: "existing", candidateId: "candidateId" in first ? first.candidateId : -1 });
    expect(await db.select().from(candidate)).toHaveLength(1);
  });

  it("conta desabilitada ou inexistente não cria nada", async () => {
    const userId = await account("maria@local.test");
    await setUserDisabled(userId, true);

    expect(await createOwnCandidate(sessionOf(userId), { name: "M", headline: null, location: null })).toEqual({
      status: "no-account",
    });
    expect(await createOwnCandidate(sessionOf(9999), { name: "M", headline: null, location: null })).toEqual({
      status: "no-account",
    });
    expect(await db.select().from(candidate)).toHaveLength(0);
  });
});

describe("createProfileAction", () => {
  it("nega quem não pode criar, antes de qualquer efeito", async () => {
    const userId = await account("maria@local.test");
    const denied: Array<Session | null> = [
      null,
      sessionOf(userId, { roles: ["recruiter"] }),
      sessionOf(userId, { roles: ["admin"] }),
      sessionOf(userId, { impersonatedBy: 42 }),
    ];
    for (const session of denied) {
      state.session = session;
      await expect(createProfileAction(form({ name: "Maria" }))).rejects.toThrow(/negado/);
    }
    expect(await db.select().from(candidate)).toHaveLength(0);
  });

  it("identidade vem do formulário, nunca do profile.yaml do dono", async () => {
    const ownerId = await syncCandidateFromProfile();
    const owner = await loadProfile(true);
    const userId = await account("maria@local.test");
    state.session = sessionOf(userId);

    expect(await createProfileAction(form({ name: "Maria Souza", headline: "", location: "", cv: CV }))).toEqual({
      ok: true,
    });

    const mine = await reloaded(userId);
    expect(mine.candidateId).not.toBe(ownerId);
    const [row] = await db.select().from(candidate).where(eq(candidate.id, mine.candidateId!));
    expect(row).toMatchObject({ name: "Maria Souza", headline: null, location: null, email: null, isDefault: false });
    expect(row!.name).not.toBe(owner.identity.name);
    expect((await currentDocument(mine.candidateId!))?.content).toBe(CV.trim());
    // O dono continua com o próprio candidato e o próprio slug.
    expect((await getCandidate())?.id).toBe(ownerId);
  });

  it("recusa com código traduzível e não cria nada", async () => {
    state.session = sessionOf(await account("maria@local.test"));
    expect(await createProfileAction(form({ name: "Maria", cv: "curto" }))).toEqual({ ok: false, code: "cvTooShort" });
    expect(await createProfileAction(form({ name: " " }))).toEqual({ ok: false, code: "nameRequired" });
    expect(await db.select().from(candidate)).toHaveLength(0);
  });

  it("duplo envio grava um candidato e um currículo", async () => {
    const userId = await account("maria@local.test");
    state.session = sessionOf(userId);
    await Promise.all([
      createProfileAction(form({ name: "Maria", cv: CV })),
      createProfileAction(form({ name: "Maria", cv: CV })),
    ]);
    const mine = await reloaded(userId);
    expect(await db.select().from(candidate)).toHaveLength(1);
    expect((await currentDocument(mine.candidateId!))?.content).toBe(CV.trim());
  });
});

describe("isolamento depois de criar", () => {
  it("conta A nunca lê nem escreve o candidato de B; o dono segue vendo o próprio", async () => {
    const ownerCandidate = await syncCandidateFromProfile();
    const a = await account("a@local.test");
    const b = await account("b@local.test");
    await createOwnCandidate(sessionOf(a), { name: "Ana", headline: null, location: null });
    await createOwnCandidate(sessionOf(b), { name: "Bia", headline: null, location: null });

    const sa = await reloaded(a);
    const sb = await reloaded(b);
    const ownerSession = sessionOf(1000, { candidateId: ownerCandidate });
    const ofB = { kind: "candidate" as const, candidateId: candidateScope(sb)! };
    const ofOwner = { kind: "candidate" as const, candidateId: ownerCandidate };

    expect(candidateScope(sa)).not.toBe(candidateScope(sb));
    for (const action of ["candidate:read", "candidate:write", "application:write"] as const) {
      expect(can(sa, action, ofB).allowed).toBe(false);
      expect(can(sa, action, ofOwner).allowed).toBe(false);
      expect(can(ownerSession, action, ofOwner).allowed).toBe(true);
    }
    // E, com candidato, a conta não cria o segundo.
    expect(() => authorize(sa, "candidate:create")).toThrow(/negado/);
  });
});
