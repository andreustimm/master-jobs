/**
 * Suíte: os comandos de `src/cli.ts` que **saem para a rede** para tratar do
 * acervo — `jobs sync`, `jobs verify`, `jobs recheck queue|run|status` e o
 * grupo `sources`.
 *
 * ## Por que estes ficaram de fora das quatro primeiras suítes de CLI
 *
 * O cabeçalho de `cov-cli-posicionamento.test.ts` declara a fronteira: "rede".
 * A razão dada era que dublar a porta HTTP dentro do processo da CLI só
 * reencenaria o que `cov-ingest-run`, `cov-ingest-verify` e `cov-scrape-*` já
 * cobrem. Isso vale para o MIOLO — a orquestração, o fechamento, a contagem —
 * e não vale para a casca: a leitura das flags, a conversão de `string` do
 * argv para número, a ordem dos efeitos e o código de saída moram só aqui, em
 * `cli.ts`, e nenhuma suíte de domínio os enxerga.
 *
 * O exemplo concreto que justifica o arquivo: `--limit` chega como `"2"`. Se
 * o handler esquecer o `Number()`, o corte some sem erro nenhum, e a suíte de
 * `verify.ts` continua verde porque ela chama a função com número.
 *
 * ## Como a rede é substituída, sem exceção
 *
 * Dois dublês, ambos do próprio produto:
 *
 *  - **Porta HTTP** (`setHttpPort`/`fixtureHttp`): é por onde os treze
 *    adapters de fonte falam. `jobs sync` e `sources probe` passam por aqui.
 *  - **`globalThis.fetch`** (`vi.stubGlobal`): `jobs verify` e
 *    `jobs recheck run` chegam à rede por `safeRemoteFetch`, e a CLI não
 *    oferece `--fetch-impl`. Trocar o global é o único ponto de injeção que
 *    sobra sem alterar produção.
 *
 * E a política de saída (`assertSafeRemoteUrl`) resolve o host por DNS antes de
 * qualquer requisição. Toda URL semeada aqui usa um IP público **literal**,
 * porque endereço literal desvia do `lookup()` — sem isso, um teste "offline"
 * ainda perguntaria ao resolvedor do sistema quem é `exemplo.test`.
 *
 * Fronteira DENTRO: flags, defaults, conversão de tipo, ramos de impressão,
 * código de saída e a persistência que o comando dispara.
 * Fronteira FORA: a semântica de sync/verify em si — é de `cov-ingest-*`.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { job, jobScore, source, verifyTask } from "../src/core/db/schema.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar, type Execucao } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

/**
 * Endereço público literal.
 *
 * `assertSafeRemoteUrl` só chama o resolvedor de DNS quando o host NÃO é um IP
 * literal. Usar o literal é o que garante que nenhum caso deste arquivo faça
 * uma pergunta ao resolvedor da máquina — o que seria rede, mesmo sem socket
 * HTTP aberto.
 */
const IP_PUBLICO = "93.184.216.34";

let sourcesPathOriginal: string | undefined;
let candidatoId: number;
let sequencia = 0;

beforeAll(async () => {
  sourcesPathOriginal = process.env.JHO_SOURCES_PATH;
  await carregarCli();
});

// O worker do Vitest reaproveita o processo entre arquivos; deixar a variável
// apontando para um YAML temporário contaminaria suíte alheia.
afterAll(() => {
  if (sourcesPathOriginal === undefined) delete process.env.JHO_SOURCES_PATH;
  else process.env.JHO_SOURCES_PATH = sourcesPathOriginal;
});

beforeEach(async () => {
  await useTestDb();
  candidatoId = await syncCandidateFromProfile();
});

afterEach(() => {
  resetHttpPort();
  vi.unstubAllGlobals();
  releaseTestDb();
});

/**
 * Engole o que for escrito direto em `process.stdout`.
 *
 * `jobs verify` e `jobs recheck run` desenham a barra de progresso com
 * `process.stdout.write` e `\r`, que não passa por `console.log` e portanto
 * escapa dos espiões de `rodar()`. Sem isto, "12/40 verificadas" aparece no
 * meio do relatório do Vitest e vira ruído permanente na saída da suíte.
 */
async function semRuido(fn: () => Promise<Execucao>): Promise<Execucao> {
  const escreverOriginal = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = escreverOriginal;
  }
}

/** Escreve um `sources.yaml` temporário e aponta a CLI para ele. */
async function comSources(yaml: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "jho-cli-sources-"));
  const caminho = join(dir, "sources.yaml");
  await writeFile(caminho, yaml);
  process.env.JHO_SOURCES_PATH = caminho;
}

