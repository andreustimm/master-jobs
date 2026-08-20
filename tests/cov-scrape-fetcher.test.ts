// Suite: estágio de captura do scraper (src/core/scrape/fetcher.ts)
// Invariante: este worker não interpreta nada. Ele guarda a página verbatim, e é
// essa separação que permite reprocessar 6.000 páginas com um extrator melhor sem
// baixar um byte de novo. O que ele decide é apenas: dá para buscar? deu certo?
// vale repetir? — e cada uma dessas três respostas tem custo real do outro lado.
// Fronteira DENTRO: validação de destino, robots, limites de tamanho, gravação da
// página e a contabilidade do estágio.
// Fronteira FORA: extração (parser.ts) e a rede — `fetcher` e `lookupHost` são
// injetados, e robots.txt vem da porta HTTP.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { job, jobPage, source } from "../src/core/db/schema.ts";
import { capture, resetHostThrottle, runFetchStage } from "../src/core/scrape/fetcher.ts";
import { clearRobotsCache } from "../src/core/scrape/robots.ts";
import type { ClaimedTask, QueuePort, ScrapeStatus } from "../src/core/scrape/queue.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import type { LookupHost } from "../src/core/remote-url.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/** Endereço público: nenhum DNS real é consultado. */
const PUBLICO: LookupHost = async () => [{ address: "93.184.216.34", family: 4 }];
/** Loopback: exatamente o destino que a política de saída existe para recusar. */
const LOOPBACK: LookupHost = async () => [{ address: "127.0.0.1", family: 4 }];

let db: DB;

async function seedJob(url: string): Promise<number> {
  await db
    .insert(source)
    .values({ id: "careers:acme", kind: "careers", handle: "acme", label: "Acme" })
    .onConflictDoNothing();
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "careers:acme",
      companyName: "Acme",
      externalId: url,
      title: "Staff Engineer",
      url,
      fingerprint: `fp-${url}`,
      contentHash: `ch-${url}`,
      raw: "{}",
    })
    .returning({ id: job.id });
  return row!.id;
}

async function task(url: string, attempts = 0): Promise<ClaimedTask> {
  return { id: 1, jobId: await seedJob(url), url, attempts };
}

/** Dublê de `fetch` que devolve sempre a mesma resposta e conta as chamadas. */
function fetcherFixo(response: Response | Error): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    calls.push(String(input));
    if (response instanceof Error) throw response;
    const clone = response.clone();
    // `clone()` não carrega a `url` encenada, e é justamente ela que representa
    // o redirecionamento neste teste.
    if (response.url) Object.defineProperty(clone, "url", { value: response.url });
    return clone;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function html(body: string, init: ResponseInit = {}, finalUrl?: string): Response {
  const res = new Response(body, { status: 200, ...init });
  // `Response` construído tem `url` vazia; o fetcher usa isso para saber se houve
  // redirecionamento, então o teste precisa poder encená-lo.
  if (finalUrl) Object.defineProperty(res, "url", { value: finalUrl });
  return res;
}

beforeEach(async () => {
  db = await useTestDb();
  clearRobotsCache();
  // O intervalo entre requisições ao mesmo host é estado de módulo; sem zerar,
  // o segundo teste da suíte pagaria o atraso combinado pelo primeiro.
  resetHostThrottle();
  // `Crawl-delay: 0` mantém o teste rápido sem desligar a checagem de robots.
  setHttpPort(fixtureHttp({ "/robots.txt": "User-agent: *\nCrawl-delay: 0\nDisallow: /admin" }));
});

afterEach(() => {
  releaseTestDb();
  resetHttpPort();
});

