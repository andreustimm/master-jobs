/**
 * Suíte: o grupo `scrape` de `src/cli.ts` — `queue`, `run`, `status`, `retry`
 * e `reparse`.
 *
 * ## O que é da CLI aqui, e o que não é
 *
 * `cov-scrape-fetcher`, `cov-scrape-parser` e `cov-scrape-queue-admin` já
 * provam o comportamento do robô: o que robots.txt decide, o que vale repetir,
 * como o claim não duplica. Nada disso é reencenado aqui.
 *
 * O que só existe em `cli.ts` são as decisões de composição, e cada uma tem um
 * modo de falhar silencioso:
 *
 *  - `--fetch-only` e `--parse-only` escolhem QUAIS estágios rodam. Um `if`
 *    invertido faria `--parse-only` baixar páginas — contra site de terceiro.
 *  - `-c` e `-n` chegam como texto do argv. Sem `Number()`, o teto some.
 *  - O aviso "rode: jho jobs score" depois do tratamento existe porque uma
 *    vaga que acabou de ganhar descrição tem a nota velha; sem ele o ranking
 *    fica desatualizado sem ninguém notar.
 *
 * ## Rede
 *
 * Nenhum socket. `robots.txt` passa pela porta HTTP (dublada com
 * `fixtureHttp`) e a captura passa por `globalThis.fetch` (dublado com
 * `vi.stubGlobal`). As URLs semeadas usam IP público literal, porque
 * `assertSafeRemoteUrl` só consulta o DNS quando o host não é literal — e
 * consultar o resolvedor já seria sair da máquina.
 *
 * Fronteira DENTRO: flags, estágios, contagens impressas, estado da fila.
 * Fronteira FORA: extração, robots e política de repetição.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { job, jobPage, jobScore, scrapeTask, source } from "../src/core/db/schema.ts";
import { resetHostThrottle } from "../src/core/scrape/fetcher.ts";
import { clearRobotsCache } from "../src/core/scrape/robots.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

/** IP público literal: nenhum caso deste arquivo consulta o resolvedor de DNS. */
const IP_PUBLICO = "93.184.216.34";

/** Página com texto suficiente para o extrator considerar utilizável (>200). */
const PAGINA = `<!doctype html><html><head><title>Staff AI Engineer — Acme</title></head>
<body><nav><ul><li>Home</li><li>Careers</li></ul></nav>
<article>
  <h1>Staff AI Engineer</h1>
  <p>Fully remote position building retrieval augmented generation systems in
  production, with offline evaluation and cost observability per query.</p>
  <ul>
    <li>Oito anos construindo sistemas distribuídos em produção, com responsabilidade por disponibilidade.</li>
    <li>Experiência levando modelos de linguagem a produção, incluindo avaliação e custo por consulta.</li>
  </ul>
  <p>Salary $180,000 - $220,000 per year. Senior level. Visa sponsorship is not available.</p>
</article></body></html>`;

let candidatoId: number;
let sequencia = 0;

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
  candidatoId = await syncCandidateFromProfile();
  // O portão de educação por host guarda o instante da última requisição num
  // Map de módulo, que sobrevive entre casos. Sem limpar, o segundo caso do
  // arquivo esperaria um segundo inteiro por nada.
  resetHostThrottle();
  // O robots.txt também é cacheado por origem, e a origem é a mesma em todos os
  // casos — sem limpar, o segundo caso herdaria as regras do primeiro.
  clearRobotsCache();
  // Sem fixture, `text()` devolve null: nenhuma regra, tudo permitido. É o que
  // um site sem robots.txt produz, e é o padrão que a maioria dos casos quer.
  setHttpPort(fixtureHttp({}));
});

afterEach(() => {
  resetHttpPort();
  vi.unstubAllGlobals();
  releaseTestDb();
});

