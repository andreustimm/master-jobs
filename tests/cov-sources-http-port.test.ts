// Suite: a porta HTTP em si (src/core/sources/http-port.ts)
// Invariante: a injeção é de escopo de módulo, então o estado de quem está no ar
// é global ao processo de teste. Este arquivo importa SOMENTE `http-port.ts` — e
// nada que o alcance transitivamente — porque a única forma de observar o estado
// inicial (nenhuma implementação registrada) é num módulo que ninguém inicializou.
// Fronteira DENTRO: troca de implementação e o dublê `fixtureHttp`.
// Fronteira FORA: a implementação real, coberta por cov-sources-http.test.ts.
import { describe, expect, it } from "vitest";
import {
  fixtureHttp,
  http,
  registerRealPort,
  resetHttpPort,
  setHttpPort,
  type HttpPort,
} from "../src/core/sources/http-port.ts";

const inerte: HttpPort = {
  async json<T>(): Promise<T> {
    return {} as T;
  },
  async text(): Promise<string | null> {
    return null;
  },
};

describe("troca de implementação", () => {
  // Este caso depende de rodar antes dos outros do arquivo: é o único momento em
  // que o módulo ainda não tem implementação nenhuma.
  it("falha alto quando ninguém registrou implementação, em vez de sair na rede", () => {
    // O modo de falha que isto evita: um `fetch` real disparado de dentro de um
    // teste porque o módulo caiu num padrão silencioso.
    expect(() => http()).toThrow("HTTP port não inicializada");
  });

  it("passa a responder pela implementação injetada", () => {
    setHttpPort(inerte);
    expect(http()).toBe(inerte);
  });

  it("volta para a implementação real ao ser resetada", () => {
    // É o que faz um `afterEach(resetHttpPort)` devolver o processo ao estado de
    // produção, e não ao dublê da suíte anterior.
    registerRealPort(inerte);
    const dublê = fixtureHttp({});
    setHttpPort(dublê);
    expect(http()).toBe(dublê);
    resetHttpPort();
    expect(http()).toBe(inerte);
  });

  it("não desfaz uma injeção em curso ao registrar a implementação real", () => {
    // `http.ts` registra a real na hora do import, que pode acontecer DEPOIS de
    // um `setHttpPort` no topo do teste. Registrar não pode roubar a porta.
    const dublê = fixtureHttp({});
    setHttpPort(dublê);
    registerRealPort(inerte);
    expect(http()).toBe(dublê);
    resetHttpPort();
  });
});

describe("fixtureHttp", () => {
  it("casa por substring, para o teste não repetir a query inteira", async () => {
    // O adapter acrescenta parâmetros próprios à URL; exigir a URL completa
    // faria o teste falhar por mudança de paginação em vez de comportamento.
    const port = fixtureHttp({ "boards-api.greenhouse.io": { jobs: [] } });
    await expect(port.json("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true"))
      .resolves.toEqual({ jobs: [] });
  });

  it("prefere a chave exata à busca por substring", async () => {
    const port = fixtureHttp({
      "https://acme.test/a": { qual: "exata" },
      "acme.test": { qual: "substring" },
    });
    await expect(port.json("https://acme.test/a")).resolves.toEqual({ qual: "exata" });
    await expect(port.json("https://acme.test/b")).resolves.toEqual({ qual: "substring" });
  });

  it("registra toda URL pedida, inclusive a que não tem fixture", async () => {
    // É esse registro que permite provar o negativo — que uma página proibida
    // por robots.txt não foi buscada mesmo assim.
    const port = fixtureHttp({});
    await port.text("https://acme.test/robots.txt");
    await expect(port.json("https://acme.test/x")).rejects.toThrow("Sem fixture");
    expect(port.calls).toEqual(["https://acme.test/robots.txt", "https://acme.test/x"]);
  });

  it("distingue ausência de fixture entre JSON e texto, como a rede faz", async () => {
    // `json` lança porque um adapter sem resposta é falha de fonte; `text`
    // devolve null porque página ilegível é fato sobre a página, não erro.
    const port = fixtureHttp({});
    await expect(port.json("https://acme.test/x")).rejects.toThrow();
    await expect(port.text("https://acme.test/x")).resolves.toBeNull();
  });

  it("simula um status de erro nos dois modos de leitura", async () => {
    const port = fixtureHttp({ "acme.test/500": { status: 500 } });
    await expect(port.json("https://acme.test/500")).rejects.toThrow("HTTP 500");
    await expect(port.text("https://acme.test/500")).resolves.toBeNull();
  });

  it("aceita corpo em texto ou em objeto, com e sem status explícito", async () => {
    const port = fixtureHttp({
      "acme.test/texto": '{"a":1}',
      "acme.test/objeto": { a: 2 },
      "acme.test/status-texto": { status: 200, body: '{"a":3}' },
      "acme.test/status-objeto": { status: 200, body: { a: 4 } },
    });
    await expect(port.json("https://acme.test/texto")).resolves.toEqual({ a: 1 });
    await expect(port.json("https://acme.test/objeto")).resolves.toEqual({ a: 2 });
    await expect(port.json("https://acme.test/status-texto")).resolves.toEqual({ a: 3 });
    await expect(port.json("https://acme.test/status-objeto")).resolves.toEqual({ a: 4 });

    await expect(port.text("https://acme.test/texto")).resolves.toBe('{"a":1}');
    // Objeto lido como texto vira JSON serializado: é o que uma API que devolve
    // JSON num `getText` produziria de verdade.
    await expect(port.text("https://acme.test/objeto")).resolves.toBe('{"a":2}');
    await expect(port.text("https://acme.test/status-texto")).resolves.toBe('{"a":3}');
    await expect(port.text("https://acme.test/status-objeto")).resolves.toBe('{"a":4}');
  });
});
