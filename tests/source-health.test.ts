/**
 * A saúde das fontes é lida por duas superfícies, e precisa dizer o mesmo.
 *
 * `jho sources list` e a tela de operações do administrador leem deste módulo,
 * e não cada uma da sua consulta — duplicar a query é exatamente como as duas
 * começam a discordar sobre o que é "fonte quebrada".
 *
 * A configuração manda: uma fonte cadastrada em `config/sources.yaml` que nunca
 * sincronizou aparece como `never`, e não some da lista. Uma linha no banco sem
 * configuração correspondente não inventa uma fonte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { source } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

vi.mock("../src/core/sources/config.ts", () => ({
  loadSources: async () => [
    { kind: "lever", handle: "acme", label: "Acme" },
    { kind: "ashby", handle: "globex", label: "Globex" },
    { kind: "greenhouse", handle: "initech", label: "Initech" },
  ],
}));

const { sourceHealth, sourceHealthSummary } = await import("../src/core/ingest/health.ts");

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function seedFonte(
  id: string,
  extra: Partial<typeof source.$inferInsert> = {},
): Promise<void> {
  const [kind, handle] = id.split(":");
  await db
    .insert(source)
    .values({ id, kind: kind!, handle: handle!, label: id, ...extra })
    .onConflictDoNothing();
}

describe("saúde das fontes", () => {
  it("UT-097 fonte configurada que nunca sincronizou aparece como `never`", async () => {
    await seedFonte("lever:acme", { lastStatus: "ok", lastSyncedAt: "2026-09-20T10:00:00.000Z", lastJobCount: 42 });

    const fontes = await sourceHealth();

    // As três da configuração aparecem, mesmo as que o banco não conhece:
    // sumir da lista é como uma fonte quebrada vira uma fonte esquecida.
    expect(fontes.map((f) => f.id)).toEqual(["lever:acme", "ashby:globex", "greenhouse:initech"]);
    expect(fontes[0]).toMatchObject({ status: "ok", lastJobCount: 42, label: "Acme" });
    expect(fontes[1]).toMatchObject({ status: "never", lastSyncedAt: null, lastJobCount: null });
  });

  it("UT-098 o rótulo vem da configuração, não da linha do banco", async () => {
    await seedFonte("lever:acme", { label: "rótulo velho do banco", lastStatus: "ok" });

    const [primeira] = await sourceHealth();

    // A configuração é a fonte da verdade; o banco é o que aconteceu com ela.
    expect(primeira!.label).toBe("Acme");
  });

  it("UT-099 status desconhecido no banco não vira `ok` por engano", async () => {
    await seedFonte("lever:acme", { lastStatus: "pendente" });
    await seedFonte("ashby:globex", { lastStatus: "error", lastError: "403 do provedor" });

    const fontes = await sourceHealth();

    expect(fontes[0]!.status).toBe("never");
    expect(fontes[1]).toMatchObject({ status: "error", lastError: "403 do provedor" });
  });

  it("UT-100 o resumo conta por estado e devolve só as quebradas", async () => {
    await seedFonte("lever:acme", { lastStatus: "ok", lastSyncedAt: "2026-09-19T08:00:00.000Z" });
    await seedFonte("ashby:globex", { lastStatus: "error", lastError: "timeout", lastSyncedAt: "2026-09-20T23:00:00.000Z" });

    const resumo = await sourceHealthSummary();

    expect(resumo).toMatchObject({ total: 3, ok: 1, error: 1, never: 1 });
    // A varredura mais recente entre todas é a idade do acervo, e comparação
    // de texto ISO é comparação de instante.
    expect(resumo.lastSyncedAt).toBe("2026-09-20T23:00:00.000Z");
    expect(resumo.broken.map((f) => f.id)).toEqual(["ashby:globex"]);
  });

  it("UT-101 sem nenhuma sincronização, a idade do acervo é nula em vez de inventada", async () => {
    const resumo = await sourceHealthSummary();

    expect(resumo).toMatchObject({ total: 3, ok: 0, error: 0, never: 3, lastSyncedAt: null });
    expect(resumo.broken).toEqual([]);
  });
});