/** `fetch` dublê que devolve sempre a mesma página e registra o que pediram. */
function fetcherFixo(status = 200, corpo = PAGINA): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(status === 200 ? corpo : null, {
      status,
      headers: { "content-type": "text/html" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/**
 * Vaga sem descrição, pontuada — é exatamente o que o robô existe para
 * preencher, e o que `scrape queue` seleciona.
 */
async function semearVaga(opts: { descricao?: string; caminho?: string } = {}): Promise<number> {
  sequencia++;
  const db = banco();
  await db
    .insert(source)
    .values({ id: "careers:acme", kind: "careers", handle: "acme", label: "Acme" })
    .onConflictDoNothing();
  const [linha] = await db
    .insert(job)
    .values({
      sourceId: "careers:acme",
      companyName: "Acme",
      externalId: `ext-${sequencia}`,
      title: `Staff AI Engineer ${sequencia}`,
      url: `https://${IP_PUBLICO}${opts.caminho ?? `/vaga/${sequencia}`}`,
      descriptionText: opts.descricao ?? null,
      fingerprint: `fp-${sequencia}`,
      contentHash: `ch-${sequencia}`,
      raw: {},
    })
    .returning({ id: job.id });

  await db.insert(jobScore).values({
    candidateId: candidatoId,
    jobId: linha!.id,
    fit: 80,
    titleScore: 80,
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
  return linha!.id;
}

/* --------------------------------- status --------------------------------- */

describe("jho scrape status", () => {
  it("fila vazia diz o comando que a enche, em vez de imprimir cabeçalho vazio", async () => {
    const r = await rodar("scrape", "status");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Fila de captura");
    expect(r.out).toContain("vazia — jho scrape queue");
  });

  it("lista só as situações com tarefa, na ordem do ciclo de vida", async () => {
    await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");

    const r = await rodar("scrape", "status");

    expect(r.out).toMatch(/pending\s+1/);
    // Imprimir `done 0`, `failed 0` e mais cinco zeros transformaria a saída em
    // ruído justamente no comando que existe para dar um panorama rápido.
    expect(r.out).not.toContain("done");
    expect(r.out).not.toContain("failed");
  });

  it("distingue `done` de `failed` na cor, depois de uma rodada completa", async () => {
    await semearVaga({ caminho: "/ok" });
    await semearVaga({ caminho: "/some" });
    await rodar("scrape", "queue", "--min-fit", "0");
    vi.stubGlobal("fetch", (async (input: string | URL) =>
      String(input).includes("/some")
        ? new Response(null, { status: 404 })
        : new Response(PAGINA, { status: 200, headers: { "content-type": "text/html" } })
    ) as unknown as typeof fetch);
    await rodar("scrape", "run", "-c", "1");

    const r = await rodar("scrape", "status");

    // As duas situações terminais convivem na mesma fila, e é a distinção entre
    // elas que diz se vale rodar `scrape retry` ou se o trabalho acabou.
    expect(r.out).toMatch(/done\s+1/);
    expect(r.out).toMatch(/failed\s+1/);
  });
});

/* --------------------------------- queue ---------------------------------- */

describe("jho scrape queue", () => {
  it("pula a vaga cuja fonte já entregou a descrição, e diz por quê", async () => {
    await semearVaga({ descricao: "d".repeat(2_500) });

    const r = await rodar("scrape", "queue", "--min-fit", "0");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("0 na fila");
    // A explicação importa mais que a contagem: buscar de novo o que já temos
    // gasta a cota do site e costuma render 403, sem nada em troca.
    expect(r.out).toContain("1 vaga(s) puladas");
    expect(r.out).toContain("403");
    expect(await banco().select().from(scrapeTask)).toHaveLength(0);
  });

  it("`--refresh` reenfileira a vaga que já tem página capturada", async () => {
    const vagaId = await semearVaga();
    await banco().insert(jobPage).values({
      jobId: vagaId,
      finalUrl: `https://${IP_PUBLICO}/vaga/1`,
      httpStatus: 200,
      html: PAGINA,
      contentHash: "hash",
      bytes: PAGINA.length,
      fetchedAt: new Date().toISOString(),
    });

    const semRefresh = await rodar("scrape", "queue", "--min-fit", "0");
    const comRefresh = await rodar("scrape", "queue", "--min-fit", "0", "--refresh");

    // Sem `--refresh` o robô nunca rebaixaria uma página já capturada; com ele,
    // é o caminho de quem quer a versão de hoje de um anúncio que mudou.
    expect(semRefresh.out).toContain("0 na fila");
    expect(comRefresh.out).toContain("1 na fila");
  });
});

/* ----------------------------------- run ---------------------------------- */

describe("jho scrape run", () => {
  it("roda os dois estágios e transforma a página capturada em descrição", async () => {
    const vagaId = await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");
    const { impl } = fetcherFixo();
    vi.stubGlobal("fetch", impl);

    const r = await rodar("scrape", "run");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Capturando com 4 worker(s)");
    expect(r.out).toContain("captura · 1 guardada(s)");
    expect(r.out).toContain("tratamento · 1 descrição(ões)");

    const [pagina] = await banco().select().from(jobPage).where(eq(jobPage.jobId, vagaId));
    expect(pagina?.text).toContain("retrieval augmented generation");
    expect(pagina?.parsedAt).not.toBeNull();
    const [vaga] = await banco().select().from(job).where(eq(job.id, vagaId));
    // O texto raspado preenche a lacuna da fonte. Sem isso a captura seria
    // trabalho guardado num canto que o scorer nunca lê.
    expect(vaga?.descriptionText).toContain("retrieval augmented generation");
  });

  it("avisa que a nota ficou velha quando o tratamento deu descrição nova", async () => {
    await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");
    vi.stubGlobal("fetch", fetcherFixo().impl);

    const r = await rodar("scrape", "run");

    // Ganhar descrição invalida a nota: o componente de palavra-chave foi
    // calculado contra nada. Sem o aviso, o ranking segue mostrando a nota
    // antiga como se fosse a de hoje.
    expect(r.out).toContain("jho jobs score");
    expect(await banco().select().from(jobScore)).toHaveLength(0);
  });

  it("`--fetch-only` guarda a página e não trata — o tratamento é de graça e vem depois", async () => {
    const vagaId = await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");
    vi.stubGlobal("fetch", fetcherFixo().impl);

    const r = await rodar("scrape", "run", "--fetch-only");

    expect(r.out).toContain("captura · 1 guardada(s)");
    expect(r.out).not.toContain("tratamento");
    const [pagina] = await banco().select().from(jobPage).where(eq(jobPage.jobId, vagaId));
    // `parsedAt` nulo é o marcador de "aguardando o estágio dois".
    expect(pagina?.parsedAt).toBeNull();
  });

  it("`--parse-only` não abre requisição nenhuma", async () => {
    await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");
    const { impl, calls } = fetcherFixo();
    vi.stubGlobal("fetch", impl);
    await rodar("scrape", "run", "--fetch-only");
    calls.length = 0;

    const r = await rodar("scrape", "run", "--parse-only");

    expect(r.out).not.toContain("Capturando");
    expect(r.out).toContain("tratamento · 1 descrição(ões)");
    // O ponto inteiro de separar os estágios: melhorar o extrator reprocessa o
    // acervo sem baixar um byte. Provar isso exige provar o negativo.
    expect(calls).toEqual([]);
  });

  it("`-n` chega como número e limita as páginas da rodada", async () => {
    await semearVaga({ caminho: "/a" });
    await semearVaga({ caminho: "/b" });
    await semearVaga({ caminho: "/c" });
    await rodar("scrape", "queue", "--min-fit", "0");
    const { impl, calls } = fetcherFixo();
    vi.stubGlobal("fetch", impl);

    await rodar("scrape", "run", "--fetch-only", "-c", "1", "-n", "1");

    // O teto existe para quem quer um lote pequeno e controlado contra site de
    // terceiro. Sem `Number()`, `claimed >= "1"` compara texto e o teto evapora.
    expect(calls).toHaveLength(1);
    const tarefas = await banco().select().from(scrapeTask);
    expect(tarefas.filter((t) => t.status === "pending")).toHaveLength(2);
  });

  it("página proibida por robots.txt conta como bloqueada, não como falha", async () => {
    await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");
    setHttpPort(fixtureHttp({ "robots.txt": "User-agent: *\nDisallow: /" }));
    const { impl, calls } = fetcherFixo();
    vi.stubGlobal("fetch", impl);

    const r = await rodar("scrape", "run", "--fetch-only");

    expect(r.out).toContain("1 bloqueada(s) por robots.txt");
    // Bloqueado é resposta final do site, não erro a repetir — e a prova de que
    // foi respeitado é que a página nem chegou a ser pedida.
    expect(calls).toEqual([]);
    const [tarefa] = await banco().select().from(scrapeTask);
    expect(tarefa?.status).toBe("blocked");
  });

  it("404 vira falha registrada, e `retry` a devolve para a fila", async () => {
    await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");
    vi.stubGlobal("fetch", fetcherFixo(404).impl);

    const captura = await rodar("scrape", "run", "--fetch-only");
    const situacao = await rodar("scrape", "status");
    const devolvida = await rodar("scrape", "retry");

    expect(captura.out).toContain("1 falha(s)");
    expect(situacao.out).toMatch(/failed\s+1/);
    // `retry` é o comando de depois de consertar o extrator ou o site voltar:
    // sem ele, a única saída seria mexer em SQL.
    expect(devolvida.out).toContain("1 tarefa(s) de volta à fila");
    const [tarefa] = await banco().select().from(scrapeTask);
    expect(tarefa?.status).toBe("pending");
  });

  it("`retry` sem falha nenhuma devolve zero em vez de reclamar", async () => {
    const r = await rodar("scrape", "retry");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("0 tarefa(s) de volta à fila");
  });
});

/* -------------------------------- reparse --------------------------------- */

describe("jho scrape reparse", () => {
  it("reprocessa toda página guardada sem baixar de novo", async () => {
    const vagaId = await semearVaga();
    await rodar("scrape", "queue", "--min-fit", "0");
    const { impl, calls } = fetcherFixo();
    vi.stubGlobal("fetch", impl);
    await rodar("scrape", "run");
    // Apaga o resultado do tratamento para o reprocessamento ter o que fazer —
    // é o estado em que um extrator novo encontraria o acervo.
    await banco().update(jobPage).set({ text: null, parsedAt: null }).where(eq(jobPage.jobId, vagaId));
    calls.length = 0;

    const r = await rodar("scrape", "reparse");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("1 reprocessada(s)");
    // A promessa do comando é literal: "sem baixar de novo".
    expect(calls).toEqual([]);
    const [pagina] = await banco().select().from(jobPage).where(eq(jobPage.jobId, vagaId));
    expect(pagina?.text).toContain("retrieval augmented generation");
  });

  it("página sem texto utilizável é contada como falha, não reprocessada em silêncio", async () => {
    const vagaId = await semearVaga();
    await banco().insert(jobPage).values({
      jobId: vagaId,
      finalUrl: `https://${IP_PUBLICO}/vaga/1`,
      httpStatus: 200,
      html: "<html><body><p>curta</p></body></html>",
      contentHash: "hash",
      bytes: 40,
      fetchedAt: new Date().toISOString(),
    });

    const r = await rodar("scrape", "reparse");

    // Página de 40 caracteres não é anúncio; contar como sucesso faria o
    // número de "descrições" do sistema incluir lixo.
    expect(r.out).toContain("0 reprocessada(s)");
    expect(r.out).toContain("1 sem texto");
  });

  it("sem página nenhuma capturada, não inventa trabalho", async () => {
    const r = await rodar("scrape", "reparse");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("0 reprocessada(s)");
  });
});