describe("capture", () => {
  it("recusa uma URL que nem chega a ser URL, sem tentar de novo", async () => {
    // Repetir uma string malformada quatro vezes com backoff é fila parada por
    // um dado que nunca vai melhorar sozinho.
    const { impl, calls } = fetcherFixo(html("<p>x</p>"));
    const outcome = await capture(await task("nao-e-url"), { fetcher: impl, lookupHost: PUBLICO });

    expect(outcome).toEqual({
      kind: "failed",
      reason: "URL inválida: nao-e-url",
      retryable: false,
    });
    expect(calls).toEqual([]);
  });

  it("bloqueia destino que resolve para dentro da máquina", async () => {
    // SSRF: uma URL de vaga vem de fora da fronteira de confiança e pode apontar
    // para localhost ou para o endpoint de metadados da nuvem.
    const { impl, calls } = fetcherFixo(html("<p>segredo</p>"));
    const outcome = await capture(await task("https://interno.test/vaga"), {
      fetcher: impl,
      lookupHost: LOOPBACK,
    });

    expect(outcome).toEqual({ kind: "blocked", reason: "destino de rede não permitido" });
    expect(calls).toEqual([]);
  });

  it("bloqueia o que robots.txt proíbe e não busca assim mesmo", async () => {
    // A regra da ADR 0001 asseverada, não confiada: `blocked` é resultado
    // correto, não falha a repetir.
    const { impl, calls } = fetcherFixo(html("<p>x</p>"));
    const outcome = await capture(await task("https://acme.test/admin/vaga"), {
      fetcher: impl,
      lookupHost: PUBLICO,
    });

    expect(outcome).toEqual({ kind: "blocked", reason: "robots.txt não permite" });
    expect(calls).toEqual([]);
  });

  it("classifica 404 como definitivo e 429/5xx como temporário", async () => {
    // Repetir um 404 só incomoda o servidor e atrasa a fila; desistir de um 429
    // perde a página por uma janela de segundos.
    const casos: Array<[number, boolean]> = [
      [404, false],
      [403, false],
      [429, true],
      [500, true],
      [503, true],
    ];

    for (const [status, retryable] of casos) {
      resetHostThrottle();
      const { impl } = fetcherFixo(new Response("", { status }));
      const outcome = await capture(await task(`https://acme.test/vaga-${status}`), {
        fetcher: impl,
        lookupHost: PUBLICO,
      });
      expect(outcome, `status ${status}`).toEqual({
        kind: "failed",
        reason: `HTTP ${status}`,
        retryable,
      });
    }
  });

  it("recusa pelo content-length antes de ler o corpo", async () => {
    // Ler três megabytes para depois descartar é desperdício de banda e de
    // memória num worker que roda quatro em paralelo.
    const { impl } = fetcherFixo(
      html("pequeno", { headers: { "content-length": "9000000" } }),
    );
    const outcome = await capture(await task("https://acme.test/gigante"), {
      fetcher: impl,
      lookupHost: PUBLICO,
    });

    expect(outcome).toMatchObject({ kind: "failed", retryable: false });
    expect((outcome as { reason: string }).reason).toContain("9000000B");
  });

  it("recusa o corpo grande demais mesmo sem content-length", async () => {
    // Servidor que não declara tamanho é comum; a segunda checagem é a que de
    // fato protege o banco.
    const { impl } = fetcherFixo(html("x".repeat(3_000_001)));
    const outcome = await capture(await task("https://acme.test/sem-tamanho"), {
      fetcher: impl,
      lookupHost: PUBLICO,
    });

    expect(outcome).toMatchObject({ kind: "failed", retryable: false });
    expect((outcome as { reason: string }).reason).toContain("3000001B");
  });

  it("trata falha de transporte como temporária", async () => {
    // Cabo solto não é prova de que a vaga sumiu — só 404 e 410 são.
    const { impl } = fetcherFixo(new TypeError("fetch failed"));
    const outcome = await capture(await task("https://acme.test/erro"), {
      fetcher: impl,
      lookupHost: PUBLICO,
    });

    expect(outcome).toEqual({ kind: "failed", reason: "fetch failed", retryable: true });
  });

  it("guarda a página verbatim, com a URL final e sem marcar como interpretada", async () => {
    // `parsedAt: null` é o que enfileira a página para o estágio dois. A URL
    // final importa porque redirecionamento muda a identidade do anúncio.
    const corpo = "<html><body><h1>Staff Engineer</h1></body></html>";
    const { impl } = fetcherFixo(html(corpo, {}, "https://acme.test/vagas/staff-engineer-final"));
    const t = await task("https://acme.test/vagas/staff-engineer");

    const outcome = await capture(t, { fetcher: impl, lookupHost: PUBLICO });
    expect(outcome).toEqual({ kind: "stored", bytes: corpo.length, status: 200 });

    const [page] = await db.select().from(jobPage).where(eq(jobPage.jobId, t.jobId));
    expect(page!.html).toBe(corpo);
    expect(page!.finalUrl).toBe("https://acme.test/vagas/staff-engineer-final");
    expect(page!.bytes).toBe(corpo.length);
    expect(page!.contentHash).toHaveLength(32);
    expect(page!.parsedAt).toBeNull();
    expect(page!.text).toBeNull();
  });

  it("recaptura sobrescreve a página e devolve ela ao estágio de interpretação", async () => {
    // Recaptura sem zerar `parsedAt` deixaria o texto antigo colado a um HTML
    // novo — a pior combinação possível, porque parece consistente.
    const t = await task("https://acme.test/vagas/muda");

    const primeira = fetcherFixo(html("<p>versão um</p>", {}, ""));
    await capture(t, { fetcher: primeira.impl, lookupHost: PUBLICO });
    await db.update(jobPage).set({ parsedAt: "2026-08-01T00:00:00Z", text: "texto velho" });

    resetHostThrottle();
    const segunda = fetcherFixo(html("<p>versão dois</p>"));
    await capture(t, { fetcher: segunda.impl, lookupHost: PUBLICO });

    const rows = await db.select().from(jobPage).where(eq(jobPage.jobId, t.jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.html).toBe("<p>versão dois</p>");
    expect(rows[0]!.parsedAt).toBeNull();
    expect(rows[0]!.text).toBeNull();
    // Sem `url` na resposta, a URL pedida é a que vale.
    expect(rows[0]!.finalUrl).toBe("https://acme.test/vagas/muda");
  });

  it("serializa requisições ao mesmo host pelo Crawl-delay declarado", async () => {
    // Paralelismo é o que torna a varredura rápida; paralelismo apontado para um
    // host é o que faz o IP ser banido.
    setHttpPort(fixtureHttp({ "/robots.txt": "User-agent: *\nCrawl-delay: 0.12" }));
    clearRobotsCache();
    resetHostThrottle();

    const { impl } = fetcherFixo(html("<p>ok</p>"));
    const t1 = await task("https://lento.test/vagas/um");
    const t2 = await task("https://lento.test/vagas/dois");

    const inicio = Date.now();
    await capture(t1, { fetcher: impl, lookupHost: PUBLICO });
    await capture(t2, { fetcher: impl, lookupHost: PUBLICO });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(100);
  });
});

describe("runFetchStage", () => {
  /** Fila em memória: o estágio é testado sem SQL e sem corrida de claim. */
  function filaComTarefas(tarefas: ClaimedTask[]): QueuePort & {
    completed: Array<[number, ScrapeStatus]>;
    failed: Array<[number, string, boolean]>;
  } {
    const pendentes = [...tarefas];
    const completed: Array<[number, ScrapeStatus]> = [];
    const failed: Array<[number, string, boolean]> = [];
    return {
      completed,
      failed,
      async claim(status) {
        return status === "pending" ? (pendentes.shift() ?? null) : null;
      },
      async complete(id, next) {
        completed.push([id, next]);
      },
      async fail(id, error, retryable) {
        failed.push([id, error, retryable]);
      },
      async stats() {
        return {};
      },
    };
  }

  it("encaminha cada desfecho para o estado certo da fila", async () => {
    // Os três desfechos são tratados de forma diferente de propósito: `blocked`
    // não volta para a fila, `failed` volta conforme a política de retentativa.
    const guardada = await task("https://acme.test/vagas/ok");
    const proibida = await task("https://acme.test/admin/proibida");
    const quebrada = await task("https://acme.test/vagas/erro");

    let chamada = 0;
    const impl = (async () => {
      chamada++;
      return chamada === 1
        ? html("<p>conteúdo</p>")
        : new Response("", { status: 500 });
    }) as unknown as typeof fetch;

    const fila = filaComTarefas([guardada, proibida, quebrada]);
    const resultado = await runFetchStage({
      queue: fila,
      fetcher: impl,
      lookupHost: PUBLICO,
      concurrency: 1,
    });

    expect(resultado).toEqual({ processed: 3, stored: 1, blocked: 1, failed: 1 });
    expect(fila.completed).toEqual([
      [guardada.id, "fetched"],
      [proibida.id, "blocked"],
    ]);
    expect(fila.failed).toEqual([[quebrada.id, "HTTP 500", true]]);
  });

  it("para no limite pedido em vez de esvaziar a fila", async () => {
    // O limite é o que permite rodar um lote pequeno para conferir o resultado
    // antes de soltar a varredura inteira.
    const tarefas = [
      await task("https://acme.test/vagas/a"),
      await task("https://acme.test/vagas/b"),
      await task("https://acme.test/vagas/c"),
    ];
    const { impl } = fetcherFixo(html("<p>ok</p>"));
    const fila = filaComTarefas(tarefas);

    const resultado = await runFetchStage({
      queue: fila,
      fetcher: impl,
      lookupHost: PUBLICO,
      concurrency: 1,
      limit: 2,
    });
    expect(resultado.processed).toBe(2);
  });

  it("trata concorrência zero como um worker, não como nenhum", async () => {
    // `concurrency: 0` seria um estágio que roda e não processa nada — falha
    // silenciosa que pareceria fila vazia.
    const fila = filaComTarefas([await task("https://acme.test/vagas/unica")]);
    const { impl } = fetcherFixo(html("<p>ok</p>"));

    const resultado = await runFetchStage({
      queue: fila,
      fetcher: impl,
      lookupHost: PUBLICO,
      concurrency: 0,
    });
    expect(resultado.processed).toBe(1);
  });

  it("com limite zero não toca na fila padrão nem na rede", async () => {
    // Exercita os padrões de `queue` e `fetcher` sem abrir conexão: é a garantia
    // de que "nada a fazer" custa nada.
    await expect(runFetchStage({ limit: 0 })).resolves.toEqual({
      processed: 0,
      stored: 0,
      blocked: 0,
      failed: 0,
    });
  });
});

describe("cortesia com o host", () => {
  it("aplica o intervalo padrão quando robots.txt não declara Crawl-delay", async () => {
    // A maioria dos sites não declara nada, e é justamente aí que o padrão de um
    // segundo entre requisições evita que a varredura pareça um ataque.
    setHttpPort(fixtureHttp({ "/robots.txt": "User-agent: *" }));
    clearRobotsCache();
    resetHostThrottle();

    const { impl } = fetcherFixo(html("<p>ok</p>"));
    const inicio = Date.now();
    const outcome = await capture(await task("https://sem-delay.test/vagas/uma"), {
      fetcher: impl,
      lookupHost: PUBLICO,
    });

    expect(outcome.kind).toBe("stored");
    // A primeira requisição ao host não paga espera: o intervalo é entre duas.
    expect(Date.now() - inicio).toBeLessThan(500);
  });
});
