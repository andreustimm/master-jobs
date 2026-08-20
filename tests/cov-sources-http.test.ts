// Suite: implementação real da porta HTTP das fontes (src/core/sources/http.ts)
// Invariante: são serviços gratuitos de terceiros. Repetir uma chamada que já foi
// recusada por motivo permanente é abuso, e desistir de uma falha temporária é
// perder a fonte por nada. A política de retentativa é essa distinção.
// Fronteira DENTRO: retentativa, cabeçalhos, limite de tamanho, tradução de erro.
// Fronteira FORA: rede real — `globalThis.fetch` é substituído por dublê e as URLs
// usam IP literal público, de modo que nenhuma resolução de DNS acontece.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, firstNonEmpty, getJson, getText, htmlToText } from "../src/core/sources/http.ts";
import { resetHttpPort } from "../src/core/sources/http-port.ts";

/** IP público literal: `assertSafeRemoteUrl` não consulta DNS para literais. */
const URL_OK = "https://93.184.216.34/jobs/api";

type FetchCall = { url: string; init: RequestInit };

/** Dublê de `fetch` que registra o que foi pedido e responde por roteiro. */
function stubFetch(...responses: Array<Response | Error | string>): FetchCall[] {
  const calls: FetchCall[] = [];
  let index = 0;
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index++;
    if (next instanceof Response) return next.clone();
    return Promise.reject(next);
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  // Sai de qualquer dublê deixado por outra suíte: aqui o alvo é a implementação
  // real por trás da porta.
  resetHttpPort();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.JHO_USER_AGENT;
});

