/**
 * O que pode sair desta casa junto de um erro.
 *
 * Relatório de erro é a única saída de dado para terceiro neste sistema. Estes
 * testes são o contrato: eles falham se uma atualização do SDK, ou uma linha
 * de configuração apagada por engano, voltar a mandar sessão, IP ou senha.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_HEADERS,
  REDACTED,
  redactPath,
  redactSecrets,
  safeHeaders,
  safeRequest,
  scrubEvent,
} from "../src/core/observability.ts";

describe("redactPath", () => {
  it("mantém o caminho e descarta a query inteira", () => {
    // O caminho diz onde quebrou; a query diz o que a pessoa procurava.
    expect(redactPath("/jobs?q=rust&min-fit=70&stage=applied")).toBe("/jobs");
    expect(redactPath("/jobs/27067")).toBe("/jobs/27067");
    expect(redactPath("/p/andreus#curriculo")).toBe("/p/andreus");
  });

  it("entrada malformada vira / e nunca estoura", () => {
    // Um relator que estoura ao relatar transforma um erro em dois.
    expect(redactPath("")).toBe("/");
    expect(redactPath("?q=so-a-query")).toBe("/");
    expect(redactPath(undefined as unknown as string)).toBe("/");
  });
});

describe("safeHeaders", () => {
  it("deixa passar só a lista de permissão", () => {
    const passou = safeHeaders({
      "content-type": "application/json",
      "accept-language": "pt-BR",
      "x-vercel-id": "gru1::abc",
    });
    expect(passou).toEqual({
      "content-type": "application/json",
      "accept-language": "pt-BR",
      "x-vercel-id": "gru1::abc",
    });
  });

  it("NUNCA deixa passar sessão, credencial ou IP", () => {
    const perigosos = {
      cookie: "jho_session=valor-de-sessao-real",
      Cookie: "jho_session=valor-de-sessao-real",
      authorization: "Bearer token-secreto",
      "x-forwarded-for": "201.10.20.30",
      "x-real-ip": "201.10.20.30",
    };
    const passou = safeHeaders(perigosos);
    expect(passou).toEqual({});
    // Nem sob a forma "existe mas está redigido": dizer que o cabeçalho
    // existe já conta alguma coisa sobre a requisição.
    expect(JSON.stringify(passou)).not.toContain(REDACTED);
    expect(JSON.stringify(passou)).not.toContain("201.10.20.30");
  });

  it("normaliza caixa e junta valor repetido", () => {
    expect(safeHeaders({ "Content-Type": "text/html" })).toEqual({
      "content-type": "text/html",
    });
    expect(safeHeaders({ accept: ["text/html", "application/json"] })).toEqual({
      accept: "text/html, application/json",
    });
    expect(safeHeaders({ accept: undefined })).toEqual({});
  });

  it("a lista de permissão não contém nada que identifique pessoa", () => {
    for (const proibido of ["cookie", "authorization", "x-forwarded-for", "x-real-ip"]) {
      expect(ALLOWED_HEADERS).not.toContain(proibido);
    }
  });
});

describe("redactSecrets", () => {
  it("apaga a senha da URL de conexão que o driver põe na exceção", () => {
    // Caso real: falha de conexão do `postgres` traz a URL inteira no texto.
    const bruto =
      "Error: connect ECONNREFUSED postgres://master_jobs_app:s3nh4-real@db.exemplo.supabase.co:5432/postgres";
    const limpo = redactSecrets(bruto);
    expect(limpo).not.toContain("s3nh4-real");
    expect(limpo).toContain("master_jobs_app");
    expect(limpo).toContain("db.exemplo.supabase.co");
  });

  it("apaga a credencial ANTES do e-mail, senão a senha sobrevive", () => {
    // `usuario:senha@host` casa com o formato de e-mail. Se o e-mail for
    // redigido primeiro, o trecho vira `[redigido]` e a senha some junto —
    // mas num texto com os dois, a ordem errada deixa a senha passar.
    const limpo = redactSecrets("postgres://admin:minha-senha@host/db e andreus@exemplo.com");
    expect(limpo).not.toContain("minha-senha");
    expect(limpo).not.toContain("andreus@exemplo.com");
  });

  it("apaga e-mail, bearer, chave nomeada e bloco longo", () => {
    expect(redactSecrets("usuário andreus.timm@gmail.com falhou")).not.toContain("gmail.com");
    expect(redactSecrets("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
    expect(redactSecrets("password=qualquer-coisa")).not.toContain("qualquer-coisa");
    expect(redactSecrets("api_key: XYZ123")).not.toContain("XYZ123");
    const token = "a".repeat(48);
    expect(redactSecrets(`token ${token} vazou`)).not.toContain(token);
  });

  it("preserva o texto que serve para diagnosticar", () => {
    const util = "POSTGRES_URL traz sslmode na URL: a política de TLS é do cliente";
    expect(redactSecrets(util)).toBe(util);
  });

  it("entrada não textual devolve string vazia", () => {
    expect(redactSecrets(undefined as unknown as string)).toBe("");
    expect(redactSecrets("")).toBe("");
  });
});

describe("safeRequest", () => {
  it("reduz a requisição que o Next entrega ao que pode sair", () => {
    // O Next entrega `headers` com TUDO. Encaminhar como veio é o modo padrão
    // de integrar, e manda a sessão junto do erro.
    const doNext = {
      path: "/pipeline?stage=applied&page=3",
      method: "POST",
      headers: {
        cookie: "jho_session=abc",
        "content-type": "application/json",
        "x-forwarded-for": "201.10.20.30",
      },
    };
    const seguro = safeRequest(doNext);
    expect(seguro).toEqual({
      path: "/pipeline",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const serializado = JSON.stringify(seguro);
    expect(serializado).not.toContain("jho_session");
    expect(serializado).not.toContain("201.10.20.30");
    expect(serializado).not.toContain("stage=applied");
  });

  it("requisição vazia não estoura e assume o mais restrito", () => {
    expect(safeRequest({})).toEqual({ path: "/", method: "GET", headers: {} });
  });
});

describe("scrubEvent", () => {
  /** Um evento com a cara do que o SDK monta de verdade. */
  function eventoRealista() {
    return {
      message: "connect falhou em postgres://app:s3nh4@db.exemplo.com:5432/postgres",
      exception: {
        values: [{ value: "Authorization: Bearer tok-secreto-do-usuario" }, { value: "sem segredo" }],
      },
      request: {
        url: "https://jobs.exemplo.com/pipeline?stage=applied&q=rust",
        method: "POST",
        cookies: { jho_session: "valor-de-sessao-real" },
        data: { curriculo: "texto inteiro do CV", senha: "abc123" },
        query_string: "stage=applied&q=rust",
        headers: {
          cookie: "jho_session=valor-de-sessao-real",
          "x-forwarded-for": "201.10.20.30",
          "content-type": "application/json",
        },
      },
      user: { id: "7", email: "andreus@exemplo.com", ip_address: "201.10.20.30" },
      tags: { runtime: "nodejs" },
    };
  }

  it("apaga sessão, corpo, busca e identidade de um evento realista", () => {
    const limpo = scrubEvent(eventoRealista());
    const texto = JSON.stringify(limpo);
    for (const proibido of [
      "valor-de-sessao-real",
      "texto inteiro do CV",
      "abc123",
      "201.10.20.30",
      "andreus@exemplo.com",
      "s3nh4",
      "tok-secreto-do-usuario",
      "stage=applied",
    ]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("preserva o que serve para diagnosticar", () => {
    const limpo = scrubEvent(eventoRealista());
    expect(limpo?.request?.url).toBe("https://jobs.exemplo.com/pipeline");
    expect(limpo?.request?.headers).toEqual({ "content-type": "application/json" });
    expect(limpo?.exception?.values?.[1]?.value).toBe("sem segredo");
    expect(limpo?.tags).toEqual({ runtime: "nodejs" });
  });

  it("na dúvida, descarta o evento em vez de mandá-lo sem peneirar", () => {
    // Estourar dentro do beforeSend faz o SDK descartar; devolver o evento
    // cru seria pior que não relatar. `null` diz explicitamente "não envie".
    expect(scrubEvent(null as never)).toBeNull();
    const armadilha = {
      get message(): string {
        throw new Error("campo hostil");
      },
    };
    expect(scrubEvent(armadilha as never)).toBeNull();
  });

  it("evento sem os campos perigosos passa intacto", () => {
    // Fora do literal na chamada, para o TypeScript não recusar o campo extra
    // por excesso de propriedade — o ponto do teste é justamente que campo
    // que a peneira não conhece atravessa sem ser tocado.
    const evento = { message: "falha sem nada sensível", tags: { a: "b" } };
    expect(scrubEvent(evento)).toEqual({ message: "falha sem nada sensível", tags: { a: "b" } });
  });
});