/**
 * Dublê de `fetch` que responde por trecho da URL.
 *
 * Devolve `Response` sem corpo porque `probe()` só olha o status — um corpo
 * aqui só serviria para sugerir que ele importa.
 */
function fetchPorUrl(porUrl: Record<string, number>, padrao = 200): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const achado = Object.entries(porUrl).find(([chave]) => url.includes(chave));
    return new Response(null, { status: achado?.[1] ?? padrao });
  }) as unknown as typeof fetch;
}

/** Vaga com URL sondável e, opcionalmente, nota — é o que `verify` seleciona. */
async function semearVaga(
  opts: { fit?: number; sourceId?: string; caminho?: string } = {},
): Promise<number> {
  sequencia++;
  const db = banco();
  const sourceId = opts.sourceId ?? "lever:acme";
  await db
    .insert(source)
    .values({
      id: sourceId,
      kind: sourceId.split(":")[0]!,
      handle: sourceId.split(":")[1]!,
      label: sourceId,
    })
    .onConflictDoNothing();
  const [linha] = await db
    .insert(job)
    .values({
      sourceId,
      companyName: "Acme",
      externalId: `ext-${sequencia}`,
      title: `Vaga ${sequencia}`,
      url: `https://${IP_PUBLICO}${opts.caminho ?? `/vaga/${sequencia}`}`,
      fingerprint: `fp-${sequencia}`,
      contentHash: `ch-${sequencia}`,
      raw: {},
    })
    .returning({ id: job.id });

  if (opts.fit !== undefined) {
    await db.insert(jobScore).values({
      candidateId: candidatoId,
      jobId: linha!.id,
      fit: opts.fit,
      titleScore: opts.fit,
      keywordScore: 0,
      seniorityScore: 0,
      geoScore: 0,
      compScore: 0,
      freshnessScore: 0,
      benefitScore: 0,
      penalty: 0,
      cluster: "architect",
      matchedKeywords: [],
      missingKeywords: [],
      detectedBenefits: [],
      ageDays: null,
      reasons: [],
      blockers: [],
      scorerVersion: "teste",
    });
  }
  return linha!.id;
}

/* ---------------------------------- sync ---------------------------------- */