describe("getJson", () => {
  it("não repete uma resposta que já é definitiva", async () => {
    // 404 é handle de board errado. Repetir quatro vezes não conserta a
    // configuração e só gasta a cota de quem está nos servindo de graça.
    const calls = stubFetch(json({ erro: "nao existe" }, 404));

    await expect(getJson(URL_OK)).rejects.toMatchObject({
      name: "HttpError",
      status: 404,
      url: URL_OK,
    });
    expect(calls).toHaveLength(1);
  });

  it("repete uma falha temporária e devolve o corpo assim que ela passa", async () => {
    // 503 é o servidor pedindo um instante. Desistir na primeira faria a fonte
    // sumir do relatório por uma indisponibilidade de segundos.
    const calls = stubFetch(json({}, 503), json({ jobs: [{ id: 1 }] }));

    await expect(getJson<{ jobs: unknown[] }>(URL_OK, { retries: 1 })).resolves.toEqual({
      jobs: [{ id: 1 }],
    });
    expect(calls).toHaveLength(2);
  });

  it("desiste depois das retentativas e propaga o último status observado", async () => {
    const calls = stubFetch(json({}, 503));

    const error = await getJson(URL_OK, { retries: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it("propaga uma falha de rede como o próprio erro, sem inventar status", async () => {
    // Erro de transporte não é resposta HTTP; transformá-lo num status faria a
    // sondagem de vaga concluir "ausente" a partir de um cabo solto.
    const calls = stubFetch(new TypeError("connect ECONNREFUSED"));

    await expect(getJson(URL_OK, { retries: 0 })).rejects.toThrow("connect ECONNREFUSED");
    expect(calls).toHaveLength(1);
  });

  it("embrulha em Error um motivo de rejeição que não é Error", async () => {
    // `fetch` de runtime exótico pode rejeitar com string; sem o embrulho o
    // chamador recebe algo sem `.message` e o log da sync fica ilegível.
    stubFetch("desconectado");
    await expect(getJson(URL_OK, { retries: 0 })).rejects.toThrow("desconectado");
  });

  it("se identifica com um user-agent e aceita a substituição por ambiente", async () => {
    // Identificação é o mínimo de educação com um serviço gratuito, e é o que
    // permite ao operador do board nos contatar em vez de nos bloquear.
    const padrao = stubFetch(json({}));
    await getJson(URL_OK);
    expect(String(new Headers(padrao[0]!.init.headers).get("user-agent"))).toContain("job-hunt-os");
    expect(new Headers(padrao[0]!.init.headers).get("accept")).toBe("application/json");

    vi.unstubAllGlobals();
    process.env.JHO_USER_AGENT = "jho-teste/9.9 (contato@example.test)";
    const custom = stubFetch(json({}));
    await getJson(URL_OK);
    expect(new Headers(custom[0]!.init.headers).get("user-agent")).toBe(
      "jho-teste/9.9 (contato@example.test)",
    );
  });

  it("deixa o chamador acrescentar cabeçalhos sem perder os padrões", async () => {
    const calls = stubFetch(json({}));
    await getJson(URL_OK, { headers: { "x-api-key": "segredo" } });
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("x-api-key")).toBe("segredo");
    expect(headers.get("accept")).toBe("application/json");
  });
});

describe("getText", () => {
  it("devolve o HTML da página quando ela responde", async () => {
    stubFetch(new Response("<html><body>vaga</body></html>", { status: 200 }));
    await expect(getText(URL_OK)).resolves.toContain("vaga");
  });

  it("devolve null em vez de lançar quando a página recusa ou some", async () => {
    // Uma careers page que bloqueia é um fato sobre aquela página, não motivo
    // para derrubar a sync inteira — a mesma regra do resto do pipeline.
    stubFetch(new Response("proibido", { status: 403 }));
    await expect(getText(URL_OK)).resolves.toBeNull();
  });

  it("devolve null quando a requisição nem chega a completar", async () => {
    stubFetch(new Error("socket hang up"));
    await expect(getText(URL_OK)).resolves.toBeNull();
  });

  it("recusa um corpo grande demais para ser uma vaga", async () => {
    // Três megabytes de HTML é dump de site ou página de erro gigante; guardar
    // isso como descrição enche o banco e não acrescenta sinal nenhum.
    stubFetch(new Response("x".repeat(3_000_001), { status: 200 }));
    await expect(getText(URL_OK)).resolves.toBeNull();
  });

  it("pede HTML e se identifica também na leitura de página", async () => {
    const calls = stubFetch(new Response("ok", { status: 200 }));
    await getText(URL_OK, { headers: { cookie: "" } });
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("accept")).toContain("text/html");
    expect(headers.get("user-agent")).toBeTruthy();
  });
});

describe("firstNonEmpty", () => {
  it("pula string vazia e string só de espaço, que `??` deixaria passar", () => {
    // A razão de a função existir: `a ?? b` só cai em null/undefined, e vários
    // boards devolvem "" para o campo que não preencheram.
    expect(firstNonEmpty("", "   ", "conteúdo real")).toBe("conteúdo real");
    expect(firstNonEmpty(null, undefined, "")).toBeNull();
    expect(firstNonEmpty()).toBeNull();
  });
});

describe("htmlToText", () => {
  it("converte a estrutura do anúncio em texto legível pelo scorer", () => {
    const out = htmlToText(
      "<div><h2>Requisitos</h2><ul><li>Kubernetes</li><li>Terraform</li></ul>" +
        "<script>rastreador()</script><style>.x{}</style><p>Fim &amp; pronto.</p></div>",
    );
    expect(out).toContain("- Kubernetes");
    // Script e style entrariam como palavras e distorceriam a frequência.
    expect(out).not.toContain("rastreador");
    expect(out).not.toContain(".x{");
    expect(out).toContain("Fim & pronto.");
  });

  it("decodifica entidade numérica e quebra de linha explícita", () => {
    expect(htmlToText("a<br>b&#38;c")).toBe("a\nb&c");
  });

  it("devolve null para ausência e para HTML que não tem texto algum", () => {
    // "" derrotaria todo `??` a jusante; ausência precisa ser nula de verdade.
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText(undefined)).toBeNull();
    expect(htmlToText("")).toBeNull();
    expect(htmlToText("<div><span>   </span></div>")).toBeNull();
  });
});
