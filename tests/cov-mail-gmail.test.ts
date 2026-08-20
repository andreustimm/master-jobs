/**
 * Gmail como fonte de e-mail (F-01) — o caminho HTTP inteiro, sem rede.
 *
 * Todo o `src/core/mail/gmail.ts` fala com o Google por `fetch` e com o disco
 * por `fs/promises`. Testar isso exige dublê nos dois lados, e é exatamente por
 * isso que a maior parte do arquivo estava descoberta: a parte barata (PKCE,
 * URL de consentimento) já tinha teste, a parte que guarda uma credencial de
 * longa duração e escreve arquivos no disco do usuário não tinha.
 *
 * Aqui `fetch` é substituído por um roteador em memória e `root` aponta para um
 * diretório temporário — nenhuma credencial real, nenhuma requisição real. O
 * único socket que abre é o de loopback do próprio fluxo de consentimento, que
 * é justamente o comportamento sob teste.
 */
import { get } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_QUERY,
  TOKEN_FILE,
  accessToken,
  authorize,
  exchangeCode,
  fetchToDir,
  readToken,
  tokenPath,
  type StoredToken,
} from "../src/core/mail/gmail.ts";

const CREDS = { clientId: "id.apps.googleusercontent.com", clientSecret: "s3cr3t" };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jho-gmail-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

/** Corpo JSON pronto, do jeito que `fetch` devolve. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Roteia por prefixo de URL. Declarar a rota como função (e não valor fixo)
 * deixa cada teste responder diferente por mensagem, que é o que distingue
 * "já baixado" de "baixado agora".
 */
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(routes: Array<[string, Route]>): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error(`rota não esperada no teste: ${url}`);
    return hit[1](url, init);
  });
  return { calls };
}

/** GET de loopback de verdade — o servidor de callback é o objeto sob teste. */
function hitLoopback(url: string): Promise<void> {
  return new Promise((done) => {
    get(url, (res) => {
      res.resume();
      res.on("end", () => done());
    }).on("error", () => done());
  });
}

/* ------------------------------------------------------------ token file -- */

describe("armazenamento do token", () => {
  it("resolve o caminho dentro da raiz recebida, não do cwd do processo", () => {
    // O parâmetro `root` existe para o teste não escrever no repositório do
    // usuário. Se ele fosse ignorado, este arquivo criaria `.gmail.token.json`
    // na raiz do projeto a cada execução.
    expect(tokenPath(root)).toBe(join(root, TOKEN_FILE));
  });

  it("devolve null quando ainda não há token, em vez de estourar", async () => {
    // Primeira execução do usuário: o comando precisa distinguir "nunca
    // autorizou" de "falhou ao ler", e o null é o que dispara a autorização.
    await expect(readToken(root)).resolves.toBeNull();
  });

  it("devolve null quando o arquivo existe mas está corrompido", async () => {
    // Um token truncado por queda de disco não pode derrubar o comando inteiro:
    // reautorizar é sempre possível, e é o que o null provoca.
    await writeFile(tokenPath(root), "{ isto não é json");
    await expect(readToken(root)).resolves.toBeNull();
  });

  it("lê de volta o que foi gravado", async () => {
    await writeFile(tokenPath(root), JSON.stringify({ refresh_token: "r1" }));
    await expect(readToken(root)).resolves.toEqual({ refresh_token: "r1" });
  });
});

/* --------------------------------------------------------- exchangeCode --- */