describe("jho jobs sync", () => {
  const vagaGreenhouse = {
    id: 991,
    title: "  Senior AI Software Architect  ",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/991",
    content: "&lt;p&gt;Arquitetura de sistemas de IA em produção.&lt;/p&gt;",
    first_published: "2026-08-10T00:00:00Z",
    location: { name: "Remote — LATAM" },
  };

  it("varre a fonte configurada, grava a vaga e pontua no mesmo comando", async () => {
    await comSources("sources:\n  - kind: greenhouse\n    handle: acme\n    label: Acme\n");
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [vagaGreenhouse] } }));

    const r = await rodar("jobs", "sync");

    expect(r.code).toBeUndefined();
    // A contagem impressa é a única coisa que quem roda o comando vê; se ela
    // não bater com o banco, o comando mente sobre o próprio trabalho.
    expect(r.out).toContain("Syncing 1 source(s)");
    expect(r.out).toMatch(/1 fetched/);
    expect(r.out).toContain("1 new");
    expect(r.out).toContain("Scoring");
    const vagas = await banco().select().from(job);
    expect(vagas).toHaveLength(1);
    expect(vagas[0]?.title).toBe("Senior AI Software Architect");
    expect(await banco().select().from(jobScore)).toHaveLength(1);
  });

  it("avisa da falta de cotação antes de pontuar, em vez de comparar salário no escuro", async () => {
    await comSources("sources:\n  - kind: greenhouse\n    handle: acme\n    label: Acme\n");
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [vagaGreenhouse] } }));

    const r = await rodar("jobs", "sync");

    // Banco novo não tem cotação. Pontuar em silêncio faria toda vaga em EUR ou
    // BRL entrar no ranking com a nota de compensação errada e sem pista.
    expect(r.out).toContain("jho fx refresh");
  });

  it("`--no-score` para depois da gravação — é o modo de quem ainda não tem candidato", async () => {
    await comSources("sources:\n  - kind: greenhouse\n    handle: acme\n    label: Acme\n");
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [vagaGreenhouse] } }));

    const r = await rodar("jobs", "sync", "--no-score");

    expect(r.code).toBeUndefined();
    expect(r.out).not.toContain("Scoring");
    expect(await banco().select().from(job)).toHaveLength(1);
    expect(await banco().select().from(jobScore)).toHaveLength(0);
  });

  it("imprime o aviso da fonte sem derrubar a varredura", async () => {
    await comSources("sources:\n  - kind: ashby\n    handle: vazia\n    label: Vazia\n");
    setHttpPort(fixtureHttp({ "api.ashbyhq.com": { jobs: [] } }));

    const r = await rodar("jobs", "sync", "--no-score");

    // Quadro que responde 200 com zero vagas costuma ser handle errado, não
    // empresa sem vaga. O aviso é o que distingue os dois casos sem log.
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("returned no listed jobs");
  });

  it("fonte que falha vira uma linha vermelha e um `failed`, nunca uma exceção", async () => {
    await comSources(
      "sources:\n" +
      "  - kind: greenhouse\n    handle: acme\n    label: Acme\n" +
      "  - kind: lever\n    handle: fantasma\n    label: Fantasma\n",
    );
    // Só o Greenhouse tem fixture: o Lever cai em "Sem fixture", que é o que
    // uma API fora do ar produz aqui dentro.
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [vagaGreenhouse] } }));

    const r = await rodar("jobs", "sync", "--no-score", "--concurrency", "1");

    // Invariante 2 de `run.ts`: uma fonte fora do ar não pode levar as outras
    // doze junto. O comando termina em sucesso e a falha vira contagem.
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("1 failed");
    expect(await banco().select().from(job)).toHaveLength(1);
    const [fonteQuebrada] = await banco()
      .select()
      .from(source)
      .where(eq(source.id, "lever:fantasma"));
    expect(fonteQuebrada?.lastStatus).toBe("error");
  });

  it("conta o `rescore` quando a fonte reescreveu o anúncio de uma vaga já pontuada", async () => {
    await comSources("sources:\n  - kind: greenhouse\n    handle: acme\n    label: Acme\n");
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [vagaGreenhouse] } }));
    await rodar("jobs", "sync");
    // Mesma vaga, texto diferente: é o que acontece quando a empresa edita o
    // anúncio sem republicá-lo.
    setHttpPort(
      fixtureHttp({
        "boards-api.greenhouse.io": {
          jobs: [{ ...vagaGreenhouse, content: "&lt;p&gt;Agora com plantão e viagens.&lt;/p&gt;" }],
        },
      }),
    );

    const r = await rodar("jobs", "sync", "--no-score");

    // A nota foi calculada contra o texto antigo. Invalidar e ANUNCIAR é o que
    // impede o ranking de mostrar uma nota que já não corresponde ao anúncio.
    expect(r.out).toContain("1 rescore");
    expect(await banco().select().from(jobScore)).toHaveLength(0);
  });

  it("sem candidato cadastrado, a pontuação orienta em vez de estourar sem contexto", async () => {
    await useTestDb(); // banco novo, agora SEM candidato
    await comSources("sources:\n  - kind: greenhouse\n    handle: acme\n    label: Acme\n");
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [vagaGreenhouse] } }));

    const r = await rodar("jobs", "sync");

    // A varredura já gravou; é a pontuação que não tem a quem se referir. A
    // mensagem precisa dizer o comando que resolve, não o nome da função.
    expect((r.erro as Error).message).toContain("jho db seed");
  });
});

/* --------------------------------- verify --------------------------------- */

