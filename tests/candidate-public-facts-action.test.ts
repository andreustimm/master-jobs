import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createUser } from "../src/contexts/auth/index.ts";
import { ensureCandidate, getCandidateById } from "../src/core/candidate.ts";
import { getDb } from "../src/core/db/client.ts";
import { authUser } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * `setPublicFactsAction` (#327): o candidato vem da sessão, e a guarda vem
 * antes de ler o formulário (regra 15). A varredura de `entry-denial.test.ts`
 * cobre sessão inválida e id forjado em toda action; aqui fica o contrato de
 * gravação e de recusa por código.
 */
const state = vi.hoisted(() => ({ candidateId: null as number | null, guarded: 0 }));

vi.mock("../app/auth", () => ({
  guard: async () => {
    throw new Error("não usado aqui");
  },
  guardOwnCandidate: async () => {
    state.guarded += 1;
    if (state.candidateId === null) throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
    return { session: {}, candidateId: state.candidateId };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { setPublicFactsAction } = await import("../app/candidate/actions.ts");

beforeEach(async () => {
  await useTestDb();
  state.candidateId = null;
  state.guarded = 0;
});

afterEach(async () => {
  await releaseTestDb();
});

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

describe("setPublicFactsAction", () => {
  it("T17 grava no candidato da sessão, com o opt-in só onde marcado", async () => {
    const id = await ensureCandidate({ slug: "maria", name: "Maria" });
    // Um id no formulário é pedido, não prova: fica ignorado.
    const other = await ensureCandidate({ slug: "ana", name: "Ana" });
    state.candidateId = id;

    const result = await setPublicFactsAction(
      form({
        candidateId: String(other),
        workModel: ["remote", "b2b"],
        experienceLevel: "senior",
        availability: "open",
        startTimeframe: "one-month",
        openToRelocation: "no",
        area: "Engenharia de dados",
        languages: "Inglês C1",
        "show-workModel": "on",
        "show-languages": "on",
      }),
    );
    expect(result).toEqual({ ok: true });

    expect(await getCandidateById(id)).toMatchObject({
      workModel: ["remote", "b2b"],
      experienceLevel: "senior",
      availability: "open",
      startTimeframe: "one-month",
      openToRelocation: false,
      area: "Engenharia de dados",
      languages: "Inglês C1",
      publicWorkModel: true,
      publicExperienceLevel: false,
      publicAvailability: false,
      publicStartTimeframe: false,
      publicRelocation: false,
      publicArea: false,
      publicLanguages: true,
    });
    expect(await getCandidateById(other)).toMatchObject({ workModel: null, publicWorkModel: false });
  });

  it("T17 sem sessão própria, 403 antes de gravar", async () => {
    const id = await ensureCandidate({ slug: "maria", name: "Maria" });
    await expect(setPublicFactsAction(form({ area: "IA", "show-area": "on" }))).rejects.toThrow(/403/);
    expect(state.guarded).toBe(1);
    expect(await getCandidateById(id)).toMatchObject({ area: null, publicArea: false });
  });

  it("T17 devolve o código da recusa e não grava nada", async () => {
    const id = await ensureCandidate({ slug: "maria", name: "Maria" });
    state.candidateId = id;
    expect(await setPublicFactsAction(form({ area: "Pretensão: USD 15,000", "show-area": "on" }))).toEqual({
      ok: false,
      code: "areaPay",
    });
    expect(await setPublicFactsAction(form({ languages: "pia@local.test" }))).toEqual({
      ok: false,
      code: "languagesContact",
    });
    expect(await setPublicFactsAction(form({ experienceLevel: "ninja" }))).toEqual({
      ok: false,
      code: "invalidChoice",
    });
    expect(await getCandidateById(id)).toMatchObject({ area: null, publicArea: false, languages: null });
  });

  it("MINOR 3 (revisão L2 #362) recusa o e-mail cadastrado do candidato e o da conta, fora do padrão genérico", async () => {
    const id = await ensureCandidate({ slug: "maria", name: "Maria", email: "maria@intranet" });
    const { id: userId } = await createUser({ email: "conta@intranet", roles: ["candidate"] });
    await getDb().update(authUser).set({ candidateId: id }).where(eq(authUser.id, userId));
    state.candidateId = id;

    expect(await setPublicFactsAction(form({ area: "Dados — maria@intranet" }))).toEqual({
      ok: false,
      code: "areaContact",
    });
    expect(await setPublicFactsAction(form({ languages: "Inglês, conta@intranet" }))).toEqual({
      ok: false,
      code: "languagesContact",
    });
    expect(await getCandidateById(id)).toMatchObject({ area: null, languages: null });
  });
});
