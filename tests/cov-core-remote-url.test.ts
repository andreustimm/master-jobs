import { describe, expect, it, vi } from "vitest";
import {
  assertSafeRemoteUrl,
  isGloballyRoutableAddress,
  safeRemoteFetch,
  UnsafeRemoteUrlError,
  type LookupHost,
} from "../src/core/remote-url.ts";

/** Um endereço público de verdade, para o caminho feliz não depender de DNS. */
const RESOLVE_PUBLICO: LookupHost = async () => [{ address: "93.184.216.34", family: 4 }];

async function motivoDaRecusa(executar: () => Promise<unknown>): Promise<string> {
  try {
    await executar();
  } catch (erro) {
    expect(erro).toBeInstanceOf(UnsafeRemoteUrlError);
    return (erro as UnsafeRemoteUrlError).message;
  }
  throw new Error("esperava recusa e a chamada passou");
}

/**
 * A URL de uma vaga vem de fora da fronteira de confiança: chega por API de
 * board, por importação de arquivo, por formulário. Quando o SERVIDOR busca
 * essa URL, ele empresta a própria posição de rede — é o que torna SSRF
 * possível. Por isso a política é de lista de permissão por endereço, não de
 * lista de bloqueio por texto.
 */
describe("assertSafeRemoteUrl: recusas antes de qualquer resolução", () => {
  it("recusa entrada que nem sequer é URL", async () => {
    // A string chega de coluna de banco, então "" e "javascript:" convivem
    // com URLs válidas na mesma consulta.
    expect(await motivoDaRecusa(() => assertSafeRemoteUrl("não é url"))).toContain(
      "formato inválido",
    );
    expect(await motivoDaRecusa(() => assertSafeRemoteUrl(""))).toContain("formato inválido");
  });

  it("recusa esquema que não seja HTTP(S)", async () => {
    // `file:` leria o disco do servidor e `manual://` é identidade de banco,
    // não destino de navegação — os dois passariam por `new URL()` sem erro.
    for (const url of ["file:///etc/passwd", "manual://local/abc", "ftp://exemplo.com/x"]) {
      expect(await motivoDaRecusa(() => assertSafeRemoteUrl(url)), url).toContain(
        "somente HTTP(S)",
      );
    }
  });

  it("recusa credencial embutida na URL", async () => {
    // `https://usuario:senha@host/` é sintaxe legítima e vazaria a credencial
    // no cabeçalho Authorization gerado pelo próprio fetch.
    expect(
      await motivoDaRecusa(() =>
        assertSafeRemoteUrl("https://usuario:senha@exemplo.com/vaga", {
          lookupHost: RESOLVE_PUBLICO,
        }),
      ),
    ).toContain("credenciais");
    expect(
      await motivoDaRecusa(() =>
        assertSafeRemoteUrl("https://usuario@exemplo.com/vaga", {
          lookupHost: RESOLVE_PUBLICO,
        }),
      ),
    ).toContain("credenciais");
  });

  it("recusa nome local sem nem consultar o resolvedor", async () => {
    // `.local` é mDNS e `.localhost` é reservado: ambos apontam para dentro
    // da máquina ou da LAN, e o resolvedor confirmaria isso. Barrar por nome
    // evita depender da configuração de DNS de quem roda.
    const resolvedor = vi.fn(RESOLVE_PUBLICO);
    for (const host of ["localhost", "meu.localhost", "impressora.local"]) {
      expect(
        await motivoDaRecusa(() =>
          assertSafeRemoteUrl(`http://${host}/vaga`, { lookupHost: resolvedor }),
        ),
        host,
      ).toContain("host local");
    }
    expect(resolvedor).not.toHaveBeenCalled();
  });

  it("recusa quando o resolvedor falha, em vez de seguir sem resposta", async () => {
    // DNS que estoura não é permissão: sem resposta não há como provar que o
    // destino é público, e "não sei" tem que virar "não".
    expect(
      await motivoDaRecusa(() =>
        assertSafeRemoteUrl("https://vagas.exemplo.test/x", {
          lookupHost: async () => {
            throw new Error("ENOTFOUND");
          },
        }),
      ),
    ).toContain("não pôde ser resolvido");
  });

  it("recusa resolução vazia", async () => {
    expect(
      await motivoDaRecusa(() =>
        assertSafeRemoteUrl("https://vagas.exemplo.test/x", { lookupHost: async () => [] }),
      ),
    ).toContain("rede pública");
  });

  it("aceita IP literal sem consultar o resolvedor", async () => {
    const resolvedor = vi.fn(RESOLVE_PUBLICO);
    await expect(
      assertSafeRemoteUrl("https://93.184.216.34/vaga", { lookupHost: resolvedor }),
    ).resolves.toMatchObject({ hostname: "93.184.216.34" });
    // IPv6 chega entre colchetes na URL e precisa ser desembrulhado antes da
    // classificação, senão "[2606:...]" não é reconhecido como IP nenhum.
    await expect(
      assertSafeRemoteUrl("https://[2606:4700:4700::1111]/vaga", { lookupHost: resolvedor }),
    ).resolves.toMatchObject({ protocol: "https:" });
    expect(resolvedor).not.toHaveBeenCalled();
  });

  it("normaliza o ponto final absoluto do nome antes de classificar", async () => {
    // "localhost." é o mesmo host que "localhost" para o resolvedor, e sem a
    // normalização passaria direto pela verificação de nome local.
    expect(await motivoDaRecusa(() => assertSafeRemoteUrl("http://localhost./x"))).toContain(
      "host local",
    );
  });
});