describe("jho jobs verify", () => {
  it("fecha só o 404, deixa o 403 em paz e explica a diferença", async () => {
    const morta = await semearVaga({ fit: 80, caminho: "/morta", sourceId: "jobgether:all" });
    const viva = await semearVaga({ fit: 70, caminho: "/viva", sourceId: "jobgether:all" });
    const bloqueada = await semearVaga({ fit: 60, caminho: "/bloqueada", sourceId: "himalayas:all" });
    vi.stubGlobal("fetch", fetchPorUrl({ "/morta": 404, "/viva": 200, "/bloqueada": 403 }));

    const r = await semRuido(() => rodar("jobs", "verify", "--min-fit", "0"));

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("3 verificadas");
    expect(r.out).toContain("1 vivas");
    expect(r.out).toContain("1 mortas");
    expect(r.out).toContain("1 inconclusivas");
    // O texto sobre 403 não é enfeite: sem ele, "inconclusiva" parece defeito
    // do sistema, e a reação natural seria mandar fechar essas também.
    expect(r.out).toContain("bloqueio de bot");

    const linhas = await banco().select().from(job);
    expect(linhas.find((l) => l.id === morta)?.closedAt).not.toBeNull();
    expect(linhas.find((l) => l.id === viva)?.closedAt).toBeNull();
    // O caro: fechar num 403 apagaria vaga viva do quadro, sem desfazer.
    expect(linhas.find((l) => l.id === bloqueada)?.closedAt).toBeNull();
  });

  it("agrupa o resultado por tipo de fonte, com a percentagem de mortas", async () => {
    await semearVaga({ fit: 80, caminho: "/a", sourceId: "jobgether:all" });
    await semearVaga({ fit: 80, caminho: "/b", sourceId: "greenhouse:acme" });
    vi.stubGlobal("fetch", fetchPorUrl({ "/a": 404, "/b": 200 }));

    const r = await semRuido(() => rodar("jobs", "verify", "--min-fit", "0"));

    // A leitura por fonte é o que transforma "5 links mortos" numa decisão:
    // 100% de mortas numa fonte é problema da fonte, não do acervo.
    expect(r.out).toMatch(/jobgether\s+1 mortas de\s+1\s+100%/);
    expect(r.out).toMatch(/greenhouse\s+0 mortas de\s+1/);
  });

  it("`--dry-run` conta o que fecharia e não fecha nada", async () => {
    const morta = await semearVaga({ fit: 80, caminho: "/morta" });
    vi.stubGlobal("fetch", fetchPorUrl({ "/morta": 404 }));

    const r = await semRuido(() => rodar("jobs", "verify", "--min-fit", "0", "--dry-run"));

    expect(r.out).toContain("1 mortas");
    expect(r.out).toContain("--dry-run: nada foi fechado");
    const [linha] = await banco().select().from(job).where(eq(job.id, morta));
    expect(linha?.closedAt).toBeNull();
  });

  it("o `--min-fit` padrão é 55: vaga abaixo disso não é sondada", async () => {
    await semearVaga({ fit: 30, caminho: "/fraca" });
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", (async (input: string | URL) => {
      chamadas.push(String(input));
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch);

    const r = await semRuido(() => rodar("jobs", "verify"));

    // O corte existe para não sondar 6.000 links de terceiros por linha que
    // ninguém vai clicar. Provar o negativo — nenhuma requisição — é a única
    // forma de verificar isso, e é por isso que o dublê registra as chamadas.
    expect(chamadas).toEqual([]);
    expect(r.out).toContain("0 verificadas");
  });

  it("`--limit` chega como número e corta o lote de verdade", async () => {
    await semearVaga({ fit: 90, caminho: "/1" });
    await semearVaga({ fit: 80, caminho: "/2" });
    await semearVaga({ fit: 70, caminho: "/3" });
    vi.stubGlobal("fetch", fetchPorUrl({}, 200));

    const r = await semRuido(() => rodar("jobs", "verify", "--min-fit", "0", "--limit", "2"));

    // `Number(opts.limit)` é a fronteira. Com a string do argv o `.slice()`
    // recebe texto, o corte some, e as três seriam sondadas em silêncio.
    expect(r.out).toContain("2 verificadas");
  });
});

/* ------------------------------ reconferência ----------------------------- */

