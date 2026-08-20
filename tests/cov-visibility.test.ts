import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate } from "../src/core/db/schema.ts";
import { ensureCandidate, getCandidateById, setVisibility } from "../src/core/candidate.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Visibilidade do perfil.
 *
 * A coluna decide se um currículo é legível pela internet inteira, e o valor
 * chega de um formulário. É exatamente a combinação que exige validação no
 * domínio e não só no componente.
 */

let db: DB;
let candidateId: number;

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({ name: "Andreus Timm" });
});

afterEach(() => {
  releaseTestDb();
});

describe("setVisibility", () => {
  it("nasce privado", async () => {
    // O padrão é a decisão de segurança: "esqueci de configurar" não pode
    // significar "currículo publicado".
    expect((await getCandidateById(candidateId))?.visibility).toBe("private");
  });

  it("aceita os três valores conhecidos", async () => {
    for (const value of ["recruiters", "public", "private"] as const) {
      expect(await setVisibility(candidateId, value)).toEqual({ ok: true, visibility: value });
      expect((await getCandidateById(candidateId))?.visibility).toBe(value);
    }
  });

  it("recusa valor desconhecido SEM gravar", async () => {
    await setVisibility(candidateId, "public");

    // "publico" com erro de grafia deixaria a coluna num estado que nenhum ramo
    // da política reconhece. O padrão de negar salvaria por acaso, não por
    // desenho — e o usuário acharia que mudou algo.
    for (const bad of ["publico", "PUBLIC", "", "todos", "true"]) {
      expect(await setVisibility(candidateId, bad)).toEqual({ ok: false, error: "invalid" });
    }

    expect((await getCandidateById(candidateId))?.visibility).toBe("public");
  });

  it("não toca em outro candidato", async () => {
    const outro = await ensureCandidate({ slug: "outro", name: "Outra Pessoa" });
    await setVisibility(candidateId, "public");

    expect((await getCandidateById(outro))?.visibility).toBe("private");
    const rows = await db.select().from(candidate).where(eq(candidate.visibility, "public"));
    expect(rows).toHaveLength(1);
  });
});
