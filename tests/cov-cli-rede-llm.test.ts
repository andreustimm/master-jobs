/**
 * Suíte: `jho analyze` e `jho llm list` — o único comando de `src/cli.ts` que
 * manda dado para fora da máquina, e a tela que diz qual chave ele usaria.
 *
 * ## O que está sendo defendido aqui
 *
 * Regra 16 do CLAUDE.md e o cabeçalho de `port.ts` dizem a mesma coisa por dois
 * caminhos: **a chave é do usuário e o envio é um ato visível**. As duas viram
 * comportamento observável exatamente nestes dois comandos, e em nenhum outro
 * lugar:
 *
 *  - `analyze` imprime destino, chave REDIGIDA, tamanho do payload e o que NÃO
 *    vai junto — e só então pergunta. Um `--yes` acidental no default, ou uma
 *    chave impressa inteira, é o tipo de defeito que não deixa rastro no
 *    domínio: `analyzeJob` recebe uma porta pronta e não sabe de nada disso.
 *  - `llm list` mostra o NOME da variável quando a chave falta, e `ok` quando
 *    ela está presente. Nunca o valor.
 *
 * ## Rede
 *
 * A porta LLM real é construída por `portFor()` e chama `fetch` direto — não há
 * injeção na assinatura do comando. `globalThis.fetch` é o ponto de troca, e o
 * provedor cadastrado aponta para um IP literal para deixar explícito que
 * nenhum nome é resolvido.
 *
 * Fronteira DENTRO: escolha de modelo, guardas, confirmação, código de saída,
 * o que é impresso e o que não pode ser.
 * Fronteira FORA: o prompt e o formato do payload (`cov-llm-analyze`), o
 * cadastro (`cov-llm-registry`), o dossiê (`cov-apply-dossier`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { job, jobPage, llmModel, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, comStdin, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

/** Nome de variável só deste arquivo: nada de reaproveitar a chave de ninguém. */
const VAR_CHAVE = "JHO_TESTE_LLM_KEY";
/** Comprida de propósito: `redactKey` só mascara acima de 12 caracteres. */
const CHAVE = "sk-teste-1234567890abcdefghij";

/** Descrição longa o bastante (>=400) para o dossiê considerar que há o que ler. */
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

beforeAll(async () => {
  chaveOriginal = process.env[VAR_CHAVE];
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
  delete process.env[VAR_CHAVE];
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env[VAR_CHAVE];
  else process.env[VAR_CHAVE] = chaveOriginal;
  vi.unstubAllGlobals();
  releaseTestDb();
});

/** Cadastra um provedor compatível apontando para um IP literal, e um modelo. */
async function cadastrarModelo(
  opts: { raciocinio?: boolean; esforco?: string; custo?: boolean } = {},
): Promise<void> {
  await rodar(
    "llm", "add-provider", "teste",
    "--label", "Provedor de Teste",
    "--key-env", VAR_CHAVE,
    "--base-url", "https://93.184.216.34",
  );
  const args = ["llm", "add-model", "teste", "modelo-de-teste", "--label", "Modelo de Teste"];
  if (opts.raciocinio) args.push("--reasoning");
  if (opts.esforco) args.push("--effort", opts.esforco);
  if (opts.custo) args.push("--in-cost", "3", "--out-cost", "15");
  await rodar(...args);
}

/** Vaga com descrição suficiente — é o pré-requisito que `analyze` exige. */
async function semearVagaComDescricao(descricao = DESCRICAO): Promise<number> {
  const db = banco();
  await db
    .insert(source)
    .values({ id: "manual:teste", kind: "manual", handle: "teste", label: "Teste" })
    .onConflictDoNothing();
  const [linha] = await db
    .insert(job)
    .values({
      sourceId: "manual:teste",
      companyName: "Acme",
      externalId: "v1",
      title: "Staff AI Engineer",
      url: "https://exemplo.test/v1",
      descriptionText: descricao,
      fingerprint: "fp-v1",
      contentHash: "ch-v1",
      raw: {},
    })
    .returning({ id: job.id });
  return linha!.id;
}