describe("jho jobs recheck", () => {
  it("`status` numa fila vazia diz o comando que a enche, em vez de imprimir nada", async () => {
    const r = await rodar("jobs", "recheck", "status");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("vazia");
    expect(r.out).toContain("jho jobs recheck queue");
  });

  it("`queue` enfileira acima do fit, mostra o estado da fila e o próximo passo", async () => {
    await semearVaga({ fit: 80, caminho: "/a" });
    await semearVaga({ fit: 10, caminho: "/b" });

    const r = await rodar("jobs", "recheck", "queue", "--min-fit", "50");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("1 enfileirada(s)");
    expect(r.out).toContain('{"pending":1}');
    expect(await banco().select().from(verifyTask)).toHaveLength(1);
  });

  it("`--older-than 0` reenfileira o que acabou de ser conferido", async () => {
    const vagaId = await semearVaga({ fit: 80, caminho: "/a" });
    await banco()
      .update(job)
      .set({ checkedAt: new Date().toISOString() })
      .where(eq(job.id, vagaId));

    const comPadrao = await rodar("jobs", "recheck", "queue", "--min-fit", "0");
    const comZero = await rodar("jobs", "recheck", "queue", "--min-fit", "0", "--older-than", "0");

    // O padrão de 7 dias é o que torna a varredura progressiva: sem ele, toda
    // execução reenfileiraria as mesmas 200 melhores e a cauda nunca sairia.
    expect(comPadrao.out).toContain("0 enfileirada(s)");
    expect(comZero.out).toContain("1 enfileirada(s)");
  });

  it("`--limit` limita o lote enfileirado", async () => {
    await semearVaga({ fit: 90, caminho: "/1" });
    await semearVaga({ fit: 80, caminho: "/2" });
    await semearVaga({ fit: 70, caminho: "/3" });

    await rodar("jobs", "recheck", "queue", "--min-fit", "0", "--limit", "2");

    expect(await banco().select().from(verifyTask)).toHaveLength(2);
  });

  it("`status` lista a fila por situação depois de enfileirar", async () => {
    await semearVaga({ fit: 80, caminho: "/a" });
    await rodar("jobs", "recheck", "queue", "--min-fit", "0");

    const r = await rodar("jobs", "recheck", "status");

    expect(r.out).toMatch(/pending\s+1/);
  });

  it("`run` consome a fila, fecha o que sumiu e reabre o que voltou", async () => {
    const morta = await semearVaga({ fit: 80, caminho: "/morta" });
    const revivida = await semearVaga({ fit: 80, caminho: "/revivida" });
    await rodar("jobs", "recheck", "queue", "--min-fit", "0");
    // Fechada por engano DEPOIS de entrar na fila — a varredura só enfileira
    // vaga aberta, e é justamente a tarefa já enfileirada que carrega a
    // chance de desfazer o engano.
    await banco()
      .update(job)
      .set({ closedAt: new Date().toISOString() })
      .where(eq(job.id, revivida));
    vi.stubGlobal("fetch", fetchPorUrl({ "/morta": 404, "/revivida": 200 }));

    const r = await semRuido(() => rodar("jobs", "recheck", "run", "--delay", "0"));

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("2 verificadas");
    expect(r.out).toContain("1 mortas");
    const linhas = await banco().select().from(job);
    expect(linhas.find((l) => l.id === morta)?.closedAt).not.toBeNull();
    // Sem a reabertura, um 404 transitório sumiria com a vaga para sempre.
    expect(linhas.find((l) => l.id === revivida)?.closedAt).toBeNull();
  });

  it("`--max` para no teto pedido e deixa o resto na fila", async () => {
    await semearVaga({ fit: 90, caminho: "/1" });
    await semearVaga({ fit: 80, caminho: "/2" });
    await rodar("jobs", "recheck", "queue", "--min-fit", "0");
    vi.stubGlobal("fetch", fetchPorUrl({}, 200));

    const r = await semRuido(() => rodar("jobs", "recheck", "run", "--max", "1", "--delay", "0"));

    // `opts.max ? Number(...) : undefined`: sem a conversão, `checked < "1"`
    // continua verdadeiro depois da primeira e o teto não existe.
    expect(r.out).toContain("1 verificadas");
    const tarefas = await banco().select().from(verifyTask);
    expect(tarefas.filter((t) => t.status === "pending")).toHaveLength(1);
  });

  it("`run` explica o inconclusivo em vez de deixá-lo parecendo defeito", async () => {
    await semearVaga({ fit: 80, caminho: "/bloqueada" });
    await rodar("jobs", "recheck", "queue", "--min-fit", "0");
    vi.stubGlobal("fetch", fetchPorUrl({ "/bloqueada": 429 }));

    const r = await semRuido(() => rodar("jobs", "recheck", "run", "--delay", "0"));

    expect(r.out).toContain("1 inconclusivas");
    expect(r.out).toContain("bloqueio de robô");
  });
});

/* -------------------------------- sources --------------------------------- */