describe("exchangeCode", () => {
  it("troca o código por um refresh token e calcula o vencimento", async () => {
    stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async (_url, init) => {
          // O segredo do cliente só pode trafegar aqui, no POST
          // servidor-a-servidor — nunca na URL que abre no navegador.
          const body = String(init?.body);
          expect(body).toContain("grant_type=authorization_code");
          expect(body).toContain("code_verifier=verif");
          expect(body).toContain(encodeURIComponent(CREDS.clientSecret));
          return json({ refresh_token: "r-1", access_token: "a-1", expires_in: 3599 });
        },
      ],
    ]);

    const before = Date.now();
    const token = await exchangeCode(CREDS, "code-1", "http://127.0.0.1:1/callback", "verif");

    expect(token.refresh_token).toBe("r-1");
    expect(token.access_token).toBe("a-1");
    expect(token.expires_at).toBeGreaterThanOrEqual(before + 3599_000);
  });

  it("recusa uma resposta sem refresh_token e diz como consertar", async () => {
    // Reautorizar sem `prompt=consent` devolve só o access_token. Aceitar isso
    // gravaria um token que expira em uma hora e nunca mais renova — falha
    // silenciosa que só aparece no dia seguinte.
    stubFetch([
      ["https://oauth2.googleapis.com/token", async () => json({ access_token: "a-1" })],
    ]);

    await expect(
      exchangeCode(CREDS, "code-1", "http://127.0.0.1:1/callback", "verif"),
    ).rejects.toThrow(/myaccount\.google\.com\/permissions/);
  });

  it("propaga a recusa do Google com status e descrição", async () => {
    stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async () => json({ error: "invalid_grant", error_description: "code expirado" }, 400),
      ],
    ]);

    await expect(
      exchangeCode(CREDS, "velho", "http://127.0.0.1:1/callback", "verif"),
    ).rejects.toThrow("Google recusou (400): code expirado");
  });

  it("cai para o campo error quando não há descrição", async () => {
    stubFetch([
      ["https://oauth2.googleapis.com/token", async () => json({ error: "invalid_client" }, 401)],
    ]);

    await expect(
      exchangeCode(CREDS, "x", "http://127.0.0.1:1/callback", "v"),
    ).rejects.toThrow("Google recusou (401): invalid_client");
  });

  it("ainda erra de forma legível quando a resposta não explica nada", async () => {
    // Sem esse fallback a mensagem sairia "Google recusou (500): undefined", que
    // manda o usuário procurar um bug que não é dele.
    stubFetch([["https://oauth2.googleapis.com/token", async () => json({}, 500)]]);

    await expect(
      exchangeCode(CREDS, "x", "http://127.0.0.1:1/callback", "v"),
    ).rejects.toThrow("Google recusou (500): sem detalhe");
  });

  it("aceita resposta sem access_token nem expires_in", async () => {
    // O contrato mínimo do arquivo é o refresh_token; o resto é conveniência.
    stubFetch([
      ["https://oauth2.googleapis.com/token", async () => json({ refresh_token: "r-only" })],
    ]);

    const token = await exchangeCode(CREDS, "c", "http://127.0.0.1:1/callback", "v");
    expect(token).toMatchObject({ refresh_token: "r-only", access_token: undefined });
  });
});

/* ---------------------------------------------------------- accessToken --- */

