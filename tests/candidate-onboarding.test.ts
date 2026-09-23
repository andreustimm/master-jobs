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
import { CV_PDF_MAX_BYTES } from "../src/core/pdf.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { pdfComTexto } from "./support/synthetic-pdf.ts";

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
// A fatia de repontuação depois da resposta tem teste próprio
// (`tests/score-slice.test.ts`); aqui só não pode estourar fora do Next.
vi.mock("next/server", () => ({ after: () => undefined }));

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

const NO_CV = { cv: null, cvLabel: "CV", publicSlug: null };

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
    expect(slugBaseFromName("Default")).toBe("perfil-default");
    expect(slugBaseFromName("Admin")).toBe("perfil-admin");
    // `user-<e-mail>` é o slug que `createUserAction` monta e `ensureCandidate`
    // reaproveita: ocupá-lo ligaria uma conta futura a este candidato.
    expect(slugBaseFromName("User Maria X Com")).toBe("perfil-user-maria-x-com");
    expect(slugBaseFromName("e2e sem cv")).toBe("perfil-e2e-sem-cv");
    expect(slugBaseFromName("李小龙")).toBe("perfil");
    expect(slugBaseFromName("A".repeat(80)).length).toBeLessThanOrEqual(32);
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
      ...NO_CV,
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

    const result = await createOwnCandidate(sessionOf(userId), { name: "Maria Souza", headline: null, location: null, ...NO_CV });

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
        createOwnCandidate(sessionOf(userId), { name: "Maria Souza", headline: null, location: null, ...NO_CV }),
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
      createOwnCandidate(sessionOf(a), { name: "Ana Lima", headline: null, location: null, ...NO_CV }),
      createOwnCandidate(sessionOf(b), { name: "Ana Lima", headline: null, location: null, ...NO_CV }),
    ]);

    expect(ra.status).toBe("created");
    expect(rb.status).toBe("created");
    if (ra.status !== "created" || rb.status !== "created") return;
    expect(ra.candidateId).not.toBe(rb.candidateId);
    expect(new Set([ra.slug, rb.slug])).toEqual(new Set(["ana-lima", "ana-lima-2"]));
  });

  it("conta que já tem candidato não ganha outro", async () => {
    const userId = await account("maria@local.test");
    const first = await createOwnCandidate(sessionOf(userId), { name: "Maria", headline: null, location: null, ...NO_CV });
    const again = await createOwnCandidate(sessionOf(userId), { name: "Outro Nome", headline: null, location: null, ...NO_CV });

    expect(first.status).toBe("created");
    if (first.status !== "created") return;
    expect(again).toEqual({ status: "existing", candidateId: first.candidateId });
    expect(await db.select().from(candidate)).toHaveLength(1);
  });

  it("nomes sem letra latina não esgotam os sufixos", async () => {
    // Todos caem na base `perfil`; depois dos cinquenta sequenciais, o sufixo
    // aleatório continua achando endereço livre.
    await db.insert(candidate).values(
      Array.from({ length: 50 }, (_, i) => ({ slug: i === 0 ? "perfil" : `perfil-${i + 1}`, name: "x" })),
    );
    const userId = await account("li@local.test");
    const result = await createOwnCandidate(sessionOf(userId), { name: "李小龙", headline: null, location: null, ...NO_CV });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.slug).toMatch(/^perfil-[0-9a-f]{6}$/);
  });

  it("currículo entra no mesmo commit do candidato", async () => {
    const userId = await account("maria@local.test");
    const result = await createOwnCandidate(sessionOf(userId), {
      name: "Maria",
      headline: null,
      location: null,
      cv: CV,
      cvLabel: "CV 2026-09-22",
      publicSlug: null,
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(await currentDocument(result.candidateId)).toMatchObject({ content: CV, label: "CV 2026-09-22", isCurrent: true });
  });

  it("conta desabilitada ou inexistente não cria nada", async () => {
    const userId = await account("maria@local.test");
    await setUserDisabled(userId, true);

    expect(await createOwnCandidate(sessionOf(userId), { name: "M", headline: null, location: null, ...NO_CV })).toEqual({
      status: "no-account",
    });
    expect(await createOwnCandidate(sessionOf(9999), { name: "M", headline: null, location: null, ...NO_CV })).toEqual({
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

describe("createProfileAction com o currículo em PDF (#278)", () => {
  const LINHAS = Array.from(
    { length: 6 },
    (_, i) => `Experiencia ${i}: pipelines de dados, machine learning e observabilidade em nuvem`,
  );

  function withPdf(fields: Record<string, string>, bytes: Uint8Array<ArrayBuffer> | string, name = "Maria Souza CV.pdf"): FormData {
    const data = form(fields);
    data.set("cvFile", new File([bytes], name, { type: "application/pdf" }));
    return data;
  }

  it("PDF válido cria o perfil com o texto extraído, no mesmo commit", async () => {
    const userId = await account("maria@local.test");
    state.session = sessionOf(userId);

    expect(await createProfileAction(withPdf({ name: "Maria Souza" }, pdfComTexto([LINHAS])))).toEqual({
      ok: true,
      run: "fromPdf",
    });

    const mine = await reloaded(userId);
    const doc = await currentDocument(mine.candidateId!);
    expect(doc).toMatchObject({ label: "Maria Souza CV", isCurrent: true });
    expect(doc?.content).toContain("pipelines de dados, machine learning");
  });

  it("PDF inválido, sem texto ou grande demais recusa com código e não cria nada", async () => {
    state.session = sessionOf(await account("maria@local.test"));

    expect(await createProfileAction(withPdf({ name: "Maria" }, "texto renomeado para .pdf"))).toEqual({
      ok: false,
      code: "pdfNotPdf",
    });
    expect(await createProfileAction(withPdf({ name: "Maria" }, pdfComTexto([["Maria"]])))).toEqual({
      ok: false,
      code: "pdfNoText",
    });
    const huge = new Uint8Array(CV_PDF_MAX_BYTES + 1);
    huge.set(new TextEncoder().encode("%PDF-1.4"));
    expect(await createProfileAction(withPdf({ name: "Maria" }, huge))).toEqual({ ok: false, code: "pdfTooLarge" });
    expect(await db.select().from(candidate)).toHaveLength(0);
  });

  it("PDF e texto colado juntos são recusados, sem escolher um em silêncio", async () => {
    state.session = sessionOf(await account("maria@local.test"));
    expect(await createProfileAction(withPdf({ name: "Maria", cv: CV }, pdfComTexto([LINHAS])))).toEqual({
      ok: false,
      code: "cvBoth",
    });
    expect(await db.select().from(candidate)).toHaveLength(0);
  });

  it("campo de arquivo vazio vale como ausente: o texto colado segue sozinho", async () => {
    const userId = await account("maria@local.test");
    state.session = sessionOf(userId);
    expect(await createProfileAction(withPdf({ name: "Maria", cv: CV }, new Uint8Array(), ""))).toEqual({ ok: true });
    expect((await currentDocument((await reloaded(userId)).candidateId!))?.content).toBe(CV.trim());
  });

  it("recusa campo barato antes de gastar a extração", async () => {
    state.session = sessionOf(await account("maria@local.test"));
    // Arquivo que não é PDF: se a extração rodasse antes, o código seria `pdfNotPdf`.
    expect(await createProfileAction(withPdf({ name: " " }, "não é pdf"))).toEqual({ ok: false, code: "nameRequired" });
  });

  it("conta que já tem candidato: a sessão atual é negada, a antiga não grava o PDF em ninguém", async () => {
    const userId = await account("maria@local.test");
    const first = await createOwnCandidate(sessionOf(userId), { name: "Maria", headline: null, location: null, ...NO_CV });
    expect(first.status).toBe("created");
    if (first.status !== "created") return;

    // Sessão atual: já carrega o candidato, e a política nega `candidate:create`.
    state.session = await reloaded(userId);
    await expect(createProfileAction(withPdf({ name: "Outra" }, pdfComTexto([LINHAS])))).rejects.toThrow(/negado/);

    // Sessão resolvida antes da criação: passa na política, mas o vínculo já
    // existe e o PDF não vira currículo de ninguém.
    state.session = sessionOf(userId);
    expect(await createProfileAction(withPdf({ name: "Outra" }, pdfComTexto([LINHAS])))).toEqual({ ok: true });

    const rows = await db.select().from(candidate);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Maria");
    expect(await currentDocument(first.candidateId)).toBeNull();
  });
});

describe("isolamento depois de criar", () => {
  it("conta A nunca lê nem escreve o candidato de B; o dono segue vendo o próprio", async () => {
    const ownerCandidate = await syncCandidateFromProfile();
    const a = await account("a@local.test");
    const b = await account("b@local.test");
    await createOwnCandidate(sessionOf(a), { name: "Ana", headline: null, location: null, ...NO_CV });
    await createOwnCandidate(sessionOf(b), { name: "Bia", headline: null, location: null, ...NO_CV });

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