describe("jho sources list", () => {
  it("mostra `never` para fonte configurada que nunca foi varrida", async () => {
    await comSources("sources:\n  - kind: greenhouse\n    handle: acme\n    label: Acme\n");

    const r = await rodar("sources", "list");

    expect(r.code).toBeUndefined();
    // A configuração é a fonte da verdade: a linha aparece mesmo sem registro
    // no banco, senão uma fonte recém-adicionada ficaria invisível até a
    // primeira varredura.
    expect(r.out).toContain("greenhouse");
    expect(r.out).toContain("never");
  });

  it("mostra `ok` com a contagem, e `error` com o motivo embaixo", async () => {
    await comSources(
      "sources:\n" +
      "  - kind: greenhouse\n    handle: acme\n    label: Acme\n" +
      "  - kind: lever\n    handle: quebrada\n    label: Quebrada\n",
    );
    await banco().insert(source).values([
      {
        id: "greenhouse:acme",
        kind: "greenhouse",
        handle: "acme",
        label: "Acme",
        lastStatus: "ok",
        lastJobCount: 42,
        lastSyncedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "lever:quebrada",
        kind: "lever",
        handle: "quebrada",
        label: "Quebrada",
        lastStatus: "error",
        lastError: "HTTP 500 em api.lever.co",
      },
    ]);

    const r = await rodar("sources", "list");

    expect(r.out).toContain("2026-08-17 10:00:00");
    expect(r.out).toContain("42");
    expect(r.out).toContain("ok");
    // O erro vem numa linha própria, indentada: cortá-lo na coluna esconderia
    // justamente a parte que diz o que consertar.
    expect(r.out).toContain("↳ HTTP 500 em api.lever.co");
  });

  it("`(all)` no lugar do handle vazio — quadro sem handle é o board inteiro", async () => {
    await comSources('sources:\n  - kind: arbeitnow\n    handle: ""\n    label: Arbeitnow\n');

    const r = await rodar("sources", "list");

    expect(r.out).toContain("(all)");
  });
});

describe("jho sources probe <kind> <handle>", () => {
  it("sonda sem gravar nada — é o comando de conferir handle antes de configurar", async () => {
    setHttpPort(
      fixtureHttp({
        "boards-api.greenhouse.io": {
          jobs: [
            {
              id: 1,
              title: "Staff Engineer",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
              location: { name: "Remote" },
            },
          ],
        },
      }),
    );

    const r = await rodar("sources", "probe", "greenhouse", "acme");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("greenhouse:acme returned 1 job(s)");
    expect(r.out).toContain("Staff Engineer");
    // "Sem gravar nada" é a promessa da descrição do comando, e a única forma
    // de conferi-la é olhar o banco depois.
    expect(await banco().select().from(job)).toHaveLength(0);
    expect(await banco().select().from(source)).toHaveLength(0);
  });

  it("repassa o aviso do adapter", async () => {
    setHttpPort(fixtureHttp({ "api.ashbyhq.com": { jobs: [] } }));

    const r = await rodar("sources", "probe", "ashby", "vazia");

    expect(r.out).toContain("returned 0 job(s)");
    expect(r.out).toContain("no listed jobs");
  });

  it("vaga sem local declarado vira `?`, e não uma linha cortada pela metade", async () => {
    setHttpPort(
      fixtureHttp({
        "boards-api.greenhouse.io": {
          jobs: [
            {
              id: 2,
              title: "Principal Engineer",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
              location: null,
            },
          ],
        },
      }),
    );

    const r = await rodar("sources", "probe", "greenhouse", "acme");

    // Local ausente é informação sobre o anúncio — vários quadros simplesmente
    // não têm o campo. Imprimir "undefined" faria parecer defeito do adapter.
    expect(r.out).toContain("Principal Engineer");
    expect(r.out).toContain("— ?");
  });

  it("recusa um tipo de fonte sem adapter, dizendo qual tipo era", async () => {
    const r = await rodar("sources", "probe", "linkedin", "vagas");

    // `parseFetchableSourceKind` é a validação de fronteira: o argv é texto
    // livre, e um tipo desconhecido tem de morrer aqui e não como
    // `undefined.fetchJobs` três frames adiante.
    expect((r.erro as Error).message).toContain('source kind "linkedin"');
  });
});

describe("jho sources snippet [platform]", () => {
  it("usa o extrator genérico quando nenhuma plataforma é dita", async () => {
    const r = await rodar("sources", "snippet");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Abra o console do navegador");
    expect(r.out).toContain("jho jobs import vagas.json --source generic");
    // A promessa que faz o snippet aceitável: ele lê a página que já está
    // aberta e não fala com ninguém. Dizer isso é parte do comando.
    expect(r.out).toContain("Não faz requisição nem envia nada");
  });

  it("`--match` troca o trecho que identifica o link da vaga", async () => {
    const r = await rodar("sources", "snippet", "revelo", "--match", "/oportunidade/");

    expect(r.out).toContain('"/oportunidade/"');
  });

  it("plataforma desconhecida cai no genérico, mas avisa antes", async () => {
    const r = await rodar("sources", "snippet", "gupy");

    // Cair no genérico em silêncio faria o usuário achar que existe um preset
    // de Gupy e que o resultado ruim é do preset.
    expect(r.out).toContain("Plataformas conhecidas");
    expect(r.out).toContain('extrator genérico para "gupy"');
  });
});
