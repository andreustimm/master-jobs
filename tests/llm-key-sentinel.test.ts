/**
 * V03-06 — G41 / regra 16: a chave de API não sai do adapter.
 *
 * Uma chave FICTÍCIA, com valor marcador único, percorre o caminho real do BYOK:
 * cadastro pela CLI (`llm add-provider --key-env`), escolha (`chooseModel`),
 * construção da porta (`portFor`) e o adapter de verdade, que a coloca no
 * cabeçalho. O provedor falso faz o que APIs reais fazem ao recusar uma chave:
 * devolve o valor recebido na mensagem de erro. A partir daí a sentinela não
 * pode aparecer em nenhum observável:
 *
 *  - erro lançado (mensagem, pilha, `String`, JSON);
 *  - evento do Sentry depois da peneira (`scrubEvent`, o `beforeSend` real);
 *  - saída de terminal (`jho analyze`, `jho llm list`, `jho analysis run`);
 *  - qualquer coluna de qualquer tabela do banco;
 *  - o painel da análise que a página da vaga serve, inclusive ao admin.
 *
 * Por que a sentinela NÃO tem o formato `sk-…`: `redactText` só reconhece esse
 * formato, e a peneira do Sentry só apaga blocos de 40+ caracteres. Uma chave
 * `nvapi-…` curta — a da NVIDIA, que o seed cadastra — passava pelas duas.
 * Testar com `sk-…` provava o regex, não a regra.
 *
 * Nenhuma rota nem action da web chama o provedor: a tela só grava o pedido, e
 * quem chama é a CLI. O que a web devolve sai do banco, e por isso a varredura
 * do banco inteiro somada ao painel cobre a resposta da web.
 *
 * Fronteira FORA: o provedor (fetch falso). Todo o resto é o de produção.
 */
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { job, source } from "../src/core/db/schema.ts";
import { jobAnalysisPanel, processNextAnalysis, requestJobAnalysis } from "../src/core/llm/job-analysis.ts";
import { LlmError } from "../src/core/llm/port.ts";
import { resolveLlm } from "../src/core/llm/providers.ts";
import { chooseModel, portFor } from "../src/core/llm/registry.ts";
import { scrubEvent } from "../src/core/observability.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

const VAR_CHAVE = "JHO_G41_SENTINELA_KEY";
/** Única por execução e curta de propósito: abaixo dos 40 caracteres da peneira genérica. */
const SENTINELA = `nvapi-G41-${randomBytes(4).toString("hex")}`;

const DESCRICAO = [
  "We are looking for a Staff AI Engineer to design and operate retrieval",
  "augmented generation systems in production. You will own offline evaluation,",
  "cost observability per query, and the rollout process for model changes.",
  "The role reports to the Head of Engineering and covers architecture,",
  "mentoring and hands-on delivery across a distributed platform team.",
  "Requirements include eight years building distributed systems, production",
  "experience with large language models, and comfort with ambiguity.",
].join(" ");

let chaveOriginal: string | undefined;
/** O que o provedor falso recebeu de credencial, para provar que a chave viajou. */
let recebidas: string[] = [];

beforeAll(async () => {
  chaveOriginal = process.env[VAR_CHAVE];
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
  process.env[VAR_CHAVE] = SENTINELA;
  recebidas = [];
});

afterEach(async () => {
  if (chaveOriginal === undefined) delete process.env[VAR_CHAVE];
  else process.env[VAR_CHAVE] = chaveOriginal;
  vi.unstubAllGlobals();
  await releaseTestDb();
});

function credencial(init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  return headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
}