describe("isGloballyRoutableAddress: só decide sobre endereço", () => {
  it("responde não para o que não é IP", () => {
    // A função é exportada para a lista de bloqueio ficar auditável, então
    // ela recebe entrada arbitrária. Um nome de host não é "roteável" nem
    // "não roteável" — é indecidível, e indecidível é não.
    expect(isGloballyRoutableAddress("exemplo.com")).toBe(false);
    expect(isGloballyRoutableAddress("")).toBe(false);
    expect(isGloballyRoutableAddress("999.999.999.999")).toBe(false);
  });

  it("recusa IPv6 fora do bloco global 2000::/3", () => {
    // Não basta não estar na lista de bloqueio: fora de 2000::/3 o endereço
    // não é unicast global, e a lista de bloqueio nunca vai ser exaustiva.
    expect(isGloballyRoutableAddress("2606:4700:4700::1111")).toBe(true);
    expect(isGloballyRoutableAddress("3fff::1")).toBe(true);
    expect(isGloballyRoutableAddress("4000::1")).toBe(false);
  });
});

/**
 * Redirecionamento é o furo clássico: a URL de partida é pública e o destino
 * não é. Cada salto passa pela mesma verificação da primeira URL.
 */
describe("safeRemoteFetch: cada salto é verificado como se fosse o primeiro", () => {
  it("segue um redirecionamento para destino público e devolve a resposta final", async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const fetchFalso = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(entrada), init: init ?? {} });
      if (chamadas.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://vagas.exemplo.test/vaga/final" },
        });
      }
      return new Response("conteúdo", { status: 200 });
    }) as unknown as typeof fetch;

    const resposta = await safeRemoteFetch(
      "https://vagas.exemplo.test/vaga",
      { method: "GET" },
      { fetchImpl: fetchFalso, lookupHost: RESOLVE_PUBLICO },
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe("conteúdo");
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://vagas.exemplo.test/vaga",
      "https://vagas.exemplo.test/vaga/final",
    ]);
    // `redirect: "manual"` em todo salto: deixar o fetch seguir sozinho é
    // exatamente o que dispensaria a verificação do destino.
    expect(chamadas.every((c) => c.init.redirect === "manual")).toBe(true);
  });

  it("resolve destino relativo contra a URL do salto atual", async () => {
    // `Location: /outro` é legal e comum. Sem resolver contra a URL corrente
    // o `new URL()` estouraria e a busca falharia por motivo errado.
    const vistos: string[] = [];
    const fetchFalso = vi.fn(async (entrada: string | URL | Request) => {
      vistos.push(String(entrada));
      return vistos.length === 1
        ? new Response(null, { status: 301, headers: { location: "/vaga/movida" } })
        : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeRemoteFetch("https://vagas.exemplo.test/vaga", {}, {
      fetchImpl: fetchFalso,
      lookupHost: RESOLVE_PUBLICO,
    });
    expect(vistos[1]).toBe("https://vagas.exemplo.test/vaga/movida");
  });

  it("um 303 vira GET e descarta o corpo", async () => {
    // É o que a especificação manda, e reenviar o corpo do POST para o
    // destino do redirecionamento repetiria um efeito colateral.
    const inits: RequestInit[] = [];
    const fetchFalso = vi.fn(async (_e: string | URL | Request, init?: RequestInit) => {
      inits.push(init ?? {});
      return inits.length === 1
        ? new Response(null, {
            status: 303,
            headers: { location: "https://vagas.exemplo.test/resultado" },
          })
        : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeRemoteFetch(
      "https://vagas.exemplo.test/busca",
      { method: "POST", body: "q=arquiteto" },
      { fetchImpl: fetchFalso, lookupHost: RESOLVE_PUBLICO },
    );

    expect(inits[0]).toMatchObject({ method: "POST", body: "q=arquiteto" });
    expect(inits[1]?.method).toBe("GET");
    expect(inits[1]?.body).toBeUndefined();
  });

  it("um 302 sobre POST também vira GET, seguindo o que os navegadores fazem", async () => {
    const inits: RequestInit[] = [];
    const fetchFalso = vi.fn(async (_e: string | URL | Request, init?: RequestInit) => {
      inits.push(init ?? {});
      return inits.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://vagas.exemplo.test/resultado" },
          })
        : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeRemoteFetch(
      "https://vagas.exemplo.test/busca",
      { method: "post", body: "x" },
      { fetchImpl: fetchFalso, lookupHost: RESOLVE_PUBLICO },
    );
    expect(inits[1]?.method).toBe("GET");
  });

  it("preserva método e corpo num 307, que existe justamente para isso", async () => {
    const inits: RequestInit[] = [];
    const fetchFalso = vi.fn(async (_e: string | URL | Request, init?: RequestInit) => {
      inits.push(init ?? {});
      return inits.length === 1
        ? new Response(null, {
            status: 307,
            headers: { location: "https://vagas.exemplo.test/resultado" },
          })
        : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeRemoteFetch(
      "https://vagas.exemplo.test/busca",
      { method: "POST", body: "q=arquiteto" },
      { fetchImpl: fetchFalso, lookupHost: RESOLVE_PUBLICO },
    );
    expect(inits[1]).toMatchObject({ method: "POST", body: "q=arquiteto" });
  });

  it("descarta credenciais ao atravessar para outra origem", async () => {
    // Segredo emitido para um host não pode viajar para outro só porque o
    // primeiro mandou. É o vazamento que transforma um redirect aberto em
    // roubo de token.
    const inits: RequestInit[] = [];
    const fetchFalso = vi.fn(async (_e: string | URL | Request, init?: RequestInit) => {
      inits.push(init ?? {});
      return inits.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://outro.exemplo.test/vaga" },
          })
        : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeRemoteFetch(
      "https://vagas.exemplo.test/vaga",
      {
        headers: {
          authorization: "Bearer segredo",
          cookie: "sessao=1",
          "proxy-authorization": "Basic x",
          accept: "text/html",
        },
      },
      { fetchImpl: fetchFalso, lookupHost: RESOLVE_PUBLICO },
    );

    const cabecalhos = new Headers(inits[1]?.headers);
    expect(cabecalhos.get("authorization")).toBeNull();
    expect(cabecalhos.get("cookie")).toBeNull();
    expect(cabecalhos.get("proxy-authorization")).toBeNull();
    // O que não é credencial continua indo: negociação de conteúdo não é risco.
    expect(cabecalhos.get("accept")).toBe("text/html");
  });

  it("mantém as credenciais num redirecionamento para a MESMA origem", async () => {
    // Limpar sempre quebraria autenticação legítima em host que redireciona
    // de /vaga para /vaga/ — a distinção é a origem, não o redirecionamento.
    const inits: RequestInit[] = [];
    const fetchFalso = vi.fn(async (_e: string | URL | Request, init?: RequestInit) => {
      inits.push(init ?? {});
      return inits.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://vagas.exemplo.test/vaga/" },
          })
        : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeRemoteFetch(
      "https://vagas.exemplo.test/vaga",
      { headers: { authorization: "Bearer segredo" } },
      { fetchImpl: fetchFalso, lookupHost: RESOLVE_PUBLICO },
    );
    expect(new Headers(inits[1]?.headers).get("authorization")).toBe("Bearer segredo");
  });

  it("devolve o próprio 3xx quando não há `Location` para onde ir", async () => {
    // Sem cabeçalho não há próximo salto. Inventar um destino ou lançar erro
    // esconderia a resposta real do servidor de quem chamou.
    const fetchFalso = vi.fn(
      async () => new Response(null, { status: 302 }),
    ) as unknown as typeof fetch;

    const resposta = await safeRemoteFetch("https://vagas.exemplo.test/vaga", {}, {
      fetchImpl: fetchFalso,
      lookupHost: RESOLVE_PUBLICO,
    });
    expect(resposta.status).toBe(302);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("desiste depois do limite de saltos, em vez de girar para sempre", async () => {
    // Laço de redirecionamento é ataque de exaustão barato: o host devolve
    // 302 eternamente e o processo fica preso.
    let n = 0;
    const fetchFalso = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `https://vagas.exemplo.test/vaga/${++n}` },
        }),
    ) as unknown as typeof fetch;

    expect(
      await motivoDaRecusa(() =>
        safeRemoteFetch("https://vagas.exemplo.test/vaga", {}, {
          fetchImpl: fetchFalso,
          lookupHost: RESOLVE_PUBLICO,
          maxRedirects: 2,
        }),
      ),
    ).toContain("redirecionamentos demais");
    // Três idas: saltos 0 e 1 são seguidos, o de índice 2 é recusado.
    expect(fetchFalso).toHaveBeenCalledTimes(3);
  });

  it("não segue redirecionamento para destino privado", async () => {
    // O caso que dá nome ao módulo: URL pública que aponta para o endpoint de
    // metadados da nuvem.
    const fetchFalso = vi.fn(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    ) as unknown as typeof fetch;

    expect(
      await motivoDaRecusa(() =>
        safeRemoteFetch("https://vagas.exemplo.test/vaga", {}, {
          fetchImpl: fetchFalso,
          lookupHost: RESOLVE_PUBLICO,
        }),
      ),
    ).toContain("rede pública");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
