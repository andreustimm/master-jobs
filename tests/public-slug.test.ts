import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnCandidate, createUser, type Session } from "../src/contexts/auth/index.ts";
import {
  ensureCandidate,
  getCandidate,
  getCandidateById,
  setPublicSlug,
  setVisibility,
  syncCandidateFromProfile,
} from "../src/core/candidate.ts";
import { RESERVED_SLUGS, SLUG_MAX, validatePublicSlug } from "../src/core/candidate-identity.ts";
import { publicProfile } from "../src/core/candidate-public.ts";
import type { DB } from "../src/core/db/client.ts";
import { candidate } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Endereço público escolhido pelo candidato (#235).
 *
 * `/p/<public_slug>` e não `/p/<slug>`: o identificador interno fica onde a CLI
 * e o seed o procuram, e o endereço muda quando a pessoa quiser. Trocar faz o
 * antigo responder 404 na hora (ADR 0024), e perfil não público continua 404
 * em qualquer endereço.
 */
const state = vi.hoisted(() => ({ candidateId: null as number | null }));

vi.mock("../app/auth", () => ({
  guard: async () => {
    throw new Error("não usado aqui");
  },
  guardOwnCandidate: async () => {
    if (state.candidateId === null) throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
    return { session: {}, candidateId: state.candidateId };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { setPublicSlugAction } = await import("../app/candidate/actions.ts");

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  state.candidateId = null;
});

afterEach(async () => {
  await releaseTestDb();
});

function form(publicSlug: string): FormData {
  const data = new FormData();
  data.set("publicSlug", publicSlug);
  return data;
}

async function person(slug: string): Promise<number> {
  const id = await ensureCandidate({ slug, name: slug });
  await setVisibility(id, "public");
  return id;
}

describe("validatePublicSlug", () => {
  it("aceita minúsculas, números e hífen entre eles, e rebaixa maiúsculas", () => {
    expect(validatePublicSlug("maria-souza-2")).toEqual({ ok: true, slug: "maria-souza-2" });
    expect(validatePublicSlug("  Maria-Souza ")).toEqual({ ok: true, slug: "maria-souza" });
  });

  it("recusa forma inválida, tamanho e reservado", () => {
    for (const bad of ["maria souza", "maria_souza", "-maria", "maria-", "maria--souza", "joão", "a/b", "maria.souza"]) {
      expect(validatePublicSlug(bad), bad).toEqual({ ok: false, code: "slugInvalid" });
    }
    expect(validatePublicSlug("ab")).toEqual({ ok: false, code: "slugTooShort" });
    expect(validatePublicSlug("a".repeat(SLUG_MAX + 1))).toEqual({ ok: false, code: "slugTooLong" });
    for (const reserved of ["default", "admin", "login", "api", "p", "user-maria-x-com", "e2e-alvo"]) {
      expect(validatePublicSlug(reserved), reserved).toMatchObject({ ok: false });
    }
    expect(validatePublicSlug("default")).toEqual({ ok: false, code: "slugReserved" });
  });

  it("reserva toda rota de primeiro nível do app", () => {
    // Rota nova em `app/` sem entrar na lista deixaria alguém escolher um
    // endereço com o nome dela — `/p/<rota>` se passando pelo sistema.
    const routes = readdirSync("app").filter(
      (entry) => statSync(join("app", entry)).isDirectory() && !entry.startsWith("(") && !entry.startsWith("["),
    );
    expect(routes.length).toBeGreaterThan(5);
    expect(routes.filter((route) => !RESERVED_SLUGS.has(route))).toEqual([]);
  });
});

describe("setPublicSlug", () => {
  it("troca o endereço: o novo responde, o antigo dá 404, o identificador fica", async () => {
    const id = await person("maria");
    expect(await setPublicSlug(id, "maria-souza")).toEqual({ ok: true, slug: "maria-souza" });

    expect((await publicProfile("maria-souza"))?.slug).toBe("maria-souza");
    expect(await publicProfile("maria")).toBeNull();
    // `slug` interno intacto: a CLI e o seed continuam achando a mesma linha.
    expect((await getCandidateById(id))?.slug).toBe("maria");
  });

  it("o dono troca o endereço sem perder o candidato `default`", async () => {
    const owner = await syncCandidateFromProfile();
    await setVisibility(owner, "public");
    expect(await setPublicSlug(owner, "andreus-timm")).toMatchObject({ ok: true });

    expect(await publicProfile("default")).toBeNull();
    expect((await publicProfile("andreus-timm"))?.slug).toBe("andreus-timm");
    expect((await getCandidate())?.id).toBe(owner);
    // O próximo seed acha o mesmo dono, em vez de criar um segundo.
    expect(await syncCandidateFromProfile()).toBe(owner);
    expect(await db.select().from(candidate)).toHaveLength(1);
  });

  it("perfil não público responde 404 em qualquer endereço", async () => {
    const id = await person("maria");
    await setPublicSlug(id, "maria-souza");
    for (const visibility of ["private", "recruiters"] as const) {
      await setVisibility(id, visibility);
      expect(await publicProfile("maria-souza")).toBeNull();
      expect(await publicProfile("maria")).toBeNull();
    }
  });

  it("recusa endereço de outra pessoa, e o dela continua dela", async () => {
    const a = await person("ana");
    const b = await person("bia");
    expect(await setPublicSlug(b, "ana")).toEqual({ ok: false, code: "slugTaken" });
    expect((await getCandidateById(b))?.publicSlug).toBe("bia");
    expect((await publicProfile("ana"))?.name).toBe("ana");
    expect((await getCandidateById(a))?.publicSlug).toBe("ana");
  });

  it("recusa reservado e inválido sem gravar", async () => {
    const id = await person("maria");
    expect(await setPublicSlug(id, "admin")).toEqual({ ok: false, code: "slugReserved" });
    expect(await setPublicSlug(id, "Maria Souza")).toEqual({ ok: false, code: "slugInvalid" });
    expect((await getCandidateById(id))?.publicSlug).toBe("maria");
  });

  it("colisão concorrente: um leva, o outro recebe slugTaken", async () => {
    const a = await person("ana");
    const b = await person("bia");
    const results = await Promise.all([setPublicSlug(a, "disputado"), setPublicSlug(b, "disputado")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "slugTaken" }]);
  });

  it("endereço solto por uma troca fica livre para outra pessoa", async () => {
    const a = await person("ana");
    const b = await person("bia");
    await setPublicSlug(a, "ana-lima");
    expect(await setPublicSlug(b, "ana")).toEqual({ ok: true, slug: "ana" });
    expect((await publicProfile("ana"))?.name).toBe("bia");
  });
});

describe("setPublicSlugAction", () => {
  it("vale só para o candidato da sessão", async () => {
    const id = await person("maria");
    state.candidateId = id;
    expect(await setPublicSlugAction(form("maria-souza"))).toEqual({ ok: true });
    expect((await getCandidateById(id))?.publicSlug).toBe("maria-souza");

    state.candidateId = null;
    await expect(setPublicSlugAction(form("outro"))).rejects.toThrow(/403/);
    expect((await getCandidateById(id))?.publicSlug).toBe("maria-souza");
  });

  it("devolve o código da recusa para a tela traduzir", async () => {
    state.candidateId = await person("maria");
    await person("ana");
    expect(await setPublicSlugAction(form("ana"))).toEqual({ ok: false, code: "slugTaken" });
    expect(await setPublicSlugAction(form("x"))).toEqual({ ok: false, code: "slugTooShort" });
  });
});

describe("onboarding com endereço escolhido", () => {
  const session = (userId: number): Session => ({
    userId,
    candidateId: null,
    roles: ["candidate"],
    email: `${userId}@local.test`,
    fullName: null,
    expiresAt: "2999-01-01T00:00:00.000Z",
    linkedCandidateIds: [],
    impersonatedBy: null,
  });
  const input = (publicSlug: string | null) => ({
    name: "Maria Souza",
    headline: null,
    location: null,
    cv: null,
    cvLabel: "CV",
    publicSlug,
  });

  it("usa o endereço escolhido nos dois campos", async () => {
    const { id } = await createUser({ email: "m@local.test", roles: ["candidate"] });
    const result = await createOwnCandidate(session(id), input("mariasouza"));
    expect(result).toMatchObject({ status: "created", slug: "mariasouza" });
    const row = await getCandidate("mariasouza");
    expect(row).toMatchObject({ publicSlug: "mariasouza", visibility: "private" });
  });

  it("endereço já em uso não cria nada e não põe sufixo em silêncio", async () => {
    await person("mariasouza");
    const { id } = await createUser({ email: "m@local.test", roles: ["candidate"] });
    expect(await createOwnCandidate(session(id), input("mariasouza"))).toEqual({ status: "slug-taken" });
    expect(await db.select().from(candidate)).toHaveLength(1);
  });

  it("endereço liberado por uma troca serve à conta nova, mesmo sendo slug interno de alguém", async () => {
    const other = await person("maria-souza");
    await setPublicSlug(other, "outra-maria");
    const { id } = await createUser({ email: "m@local.test", roles: ["candidate"] });
    const result = await createOwnCandidate(session(id), input("maria-souza"));
    expect(result).toMatchObject({ status: "created" });
    if (result.status !== "created") return;
    const mine = await getCandidateById(result.candidateId);
    expect(mine?.publicSlug).toBe("maria-souza");
    // O identificador interno não pode repetir o de outra pessoa.
    expect(mine?.slug).not.toBe("maria-souza");
    expect((await getCandidateById(other))?.slug).toBe("maria-souza");
  });

  it("endereço público escolhido por outra pessoa também conta como ocupado", async () => {
    const other = await person("ana");
    await setPublicSlug(other, "maria-souza");
    const { id } = await createUser({ email: "m@local.test", roles: ["candidate"] });
    expect(await createOwnCandidate(session(id), input("maria-souza"))).toEqual({ status: "slug-taken" });
    // Sem escolha, a derivação do nome também pula o endereço ocupado.
    expect(await createOwnCandidate(session(id), input(null))).toMatchObject({ status: "created", slug: "maria-souza-2" });
  });
});

describe("endereço derivado do e-mail nunca é publicado", () => {
  it("conta criada pelo admin nasce sem endereço público", async () => {
    const id = await ensureCandidate({ slug: "user-maria-x-com", name: "Maria" });
    await setVisibility(id, "public");
    expect((await getCandidateById(id))?.publicSlug).toBeNull();
    expect(await publicProfile("user-maria-x-com")).toBeNull();
  });
});

describe("migração 0010: backfill do endereço público", () => {
  it("copia `slug` para quem ainda não tem endereço, e só para esses", async () => {
    await db.insert(candidate).values([
      { slug: "legado", name: "Legado" },
      { slug: "ja-tem", name: "Já tem", publicSlug: "escolhido" },
      { slug: "user-maria-x-com", name: "Pelo admin" },
    ]);
    const backfill = readFileSync("drizzle/postgres/0010_backfill_candidate_public_slug.sql", "utf8");
    await db.execute(sql.raw(backfill));
    await db.execute(sql.raw(backfill));

    const rows = await db.select({ slug: candidate.slug, publicSlug: candidate.publicSlug }).from(candidate);
    expect(rows).toEqual(
      expect.arrayContaining([
        { slug: "legado", publicSlug: "legado" },
        { slug: "ja-tem", publicSlug: "escolhido" },
        // O e-mail não vira endereço: fica sem, até a pessoa escolher.
        { slug: "user-maria-x-com", publicSlug: null },
      ]),
    );
  });
});