/** Provedor que recusa a chave e a devolve na mensagem, como as APIs reais fazem. */
function provedorQueEcoa(status: number): void {
  vi.stubGlobal("fetch", (async (_input: string | URL, init?: RequestInit) => {
    const chave = credencial(init);
    recebidas.push(chave);
    return new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${chave}` } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch);
}

/** `fetch` que falha antes da resposta citando o valor do cabeçalho, como o undici faz com valor inválido. */
function redeQueCitaOCabecalho(): void {
  vi.stubGlobal("fetch", (async (_input: string | URL, init?: RequestInit) => {
    const chave = credencial(init);
    recebidas.push(chave);
    throw new TypeError(`Headers.append: "${chave}" is an invalid header value.`);
  }) as unknown as typeof fetch);
}

function tudoQueOErroMostra(error: unknown): string {
  const e = error as Error;
  return [String(e), e.message, e.stack, JSON.stringify(e), inspect(e, { depth: 5 })].join("\n");
}

/** O evento que o Sentry montaria com esse erro, depois do `beforeSend` real. */
function eventoDoSentry(error: unknown): string {
  const e = error as Error;
  const event = {
    message: String(e),
    exception: { values: [{ type: e.name, value: e.message }] },
    breadcrumbs: [{ message: `console.error ${e.message}` }],
  };
  return JSON.stringify(scrubEvent(event));
}

async function cadastrarModelo(): Promise<void> {
  await rodar(
    "llm", "add-provider", "g41",
    "--label", "Provedor G41",
    "--key-env", VAR_CHAVE,
    "--base-url", "https://93.184.216.34",
  );
  await rodar("llm", "add-model", "g41", "modelo-g41", "--label", "Modelo G41");
}

async function semearVaga(): Promise<number> {
  const db = banco();
  await db.insert(source).values({ id: "manual:g41", kind: "manual", handle: "g41", label: "G41" }).onConflictDoNothing();
  const [linha] = await db
    .insert(job)
    .values({
      sourceId: "manual:g41",
      companyName: "Acme",
      externalId: "g41",
      title: "Staff AI Engineer",
      url: "https://exemplo.test/g41",
      descriptionText: DESCRICAO,
      fingerprint: "fp-g41",
      contentHash: "ch-g41",
      raw: {},
    })
    .returning({ id: job.id });
  return linha!.id;
}

/** Todas as linhas de todas as tabelas, como texto — inclusive tabela que ainda não existe hoje. */
async function bancoInteiro(): Promise<string> {
  const db = banco();
  const tabelas = await db.execute<{ s: string; t: string }>(sql`
    select table_schema as s, table_name as t from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')`);
  expect(tabelas.length).toBeGreaterThan(20);
  const partes: string[] = [];
  for (const { s, t } of tabelas) {
    const [linha] = await db.execute<{ d: string }>(
      sql.raw(`select coalesce(string_agg(x::text, '|'), '') as d from "${s}"."${t}" x`),
    );
    partes.push(linha?.d ?? "");
  }
  return partes.join("\n");
}

describe("V03-06 chave sentinela no caminho real do BYOK", () => {
  it("erro do provedor que ecoa a chave: a exceção e o Sentry não a carregam", async () => {
    await cadastrarModelo();
    const escolha = await chooseModel();
    expect(escolha?.apiKeyEnv).toBe(VAR_CHAVE);
    provedorQueEcoa(401);

    const erro = await portFor(escolha!).complete({ system: "s", messages: [{ role: "user", content: "u" }] }).then(
      () => undefined,
      (e: unknown) => e,
    );

    // A chave de verdade viajou no cabeçalho: sem isto o teste passaria por
    // nunca ter usado a sentinela.
    expect(recebidas).toEqual([SENTINELA]);
    expect(erro).toBeInstanceOf(LlmError);
    expect((erro as LlmError).status).toBe(401);
    expect((erro as LlmError).message).toContain("Incorrect API key provided");
    expect(tudoQueOErroMostra(erro)).not.toContain(SENTINELA);
    expect(eventoDoSentry(erro)).not.toContain(SENTINELA);
  });

  it("falha de rede que cita o cabeçalho, nos dois adapters: nem a mensagem nem a pilha levam a chave", async () => {
    await cadastrarModelo();
    const compativel = portFor((await chooseModel())!);
    const anthropic = resolveLlm({ JHO_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: SENTINELA })!.port;
    redeQueCitaOCabecalho();

    for (const porta of [compativel, anthropic]) {
      const erro = await porta.complete({ system: "s", messages: [] }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(erro).toBeInstanceOf(Error);
      expect((erro as Error).name).toBe("TypeError");
      expect((erro as Error).message).toContain("invalid header value");
      expect(tudoQueOErroMostra(erro)).not.toContain(SENTINELA);
      expect(eventoDoSentry(erro)).not.toContain(SENTINELA);
    }
    expect(recebidas).toEqual([SENTINELA, SENTINELA]);
  });

  it("`jho analyze` e `jho llm list`: o terminal nunca mostra a chave", async () => {
    await cadastrarModelo();
    await syncCandidateFromProfile();
    const vagaId = await semearVaga();
    provedorQueEcoa(401);

    const analise = await rodar("analyze", String(vagaId), "--yes");
    const lista = await rodar("llm", "list");

    expect(recebidas).toEqual([SENTINELA]);
    expect(analise.code).toBe(1);
    expect(analise.err).toContain("Incorrect API key provided");
    // Com a chave presente, a lista diz só que ela existe.
    expect(lista.out).toMatch(/Provedor G41.*\bok\b/);
    for (const r of [analise, lista]) {
      expect(`${r.out}\n${r.err}\n${r.uso}\n${tudoQueOErroMostra(r.erro ?? "")}`).not.toContain(SENTINELA);
    }
  });

  it("fila de análise com recusa e com cota: nenhuma tabela, nenhum log e nenhum painel levam a chave", async () => {
    await cadastrarModelo();
    const vagaId = await semearVaga();

    await requestJobAnalysis({ jobId: vagaId, requestedBy: null, now: "2026-09-24T12:00:00.000Z" });
    provedorQueEcoa(401);
    // `rodar` captura o console do comando por conta própria.
    const recusa = await rodar("analysis", "run", "--yes");

    // Fora da CLI, o processador roda sem ninguém capturar: o console inteiro é observado.
    const saida: string[] = [];
    for (const nivel of ["log", "error", "warn", "info", "debug"] as const) {
      vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
        saida.push(a.map((x) => (typeof x === "string" ? x : inspect(x))).join(" "));
      });
    }
    await requestJobAnalysis({ jobId: vagaId, requestedBy: null, now: "2026-09-24T12:01:00.000Z" });
    provedorQueEcoa(429);
    const escolha = (await chooseModel())!;
    const cota = await processNextAnalysis(
      {
        port: portFor(escolha),
        providerSlug: escolha.providerSlug,
        modelId: escolha.modelId,
        inputCostPerMTok: null,
        outputCostPerMTok: null,
        maxOutputTokens: escolha.maxOutputTokens,
      },
      { now: () => "2026-09-24T12:02:00.000Z" },
    );
    vi.restoreAllMocks();

    expect(recebidas).toEqual([SENTINELA, SENTINELA]);
    expect(recusa.out).toContain('"status":"failed"');
    expect(cota?.status).toBe("paused_quota");
    const painel = JSON.stringify(await jobAnalysisPanel(vagaId, { admin: true }));
    expect(painel).toContain("provider_error");
    expect(painel).not.toContain(SENTINELA);
    expect(`${recusa.out}\n${recusa.err}\n${saida.join("\n")}`).not.toContain(SENTINELA);
    // O cadastro guarda o NOME da variável; o valor não está em lugar nenhum.
    const tudo = await bancoInteiro();
    expect(tudo).toContain(VAR_CHAVE);
    expect(tudo).not.toContain(SENTINELA);
  });
});
