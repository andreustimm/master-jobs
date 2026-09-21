/**
 * O que a fila faz quando a pontuação falha.
 *
 * O comentário do código diz a regra e o motivo dela: "esgotadas as tentativas,
 * para de tentar — um currículo que quebra o extrator quebraria de novo, e a
 * fila giraria nele para sempre enquanto os outros candidatos esperam".
 *
 * Esse bloco inteiro estava sem teste. É o caminho que decide se um defeito
 * fica contido numa tarefa ou trava a fila de todo mundo, e ele só existe
 * quando algo dá errado — que é justamente o que nenhum teste de caminho feliz
 * exercita.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, scoreTask } from "../src/core/db/schema.ts";
import { saveDocument } from "../src/core/candidate.ts";
import { seedCatalog } from "../src/contexts/skills/index.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const quebrar = vi.fn();

vi.mock("../src/core/scoring/apply.ts", async (original) => ({
  ...(await original<typeof import("../src/core/scoring/apply.ts")>()),
  scoreAll: (...args: unknown[]) => quebrar(...args),
}));

const { enqueueScore, runScoreQueue, TENTATIVAS_MAX } = await import(
  "../src/core/scoring/queue.ts"
);

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  quebrar.mockReset();
});

afterEach(async () => {
  await releaseTestDb();
  vi.restoreAllMocks();
});

const CURRICULO = [
  "Andreus Timm — Senior AI Software Architect.",
  "Construí plataformas com rag e agentes em produção, com evals e guardrails.",
  "Experiência com typescript, python e postgres em ambientes multi-tenant.",
].join("\n");

/**
 * Candidato com currículo, porque sem ele a fila nem chega a pontuar.
 *
 * Sem perfil próprio a tarefa termina em `sem-curriculo` antes do `try`, e sem
 * catálogo termina em `catalogo-vazio` — nos dois casos o caminho de falha, que
 * é o que estes casos medem, nunca chega a ser alcançado.
 */
async function candidatoComPerfil(slug = "dono"): Promise<number> {
  const [dono] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: slug === "dono" })
    .returning({ id: candidate.id });
  await seedCatalog();
  await saveDocument({ candidateId: dono!.id, label: "cv", content: CURRICULO });
  await db.delete(scoreTask);
  return dono!.id;
}

/** O estado da única tarefa da fila. */
async function tarefa() {
  const [linha] = await db.select().from(scoreTask).limit(1);
  return linha;
}

describe("a fila diante de uma pontuação que falha", () => {
  it("UT-111 devolve a tarefa para a fila e conta a tentativa", async () => {
    const dono = await candidatoComPerfil();
    quebrar.mockRejectedValue(new Error("o extrator caiu"));
    await enqueueScore(dono);

    const resultado = await runScoreQueue({ max: 1 });

    expect(resultado).toMatchObject({ processadas: 1, pontuadas: 0, falhas: 1 });
    const atual = await tarefa();
    // Volta para `pending`: a primeira falha não condena a tarefa.
    expect(atual).toMatchObject({ status: "pending", attempts: 1 });
    expect(atual!.lastError).toContain("o extrator caiu");
    // E solta a reivindicação, senão ninguém mais pega.
    expect(atual!.claimedAt).toBeNull();
    expect(atual!.claimedBy).toBeNull();
  });

  it("UT-112 esgotadas as tentativas, para de tentar em vez de girar para sempre", async () => {
    const dono = await candidatoComPerfil();
    quebrar.mockRejectedValue(new Error("quebra sempre"));
    await enqueueScore(dono);

    for (let volta = 0; volta < TENTATIVAS_MAX; volta += 1) {
      await runScoreQueue({ max: 1 });
    }

    expect(await tarefa()).toMatchObject({ status: "failed", attempts: TENTATIVAS_MAX });
    // Uma volta a mais não reivindica nada: `failed` sai da fila de verdade,
    // e é isso que impede o currículo quebrado de travar os outros.
    expect(await runScoreQueue({ max: 1 })).toMatchObject({ processadas: 0, falhas: 0 });
    expect(quebrar).toHaveBeenCalledTimes(TENTATIVAS_MAX);
  });

  it("UT-113 mensagem enorme é cortada, para o erro não virar o dado", async () => {
    const dono = await candidatoComPerfil();
    quebrar.mockRejectedValue(new Error("x".repeat(2_000)));
    await enqueueScore(dono);

    await runScoreQueue({ max: 1 });

    expect((await tarefa())!.lastError!.length).toBe(500);
  });

  it("UT-114 falha que não é `Error` continua sendo descrita", async () => {
    const dono = await candidatoComPerfil();
    // Uma rejeição com string acontece de verdade — driver e SDK fazem isso —
    // e `[object Object]` no lugar do motivo não diagnostica nada.
    quebrar.mockRejectedValue("recusado pelo banco");
    await enqueueScore(dono);

    await runScoreQueue({ max: 1 });

    expect((await tarefa())!.lastError).toBe("recusado pelo banco");
  });

  it("UT-115 uma tarefa que falha não impede a próxima de rodar", async () => {
    const dono = await candidatoComPerfil();
    const outro = await candidatoComPerfil("outro");
    quebrar.mockRejectedValue(new Error("quebra"));
    await enqueueScore(dono);
    await enqueueScore(outro);

    const resultado = await runScoreQueue({ max: 2 });

    // As duas foram processadas, as duas falharam — e a fila seguiu em frente
    // em vez de parar na primeira.
    expect(resultado).toMatchObject({ processadas: 2, falhas: 2 });
    const linhas = await db.select().from(scoreTask).where(eq(scoreTask.status, "pending"));
    expect(linhas).toHaveLength(2);
  });
});