describe("accessToken", () => {
  it("reaproveita o token em memória sem falar com o Google", async () => {
    const { calls } = stubFetch([]);
    const stored: StoredToken = {
      refresh_token: "r",
      access_token: "ainda-vale",
      expires_at: 1_000_000 + 600_000,
    };

    await expect(accessToken(CREDS, stored, root, 1_000_000)).resolves.toBe("ainda-vale");
    // Renovar sem necessidade gasta cota e, pior, reescreve o arquivo de
    // credencial a cada comando.
    expect(calls).toEqual([]);
  });

  it("renova quando faltam menos de 60s para vencer", async () => {
    // A folga existe porque um `fetch` que começa com o token válido pode
    // terminar depois do vencimento — o erro apareceria no meio de um download.
    stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async (_url, init) => {
          expect(String(init?.body)).toContain("grant_type=refresh_token");
          return json({ access_token: "novo", expires_in: 3600 });
        },
      ],
    ]);
    const stored: StoredToken = {
      refresh_token: "r",
      access_token: "quase-vencido",
      expires_at: 1_000_000 + 30_000,
    };

    await expect(accessToken(CREDS, stored, root, 1_000_000)).resolves.toBe("novo");
  });

  it("renova quando nunca houve access_token e grava o arquivo com modo 0600", async () => {
    stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async () => json({ access_token: "novo", expires_in: 100 }),
      ],
    ]);

    await expect(accessToken(CREDS, { refresh_token: "r" }, root, 5_000)).resolves.toBe("novo");

    const saved = JSON.parse(await readFile(tokenPath(root), "utf8")) as StoredToken;
    // O refresh token sobrevive à renovação: perdê-lo aqui obrigaria o usuário
    // a refazer o consentimento a cada hora.
    expect(saved).toEqual({ refresh_token: "r", access_token: "novo", expires_at: 105_000 });

    // 0600 é o ponto: uma credencial de caixa postal legível por qualquer conta
    // da máquina é o mesmo que não ter credencial.
    const mode = (await stat(tokenPath(root))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

/* ------------------------------------------------------------ authorize --- */

describe("authorize (fluxo de consentimento por loopback)", () => {
  it("completa o fluxo, salva o token e identifica a caixa postal", async () => {
    stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async () => json({ refresh_token: "r-final", access_token: "a-final", expires_in: 3600 }),
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        async (_url, init) => {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          expect(headers.authorization).toBe("Bearer a-final");
          return json({ emailAddress: "andreus@example.test" });
        },
      ],
    ]);

    const result = await authorize(
      CREDS,
      (url) => {
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get("redirect_uri")!;
        const state = parsed.searchParams.get("state")!;
        // O endereço tem de ser loopback: por segundos ele recebe um código de
        // autorização, e `localhost` pode resolver para interface pública.
        expect(new URL(redirect).hostname).toBe("127.0.0.1");
        // Um caminho qualquer antes do callback prova que o servidor não
        // encerra o fluxo com o primeiro GET que aparecer (favicon, prefetch).
        void hitLoopback(`${redirect.replace("/callback", "")}/favicon.ico`).then(() =>
          hitLoopback(`${redirect}?code=code-final&state=${encodeURIComponent(state)}`),
        );
      },
      root,
    );

    expect(result).toEqual({ email: "andreus@example.test", savedTo: tokenPath(root) });
    const saved = JSON.parse(await readFile(tokenPath(root), "utf8")) as StoredToken;
    expect(saved.refresh_token).toBe("r-final");
  });

  it("salva o token mesmo quando a checagem de perfil falha", async () => {
    // A confirmação de qual caixa foi ligada é conveniência. Derrubar o fluxo
    // por causa dela descartaria um refresh_token já emitido — e o usuário
    // teria de revogar o acesso na mão antes de tentar de novo.
    stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async () => json({ refresh_token: "r-final", access_token: "a-final", expires_in: 60 }),
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        async () => {
          throw new Error("rede caiu");
        },
      ],
    ]);

    const result = await authorize(
      CREDS,
      (url) => {
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get("redirect_uri")!;
        const state = parsed.searchParams.get("state")!;
        void hitLoopback(`${redirect}?code=c&state=${encodeURIComponent(state)}`);
      },
      root,
    );

    expect(result.email).toBeUndefined();
    expect(result.savedTo).toBe(tokenPath(root));
    await expect(readToken(root)).resolves.toMatchObject({ refresh_token: "r-final" });
  });

  it("não inventa e-mail quando o Google responde erro no perfil", async () => {
    stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async () => json({ refresh_token: "r", access_token: "a", expires_in: 60 }),
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        async () => json({ error: "forbidden" }, 403),
      ],
    ]);

    const result = await authorize(
      CREDS,
      (url) => {
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get("redirect_uri")!;
        const state = parsed.searchParams.get("state")!;
        void hitLoopback(`${redirect}?code=c&state=${encodeURIComponent(state)}`);
      },
      root,
    );

    expect(result.email).toBeUndefined();
  });

  it("aborta quando o usuário nega o consentimento", async () => {
    stubFetch([]);

    await expect(
      authorize(
        CREDS,
        (url) => {
          const redirect = new URL(url).searchParams.get("redirect_uri")!;
          void hitLoopback(`${redirect}?error=access_denied`);
        },
        root,
      ),
    ).rejects.toThrow("Autorização negada: access_denied");

    // Nada foi gravado: negar consentimento não pode deixar resíduo de token.
    await expect(readToken(root)).resolves.toBeNull();
  });

  it("recusa um callback com state diferente do que iniciou o fluxo", async () => {
    // Este é o teste que justifica o state: a porta de callback é loopback, e
    // qualquer processo local pode tentar completar um fluxo que não começou.
    // Sem essa checagem, um código interceptado bastaria.
    stubFetch([]);

    await expect(
      authorize(
        CREDS,
        (url) => {
          const redirect = new URL(url).searchParams.get("redirect_uri")!;
          void hitLoopback(`${redirect}?code=roubado&state=nao-e-o-meu`);
        },
        root,
      ),
    ).rejects.toThrow("state inválido");
  });

  it("aborta quando o callback chega sem código", async () => {
    stubFetch([]);

    await expect(
      authorize(
        CREDS,
        (url) => {
          const parsed = new URL(url);
          const redirect = parsed.searchParams.get("redirect_uri")!;
          const state = parsed.searchParams.get("state")!;
          void hitLoopback(`${redirect}?state=${encodeURIComponent(state)}`);
        },
        root,
      ),
    ).rejects.toThrow("Google não devolveu code");
  });
});

/* ----------------------------------------------------------- fetchToDir --- */

const VALID: StoredToken = {
  refresh_token: "r",
  access_token: "a-valid",
  expires_at: Date.now() + 3600_000,
};

/** Uma mensagem MIME mínima, codificada como o Gmail devolve em `format=raw`. */
function rawMessage(subject: string): string {
  const eml = [`Subject: ${subject}`, "Content-Type: text/plain", "", "corpo"].join("\n");
  return Buffer.from(eml, "utf8").toString("base64url");
}