/** Resposta no formato da API da OpenAI, que é o que o provedor compatível lê. */
function respostaLlm(texto: string): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        model: "modelo-que-respondeu",
        choices: [{ message: { content: texto } }],
        usage: { prompt_tokens: 900, completion_tokens: 210 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

/* -------------------------------- llm list -------------------------------- */

describe("jho llm list", () => {
  it("banco sem cadastro manda semear, em vez de imprimir cabeçalho vazio", async () => {
    const r = await rodar("llm", "list");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Nenhum modelo cadastrado");
    expect(r.out).toContain("jho llm seed");
  });

  it("é o subcomando padrão: `jho llm` sozinho lista", async () => {
    const r = await rodar("llm");

    // Sem `isDefault`, `jho llm` imprimiria a ajuda do grupo — e a pergunta que
    // se faz ao digitar `jho llm` é "o que está configurado?".
    expect(r.out).toContain("Nenhum modelo cadastrado");
  });

  it("mostra o NOME da variável quando a chave falta, e `ok` quando ela existe", async () => {
    await cadastrarModelo({ custo: true });

    const semChave = await rodar("llm", "list");
    process.env[VAR_CHAVE] = CHAVE;
    const comChave = await rodar("llm", "list");

    // Sem chave, a saída precisa dizer QUAL variável definir — "faltando" sem
    // nome deixaria a pessoa adivinhando.
    expect(semChave.out).toContain(VAR_CHAVE);
    expect(semChave.out).not.toContain(CHAVE);
    expect(comChave.out).toContain("ok");
    // A chave nunca aparece, nem quando está presente: o terminal vira
    // scrollback, e scrollback vira captura de tela.
    expect(comChave.out).not.toContain(CHAVE);
    expect(comChave.out).toContain("A chave nunca é gravada no banco");
  });

  it("marca com `→` o modelo em uso e mostra custo e esforço", async () => {
    await cadastrarModelo({ raciocinio: true, esforco: "high", custo: true });
    process.env[VAR_CHAVE] = CHAVE;

    const r = await rodar("llm", "list");

    expect(r.out).toContain("→ Modelo de Teste");
    expect(r.out).toContain("high");
    expect(r.out).toContain("$3/$15");
    expect(r.out).toContain("Trocar: jho llm use");
  });

  it("modelo sem custo cadastrado mostra travessão, não `undefined`", async () => {
    await cadastrarModelo();

    const r = await rodar("llm", "list");

    // Preço é opcional (serviço self-hosted não tem). Imprimir `$null/$?` faria
    // a coluna parecer defeito em vez de ausência deliberada.
    expect(r.out).toContain("—");
    expect(r.out).not.toContain("undefined");
  });

  it("custo só de entrada mostra `?` na saída, em vez de esconder a metade conhecida", async () => {
    await rodar(
      "llm", "add-provider", "teste", "--label", "Provedor de Teste", "--key-env", VAR_CHAVE,
    );
    await rodar(
      "llm", "add-model", "teste", "meio-preco", "--label", "Meio Preço", "--in-cost", "3",
    );

    const r = await rodar("llm", "list");

    // Metade do preço ainda serve para comparar modelos; apagar a linha inteira
    // por causa do campo que falta seria perder a informação que existe.
    expect(r.out).toContain("$3/$?");
  });

  it("modelo que aceita esforço mas não tem padrão aparece como `sim`", async () => {
    await cadastrarModelo({ raciocinio: true });

    const r = await rodar("llm", "list");

    // A coluna responde "este modelo aceita controle de esforço?" — e `sim` sem
    // nível é diferente de `—`, que quer dizer que nem aceita.
    expect(r.out).toContain("sim");
  });

  it("`--all` é o que revela o que foi desabilitado", async () => {
    await cadastrarModelo();
    await banco().update(llmModel).set({ enabled: false });

    const semAll = await rodar("llm", "list");
    const comAll = await rodar("llm", "list", "--all");

    expect(semAll.out).toContain("Nenhum modelo cadastrado");
    expect(comAll.out).toContain("Modelo de Teste");
  });
});

/* --------------------------------- analyze -------------------------------- */

describe("jho analyze <id>", () => {
  it("sem modelo com chave, recusa e ensina os dois passos que faltam", async () => {
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();

    const r = await rodar("analyze", String(vagaId));

    // Escolher um modelo sem chave levaria a um 401 opaco lá na frente. Falhar
    // aqui é a diferença entre "defina X no .env" e "HTTP 401".
    expect(r.code).toBe(1);
    expect(r.err).toContain("Nenhum modelo disponível com chave configurada");
    expect(r.out).toContain("jho llm seed");
    expect(r.out).toContain("ANTHROPIC_API_KEY");
  });

  it("`--model` de um modelo que não existe também recusa, sem cair no padrão", async () => {
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();

    const r = await rodar("analyze", String(vagaId), "--model", "modelo-inventado");

    // Cair no padrão em silêncio faria a pessoa pagar por um modelo que ela
    // explicitamente não pediu, e ler a saída como se fosse do outro.
    expect(r.code).toBe(1);
    expect(r.err).toContain("Nenhum modelo disponível");
  });

  it("vaga inexistente sai com 1 dizendo o id procurado", async () => {
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;

    const r = await rodar("analyze", "4242");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Vaga 4242 não encontrada");
  });

  it("vaga sem descrição capturada manda capturar, em vez de analisar o vazio", async () => {
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao("curta demais");

    const r = await rodar("analyze", String(vagaId));

    // Analisar um título e nada mais gastaria a chave do usuário para produzir
    // uma leitura inventada — o pior desfecho possível deste comando.
    expect(r.code).toBe(1);
    expect(r.err).toContain("Sem descrição capturada");
    expect(r.out).toContain("jho scrape queue && jho scrape run");
  });

  it("declara destino, chave redigida e o que NÃO envia — e o padrão é não enviar", async () => {
    await cadastrarModelo({ custo: true });
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", (async (input: string | URL) => {
      chamadas.push(String(input));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);

    // Enter vazio. Consentimento nunca pode ser o padrão de um comando que
    // gasta o dinheiro de outra pessoa e manda dado para fora.
    const r = await comStdin("\n", () => rodar("analyze", String(vagaId)));

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Isto vai sair da sua máquina");
    expect(r.out).toContain("Provedor de Teste");
    // `redactKey`: começo e fim, nunca o miolo.
    expect(r.out).toContain("sk-test…ghij");
    expect(r.out).not.toContain(CHAVE);
    expect(r.out).toContain("NÃO envia: seu currículo, seu perfil, nem o funil");
    expect(r.out).toContain("Cancelado");
    expect(chamadas).toEqual([]);
  });

  it("`s` no prompt envia, e a resposta vem com modelo e contagem de tokens", async () => {
    await cadastrarModelo({ custo: true });
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();
    vi.stubGlobal("fetch", respostaLlm("  Senioridade do título não sobrevive ao escopo.  "));

    const r = await comStdin("s\n", () => rodar("analyze", String(vagaId)));

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Staff AI Engineer");
    expect(r.out).toContain("Senioridade do título não sobrevive ao escopo.");
    expect(r.out).toContain("modelo-que-respondeu · 900 entrada / 210 saída tokens");
  });

  it("`--yes` pula a pergunta — é o modo de script, não o padrão", async () => {
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();
    vi.stubGlobal("fetch", respostaLlm("Análise."));

    const r = await rodar("analyze", String(vagaId), "--yes");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Análise.");
  });

  it("com modelo de raciocínio, o esforço aparece no aviso e a página vence a descrição", async () => {
    await cadastrarModelo({ raciocinio: true, esforco: "high" });
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();
    const textoDaPagina = `${DESCRICAO} Extra: on-call rotation is shared across the team.`;
    await banco().insert(jobPage).values({
      jobId: vagaId,
      finalUrl: "https://exemplo.test/v1",
      httpStatus: 200,
      html: "<html></html>",
      text: textoDaPagina,
      contentHash: "hash",
      bytes: 10,
      fetchedAt: new Date().toISOString(),
      parsedAt: new Date().toISOString(),
    });
    let corpoEnviado = "";
    vi.stubGlobal("fetch", (async (_input: string | URL, init?: RequestInit) => {
      corpoEnviado = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ model: "m", choices: [{ message: { content: "ok" } }], usage: {} }),
        { status: 200 },
      );
    }) as unknown as typeof fetch);

    const r = await rodar("analyze", String(vagaId), "--yes");

    expect(r.out).toContain("esforço high");
    // A página capturada é a mais completa das duas; usar a do adapter quando
    // existe página seria analisar menos texto do que se tem.
    expect(corpoEnviado).toContain("on-call rotation is shared");
    // Sem `usage`, a contagem vira `?` em vez de `null` no meio da frase.
    expect(r.out).toContain("? entrada / ? saída tokens");
  });

  it("modelo de raciocínio sem nível declarado diz `esforço padrão`, não `esforço null`", async () => {
    await cadastrarModelo({ raciocinio: true });
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();
    let corpoEnviado = "";
    vi.stubGlobal("fetch", (async (_input: string | URL, init?: RequestInit) => {
      corpoEnviado = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ model: "m", choices: [{ message: { content: "ok" } }], usage: {} }),
        { status: 200 },
      );
    }) as unknown as typeof fetch);

    const r = await rodar("analyze", String(vagaId), "--yes");

    expect(r.out).toContain("esforço padrão");
    // "Padrão" aqui quer dizer o padrão DO PROVEDOR: o pedido sai sem o campo,
    // em vez de sair com um nível que ninguém escolheu.
    expect(corpoEnviado).not.toContain("reasoning_effort");
  });

  it("falha do provedor vira mensagem e código 1, com a chave já redigida", async () => {
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();
    vi.stubGlobal("fetch", (async () =>
      new Response(JSON.stringify({ error: { message: `chave ${CHAVE} inválida` } }), {
        status: 401,
      })) as unknown as typeof fetch);

    const r = await rodar("analyze", String(vagaId), "--yes");

    expect(r.code).toBe(1);
    expect(r.err).toContain("inválida");
    // `LlmError` redige a mensagem ANTES de virar exceção justamente porque uma
    // API que rejeita a chave costuma ecoá-la de volta.
    expect(r.err).not.toContain(CHAVE);
    expect(r.erro).toBeUndefined();
  });

  it("não deixa nada gravado no banco — analisar é leitura, não decisão", async () => {
    await cadastrarModelo();
    process.env[VAR_CHAVE] = CHAVE;
    const candidatoId = await syncCandidateFromProfile();
    const vagaId = await semearVagaComDescricao();
    vi.stubGlobal("fetch", respostaLlm("Análise."));

    await rodar("analyze", String(vagaId), "--yes");

    // ADR 0004: o LLM lê, ele não ranqueia nem move funil. Se a análise
    // gravasse nota ou candidatura, o ranking deixaria de ser reproduzível.
    const { application, jobScore } = await import("../src/core/db/schema.ts");
    expect(await banco().select().from(jobScore)).toHaveLength(0);
    expect(
      await banco().select().from(application).where(eq(application.candidateId, candidatoId)),
    ).toHaveLength(0);
  });
});
