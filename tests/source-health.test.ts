/**
 * A saúde das fontes é lida por duas superfícies, e precisa dizer o mesmo.
 *
 * `jho sources list` e a tela de operações do administrador leem deste módulo,
 * e não cada uma da sua consulta — duplicar a query é exatamente como as duas
 * começam a discordar sobre o que é "fonte quebrada".
 *
 * Para linha não gerida, a configuração manda: uma fonte cadastrada em
 * `config/sources.yaml` que nunca sincronizou aparece como `never`, e não some
 * da lista; uma linha no banco sem configuração correspondente não inventa uma
 * fonte. Linha gerida (#223) segue o banco, igual ao sync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { source } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

vi.mock("../src/core/sources/config.ts", () => ({
  loadSources: async () => [
    { kind: "lever", handle: "acme", label: "Acme", enabled: true },
    { kind: "ashby", handle: "globex", label: "Globex", enabled: true },
    { kind: "greenhouse", handle: "initech", label: "Initech", enabled: true },
    { kind: "greenhouse", handle: "desligada", label: "Desligada no arquivo", enabled: false },
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
  it("UT-102 linha no banco sem configuração NÃO inventa uma fonte", async () => {
    // A invariante que o cabeçalho deste arquivo declara e nenhum caso exercitava.
    // A configuração enumera; o banco só decora. Uma fonte removida do
    // `sources.yaml` deixa a linha para trás — e ela não pode reaparecer na lista
    // como se ainda fosse buscada, porque aí a tela mostra saúde de algo que
    // ninguém sincroniza e o operador espera dado que nunca vem.
    await seedFonte("lever:acme", { lastStatus: "ok" });
    await seedFonte("workable:removida", { lastStatus: "ok", lastJobCount: 900 });

    const fontes = await sourceHealth();

    expect(fontes.map((f) => f.id)).toEqual(["lever:acme", "ashby:globex", "greenhouse:initech"]);
    expect(fontes.some((f) => f.id === "workable:removida")).toBe(false);

    // E o resumo conta só as três configuradas: o total é o da configuração.
    const resumo = await sourceHealthSummary();
    expect(resumo.total).toBe(3);
  });

  it("UT-103 a configuração define a ORDEM, e o banco não a reordena", async () => {
    // As três saem na ordem do `sources.yaml`, não na ordem em que o banco as
    // devolveu. Sem isso, a lista da CLI mudaria de posição entre execuções
    // conforme o plano de consulta, e `jho sources list` deixaria de ser
    // comparável com a execução anterior.
    //
    // Semeadas em ordem invertida de propósito.
    await seedFonte("greenhouse:initech", { lastStatus: "error", lastError: "500" });
    await seedFonte("ashby:globex", { lastStatus: "ok" });
    await seedFonte("lever:acme", { lastStatus: "ok" });

    const fontes = await sourceHealth();

    expect(fontes.map((f) => f.id)).toEqual(["lever:acme", "ashby:globex", "greenhouse:initech"]);
  });

  it("linha gerida segue o banco, como o sync: aparece se ele a varre e some se não", async () => {
    const gerida = "2026-09-23T12:00:00.000Z";
    // Desligada no banco, mas habilitada no arquivo: o sync não a varre.
    await seedFonte("lever:acme", { managedAt: gerida, enabled: false, lastStatus: "ok" });
    // Fora do arquivo, mas gerida e habilitada: o sync ainda a varre.
    await seedFonte("workable:gerida", { managedAt: gerida, enabled: true, label: "Do banco", lastStatus: "error" });
    // Desligada no arquivo, gerida e habilitada no banco: idem.
    await seedFonte("greenhouse:desligada", { managedAt: gerida, enabled: true, lastStatus: "ok" });
    // Aposentada não é varrida, mesmo gerida e habilitada.
    await seedFonte("ashby:velha", { managedAt: gerida, enabled: true, retiredAt: gerida });

    const fontes = await sourceHealth();

    expect(fontes.map((f) => f.id)).toEqual([
      "ashby:globex",
      "greenhouse:initech",
      "workable:gerida",
      "greenhouse:desligada",
    ]);
    expect(fontes.find((f) => f.id === "workable:gerida")).toMatchObject({ label: "Do banco", status: "error" });
    expect((await sourceHealthSummary()).broken.map((f) => f.id)).toEqual(["workable:gerida"]);
  });
});

/**
 * As duas superfícies leem deste módulo — verificado sobre o código, não sobre o
 * comportamento.
 *
 * A invariante do cabeçalho é de ARQUITETURA: `jho sources list` e a tela de
 * operações não podem montar consulta própria sobre `source`, senão as duas
 * começam a discordar sobre o que é "fonte quebrada" e nenhum teste de
 * comportamento vê, porque cada uma passa sozinha.
 */
describe("quem lê saúde de fonte", () => {
  // `fileURLToPath`, e não `.pathname`: o caminho deste repositório contém um
  // espaço ("Obsidian Vault"), e `.pathname` o devolve como `%20`.
  const RAIZ = fileURLToPath(new URL("..", import.meta.url));

  /** Os leitores conhecidos, um por superfície. */
  const LEITORES = ["src/cli.ts", "app/admin/operacoes/page.tsx"];

  it("UT-104 os dois leitores importam do módulo de saúde", async () => {
    const { readFile } = await import("node:fs/promises");

    for (const caminho of LEITORES) {
      const fonte = await readFile(`${RAIZ}${caminho}`, "utf8");
      // Import estático ou dinâmico: os dois valem, o que não vale é consulta
      // própria.
      expect(fonte, caminho).toMatch(/ingest\/health\.ts/);
    }
  });

  it("UT-105 nenhum leitor sequer importa a tabela `source`", async () => {
    const { readFile } = await import("node:fs/promises");

    for (const caminho of LEITORES) {
      const fonte = await readFile(`${RAIZ}${caminho}`, "utf8");

      // A asserção é sobre o IMPORT, e não sobre a forma da consulta. Proibir
      // `.from(source)` deixaria passar um `select({...}).from(sql\`source\`)`, um
      // `db.execute`, ou um join — e um leitor que precise da tabela tem de
      // importá-la antes de qualquer uma dessas formas. Cortar na importação é a
      // linha mais estreita que cobre todas.
      //
      // `src/cli.ts` importava `source` e não a usava: nas linhas 698-699 o nome
      // é parâmetro de callback e sombreava o import. Ele saiu no mesmo commit
      // que este caso, e é por isso que a asserção passou a ser possível.
      const importaSchema = [...fonte.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*db\/schema\.ts["']/g)];
      for (const casado of importaSchema) {
        const dentro = casado[1] ?? "";
        const nomes = dentro
          .split(",")
          .map((parte) => parte.replace(/^\s*type\s+/, "").trim())
          .filter((parte) => parte.length > 0);
        expect(nomes, `${caminho}: ${dentro.trim()}`).not.toContain("source");
      }

      // Guarda contra a regex não encontrar nada e o caso passar vazio: a CLI
      // importa do schema, então pelo menos um bloco tem de ter casado ali.
      if (caminho === "src/cli.ts") expect(importaSchema.length).toBeGreaterThan(0);
    }
  });
});
