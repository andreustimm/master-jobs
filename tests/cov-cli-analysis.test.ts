/**
 * Suíte: `jho analysis queue|run|status` (#223, tarefa 06).
 *
 * O que se defende: `run` é o único caminho que chama o provedor para a análise
 * estruturada, e ele diz o que vai sair antes de mandar, espera confirmação,
 * não reivindica nada sem chave, e não imprime nem texto da vaga nem resposta.
 * Rede: `globalThis.fetch` dublado, provedor compatível apontando para IP literal.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { job, jobAnalysis, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, comStdin, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

const VAR_CHAVE = "JHO_TESTE_ANALISE_KEY";
const CHAVE = "sk-teste-analise-1234567890abcdef";
const DESCRICAO = "Contrato PJ, 100% remoto, só residentes no Brasil. SEGREDO-DO-ANUNCIO";

let chaveOriginal: string | undefined;

beforeAll(async () => {
  chaveOriginal = process.env[VAR_CHAVE];
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
  delete process.env[VAR_CHAVE];
});

afterEach(async () => {
  if (chaveOriginal === undefined) delete process.env[VAR_CHAVE];
  else process.env[VAR_CHAVE] = chaveOriginal;
  vi.unstubAllGlobals();
  await releaseTestDb();
});

async function vaga(): Promise<number> {
  const db = banco();
  await db.insert(source).values({ id: "manual:teste", kind: "manual", handle: "teste", label: "Teste" });
  const [linha] = await db
    .insert(job)
    .values({
      sourceId: "manual:teste",
      companyName: "Acme",
      externalId: "v1",
      title: "Staff Engineer",
      url: "https://exemplo.test/v1",
      descriptionText: DESCRICAO,
      fingerprint: "fp-v1",
      contentHash: "ch-v1",
      raw: {},
    })
    .returning({ id: job.id });
  return linha!.id;
}

async function cadastrarModelo(): Promise<void> {
  await rodar("llm", "add-provider", "teste", "--label", "Provedor de Teste", "--key-env", VAR_CHAVE, "--base-url", "https://93.184.216.34");
  await rodar("llm", "add-model", "teste", "modelo-de-teste", "--label", "Modelo de Teste", "--in-cost", "3", "--out-cost", "15");
}

const RESPOSTA = JSON.stringify({
  fields: {
    employmentType: { value: "PJ", provenance: "explicit", confidence: 0.9, evidence: ["Contrato PJ"] },
    seniority: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
    workModel: { value: "remote", provenance: "normalized", confidence: 0.8, evidence: ["100% remoto"] },
    locationRestriction: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
    timezone: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
    compensation: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
    requiredSkills: { value: null, provenance: "unknown", confidence: 0, evidence: [] },
  },
});

function provedor(chamadas: string[]): typeof fetch {
  return (async (input: string | URL) => {
    chamadas.push(String(input));
    return new Response(
      JSON.stringify({ model: "modelo-de-teste", choices: [{ message: { content: RESPOSTA } }], usage: { prompt_tokens: 900, completion_tokens: 210 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("jho analysis queue", () => {
  it("pede a análise e, repetido, devolve a mesma ativa", async () => {
    const id = await vaga();
    const primeira = await rodar("analysis", "queue", String(id));
    const segunda = await rodar("analysis", "queue", String(id));
    expect(JSON.parse(primeira.out.trim())).toMatchObject({ outcome: "created" });
    expect(JSON.parse(segunda.out.trim())).toMatchObject({ outcome: "active" });
  });

  it("vaga inexistente sai com código 1", async () => {
    const r = await rodar("analysis", "queue", "999999");
    expect(r.code).toBe(1);
    expect(r.err).toContain("não encontrada");
  });

  it("id que não é número é recusado antes do banco", async () => {
    const r = await rodar("analysis", "queue", "abc");
    expect(r.code).toBe(1);
  });
});

describe("jho analysis run", () => {
  it("sem modelo com chave sai com 1 e não reivindica nada", async () => {
    const id = await vaga();
    await rodar("analysis", "queue", String(id));
    await cadastrarModelo();

    const r = await rodar("analysis", "run");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Nenhum modelo");
    const linhas = await banco().select({ status: jobAnalysis.status }).from(jobAnalysis);
    expect(linhas).toEqual([{ status: "queued" }]);
  });

  it("fila vazia não pergunta nem chama nada", async () => {
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", provedor(chamadas));

    const r = await rodar("analysis", "run");

    expect(r.out).toContain("Nenhuma análise na fila");
    expect(chamadas).toEqual([]);
  });

  it("diz o que sai, com chave redigida, e Enter vazio cancela sem enviar", async () => {
    const id = await vaga();
    await rodar("analysis", "queue", String(id));
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", provedor(chamadas));

    const r = await comStdin("\n", () => rodar("analysis", "run"));

    expect(r.out).toContain("Isto vai sair da sua máquina");
    expect(r.out).toContain("NÃO envia: currículo, perfil, funil nem piso salarial");
    expect(r.out).not.toContain(CHAVE);
    expect(r.out).toContain("Cancelado");
    expect(chamadas).toEqual([]);
  });

  it("confirmado, processa e imprime só id e estado", async () => {
    const id = await vaga();
    await rodar("analysis", "queue", String(id));
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", provedor(chamadas));

    const r = await comStdin("s\n", () => rodar("analysis", "run", "--max", "5"));

    expect(chamadas).toHaveLength(1);
    expect(r.out).toContain('"status":"succeeded"');
    expect(r.out).not.toContain("SEGREDO-DO-ANUNCIO");
    expect(r.out).not.toContain("Contrato PJ");

    const status = await rodar("analysis", "status");
    expect(JSON.parse(status.out.trim())).toEqual({ succeeded: 1 });
  });

  it("--yes pula a pergunta", async () => {
    const id = await vaga();
    await rodar("analysis", "queue", String(id));
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    vi.stubGlobal("fetch", provedor([]));

    const r = await rodar("analysis", "run", "--yes");

    expect(r.out).toContain('"status":"succeeded"');
  });
});