describe("fetchToDir", () => {
  it("baixa cada mensagem como .eml e não importa nada", async () => {
    // Gravar arquivo em vez de escrever no banco é decisão de projeto: o
    // usuário lê antes de qualquer coisa tocar o banco, e o import continua
    // valendo sobre o mesmo diretório, com --dry-run.
    stubFetch([
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        async (url) => {
          const parsed = new URL(url);
          expect(parsed.searchParams.get("q")).toBe(DEFAULT_QUERY);
          return json({ messages: [{ id: "m1" }, { id: "m2" }] });
        },
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/",
        async (url) => json({ raw: rawMessage(url.includes("m1") ? "um" : "dois") }),
      ],
    ]);

    const result = await fetchToDir(CREDS, VALID, { outDir: "caixa" }, root);

    expect(result).toMatchObject({ found: 2, written: 2, skipped: 0 });
    expect(result.dir).toBe(join(root, "caixa"));
    await expect(readFile(join(root, "caixa", "m1.eml"), "utf8")).resolves.toContain("Subject: um");
    await expect(readFile(join(root, "caixa", "m2.eml"), "utf8")).resolves.toContain(
      "Subject: dois",
    );
  });

  it("pula o que já está no disco em vez de baixar de novo", async () => {
    // Reexecutar o fetch é o caso comum, não a exceção. Rebaixar tudo queimaria
    // cota do Gmail para produzir bytes idênticos.
    const { calls } = stubFetch([
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        async () => json({ messages: [{ id: "ja-existe" }, { id: "novo" }] }),
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/",
        async () => json({ raw: rawMessage("novo") }),
      ],
    ]);

    const dir = join(root, "data", "mail");
    await fetchToDir(CREDS, VALID, { max: 0 }, root); // só para criar o diretório
    await writeFile(join(dir, "ja-existe.eml"), "conteúdo antigo");

    const result = await fetchToDir(CREDS, VALID, {}, root);

    expect(result).toMatchObject({ found: 2, written: 1, skipped: 1 });
    // O arquivo pré-existente não foi sobrescrito.
    await expect(readFile(join(dir, "ja-existe.eml"), "utf8")).resolves.toBe("conteúdo antigo");
    expect(calls.filter((c) => c.includes("/messages/ja-existe"))).toEqual([]);
  });

  it("segue adiante quando uma mensagem falha ou vem sem corpo bruto", async () => {
    // Uma mensagem que o Gmail recusa não pode abortar o lote inteiro: o valor
    // do comando está nas outras que vieram bem.
    stubFetch([
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        async () => json({ messages: [{ id: "erro" }, { id: "vazio" }, { id: "bom" }] }),
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/",
        async (url) => {
          if (url.includes("erro")) return json({ error: "not found" }, 404);
          if (url.includes("vazio")) return json({});
          return json({ raw: rawMessage("bom") });
        },
      ],
    ]);

    const result = await fetchToDir(CREDS, VALID, {}, root);

    expect(result).toMatchObject({ found: 3, written: 1, skipped: 0 });
  });

  it("aplica o corte de `max` antes de baixar", async () => {
    stubFetch([
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        async (url) => {
          expect(new URL(url).searchParams.get("maxResults")).toBe("1");
          expect(new URL(url).searchParams.get("q")).toBe("from:x");
          return json({ messages: [{ id: "a" }, { id: "b" }, { id: "c" }] });
        },
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/",
        async () => json({ raw: rawMessage("só um") }),
      ],
    ]);

    const result = await fetchToDir(CREDS, VALID, { max: 1, query: "from:x" }, root);
    expect(result).toMatchObject({ found: 1, written: 1 });
  });

  it("limita `maxResults` a 500 mesmo quando pedem mais", async () => {
    stubFetch([
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        async (url) => {
          // O teto de 500 é do próprio Gmail; pedir mais é erro de API.
          expect(new URL(url).searchParams.get("maxResults")).toBe("500");
          return json({});
        },
      ],
    ]);

    // Sem a chave `messages`, a resposta ainda é válida: caixa sem match.
    await expect(fetchToDir(CREDS, VALID, { max: 5_000 }, root)).resolves.toMatchObject({
      found: 0,
      written: 0,
      skipped: 0,
    });
  });

  it("estoura com o status quando a listagem é recusada", async () => {
    // 403 aqui costuma ser escopo errado ou cota. Continuar em silêncio faria o
    // usuário concluir que a caixa está vazia.
    stubFetch([
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        async () => json({ error: "insufficient permissions" }, 403),
      ],
    ]);

    await expect(fetchToDir(CREDS, VALID, {}, root)).rejects.toThrow(
      "Gmail respondeu 403 ao listar mensagens",
    );
  });

  it("renova o access token antes de listar, quando o guardado venceu", async () => {
    const { calls } = stubFetch([
      [
        "https://oauth2.googleapis.com/token",
        async () => json({ access_token: "renovado", expires_in: 3600 }),
      ],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        async (_url, init) => {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          expect(headers.authorization).toBe("Bearer renovado");
          return json({ messages: [] });
        },
      ],
    ]);

    await fetchToDir(CREDS, { refresh_token: "r", expires_at: 1 }, {}, root);

    expect(calls[0]).toBe("https://oauth2.googleapis.com/token");
  });
});
