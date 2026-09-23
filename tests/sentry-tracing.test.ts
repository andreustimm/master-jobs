/**
 * O que pode sair desta casa numa transação do Sentry.
 *
 * Ligar tracing muda o que sai: além do erro, cada requisição amostrada leva o
 * nome da transação, o span raiz com os atributos de HTTP e os spans filhos
 * com os de PostgreSQL. A instrumentação padrão anexa exatamente o que este
 * sistema promete não mandar — a URL com o filtro da pessoa, o IP, a consulta,
 * o endereço do banco. Estes testes montam a transação com esse formato e
 * reprovam se algum marcador privado sobreviver à peneira.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_SPAN_DATA,
  DEFAULT_TRACES_SAMPLE_RATE,
  REDACTED,
  SENTRY_DEFAULT_ORG,
  SENTRY_DEFAULT_PROJECT,
  scrubEvent,
  scrubSpan,
  scrubTransaction,
  sentryServerOptions,
  sourceMapPlan,
  tracesSampleRate,
  type ScrubbableTransaction,
} from "../src/core/observability.ts";

/**
 * Tudo o que não pode sair, com um marcador por dado. O teste procura cada um
 * no JSON inteiro do evento peneirado: não importa em que campo o SDK o pôs.
 */
const PRIVADO = {
  termo: "termo-secreto-da-busca",
  piso: "piso=31415",
  email: "andreus.privado@example.com",
  sessao: "jho_session=sessao-viva",
  ip: "201.10.20.30",
  senha: "senha-do-banco",
  hostBanco: "db.supabase-interno.example",
  consulta: "cv_text",
  telefone: "+55 11 98765-4321",
};

/** Uma transação no formato que o `@sentry/nextjs` 10 monta para `GET /jobs`. */
function transacaoDeVerdade(): ScrubbableTransaction {
  const url = `https://jobs.mastertimm.com.br/jobs?q=${PRIVADO.termo}&${PRIVADO.piso}`;
  return {
    transaction: `GET /jobs?q=${PRIVADO.termo}`,
    request: {
      url,
      query_string: `q=${PRIVADO.termo}&${PRIVADO.piso}`,
      cookies: { jho_session: PRIVADO.sessao },
      headers: {
        cookie: PRIVADO.sessao,
        "x-forwarded-for": PRIVADO.ip,
        "accept-language": "pt-BR",
      },
      data: { cv: PRIVADO.telefone },
    },
    user: { email: PRIVADO.email, ip_address: PRIVADO.ip },
    contexts: {
      trace: {
        op: "http.server",
        data: {
          "sentry.op": "http.server",
          "http.request.method": "GET",
          "http.route": "/jobs",
          "http.response.status_code": 200,
          "http.target": `/jobs?q=${PRIVADO.termo}`,
          "url.full": url,
          "url.query": `q=${PRIVADO.termo}`,
          "client.address": PRIVADO.ip,
          "http.user_agent": "Mozilla/5.0",
        },
      },
      otel: { resource: { "service.name": "master-jobs" } },
      response: { status_code: 200, headers: { "set-cookie": PRIVADO.sessao } },
      runtime: { name: "node", version: "v24.19.0" },
    },
    spans: [
      {
        op: "db",
        description: `select "id", "${PRIVADO.consulta}" from "candidate" where "email" = ?`,
        data: {
          "db.system.name": "postgres",
          "db.query.text": `select "${PRIVADO.consulta}" from "candidate"`,
          "db.namespace": "postgres",
          "db.connection_string": `postgres://app:${PRIVADO.senha}@${PRIVADO.hostBanco}/postgres`,
          "server.address": PRIVADO.hostBanco,
          "db.operation.name": "SELECT",
        },
      },
      {
        op: "http.client",
        description: `GET https://boards.example/api/jobs?search=${PRIVADO.termo}`,
        data: {
          "http.request.method": "GET",
          "url.full": `https://boards.example/api/jobs?search=${PRIVADO.termo}`,
          "http.response.status_code": 200,
        },
      },
      {
        op: "jho.etapa",
        description: "board",
        data: { "jho.etapa": "board", "sentry.op": "jho.etapa" },
      },
    ],
    breadcrumbs: [
      { message: `fetch https://boards.example/?q=${PRIVADO.termo}`, data: { url: `https://boards.example/?q=${PRIVADO.termo}` } },
    ],
    tags: { rota: `/jobs?q=${PRIVADO.termo}`, nivel: 3, objeto: { email: PRIVADO.email } },
    extra: { filtros: { q: PRIVADO.termo } },
  };
}

function naoVaza(evento: unknown): void {
  const texto = JSON.stringify(evento);
  for (const [nome, valor] of Object.entries(PRIVADO)) {
    expect(texto, `vazou ${nome}`).not.toContain(valor);
  }
}

describe("scrubTransaction", () => {
  it("nenhum dado privado sobrevive, em nenhum campo", () => {
    // Controle: o fixture de fato carrega todos os marcadores. Sem isto, um
    // fixture que perdesse um marcador passaria o teste sem medir nada.
    const bruto = JSON.stringify(transacaoDeVerdade());
    for (const valor of Object.values(PRIVADO)) expect(bruto).toContain(valor);

    const limpo = scrubTransaction(transacaoDeVerdade());
    expect(limpo).not.toBeNull();
    naoVaza(limpo);
  });

  it("guarda o que responde onde o tempo foi", () => {
    const limpo = scrubTransaction(transacaoDeVerdade())!;
    expect(limpo.transaction).toBe("GET /jobs");
    expect(limpo.request?.url).toBe("https://jobs.mastertimm.com.br/jobs");
    expect(limpo.request?.headers).toEqual({ "accept-language": "pt-BR" });

    const trace = limpo.contexts?.trace as { data: Record<string, unknown> };
    expect(trace.data).toEqual({
      "sentry.op": "http.server",
      "http.request.method": "GET",
      "http.route": "/jobs",
      "http.response.status_code": 200,
    });

    const [banco, saida, etapa] = limpo.spans!;
    // A consulta vira o nome da operação: basta para saber onde o tempo foi.
    expect(banco).toMatchObject({ description: "SELECT", data: { "db.system.name": "postgres", "db.operation.name": "SELECT" } });
    expect(banco!.data).not.toHaveProperty("server.address");
    expect(saida!.description).toBe("GET https://boards.example/api/jobs");
    expect(etapa).toMatchObject({ description: "board", data: { "jho.etapa": "board" } });
    expect(limpo.tags).toEqual({ rota: "/jobs", nivel: 3 });
  });

  it("contexto fora da lista some inteiro", () => {
    const limpo = scrubTransaction(transacaoDeVerdade())!;
    expect(Object.keys(limpo.contexts ?? {}).sort()).toEqual(["runtime", "trace"]);
    expect(limpo.extra).toBeUndefined();
    expect(limpo.breadcrumbs).toBeUndefined();
    expect(limpo.user).toBeUndefined();
  });

  it("em caso de dúvida, descarta a transação inteira", () => {
    const envenenado = transacaoDeVerdade();
    Object.defineProperty(envenenado, "spans", {
      get() {
        throw new Error("atualização do SDK mudou o formato");
      },
    });
    expect(scrubTransaction(envenenado)).toBeNull();
    expect(scrubTransaction(null as never)).toBeNull();
  });

  it("transação mínima passa sem estourar", () => {
    expect(scrubTransaction({})).toEqual({});
    expect(scrubTransaction({ contexts: { trace: "não é objeto" } })).toEqual({ contexts: { trace: "não é objeto" } });
  });
});

describe("scrubSpan", () => {
  it("atributo fora da lista não sai, e texto perde a query", () => {
    const span = scrubSpan({
      op: "http.server",
      description: `GET /jobs?q=${PRIVADO.termo}#fim`,
      data: {
        "http.route": "/jobs",
        "http.target": `/jobs?q=${PRIVADO.termo}`,
        "next.span_name": `render /jobs?q=${PRIVADO.termo}`,
        "sentry.sample_rate": 0.1,
        "next.rsc": true,
        "error.type": { nested: PRIVADO.email },
      },
    });
    expect(span).toEqual({
      op: "http.server",
      description: "GET /jobs",
      data: { "http.route": "/jobs", "next.span_name": "render /jobs", "sentry.sample_rate": 0.1 },
    });
  });

  it("span de banco reduz a consulta ao verbo, mesmo sem o atributo de operação", () => {
    expect(scrubSpan({ op: "db", description: "  update \"application\" set \"note\" = ?", data: {} }).description).toBe("UPDATE");
    expect(scrubSpan({ description: "with x as (select 1) select * from x", data: { "db.system": "postgresql" } }).description).toBe("WITH");
    expect(scrubSpan({ op: "db.query", description: `"${PRIVADO.consulta}"` }).description).toBe("db");
  });

  it("span sem dado nem descrição sai como veio, e não-objeto não estoura", () => {
    expect(scrubSpan({ op: "jho.etapa" })).toEqual({ op: "jho.etapa", data: {} });
    expect(scrubSpan(null as never)).toBeNull();
  });

  it("se a peneira estourar, o span sai VAZIO, não como veio", () => {
    // `beforeSendSpan` não pode descartar: devolver o original seria mandar tudo.
    const span = {
      op: "db",
      description: `select "${PRIVADO.consulta}"`,
      get data(): Record<string, unknown> {
        throw new Error("formato inesperado");
      },
      set data(_valor: Record<string, unknown>) {},
    };
    const limpo = scrubSpan(span as never) as { description?: string };
    expect(limpo.description).toBeUndefined();
  });

  it("a lista de permissão não admite atributo de URL, IP, consulta ou endereço", () => {
    for (const perigoso of ["http.target", "http.url", "url.full", "url.query", "client.address", "db.query.text", "db.statement", "server.address", "http.user_agent"]) {
      expect(ALLOWED_SPAN_DATA).not.toContain(perigoso);
    }
  });
});

describe("scrubEvent nas migalhas", () => {
  it("URL de requisição de saída perde a query; texto perde segredo", () => {
    const evento = scrubEvent({
      breadcrumbs: [
        { message: `GET https://boards.example/?q=${PRIVADO.termo}`, data: { url: `https://boards.example/?q=${PRIVADO.termo}`, status_code: 200, ok: true, corpo: { email: PRIVADO.email } } },
        { message: `falhou com senha=${PRIVADO.senha}` },
        { data: "não é objeto" as never },
        null as never,
      ],
    })!;
    naoVaza(evento);
    expect(evento.breadcrumbs![0]).toEqual({
      message: "GET https://boards.example/",
      data: { url: "https://boards.example/", status_code: 200, ok: true },
    });
    expect(evento.breadcrumbs![1]!.message).toBe(`falhou com senha=${REDACTED}`);
  });
});

describe("tracesSampleRate", () => {
  it("ausente ou em branco é o padrão baixo", () => {
    expect(tracesSampleRate(undefined)).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(tracesSampleRate("")).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(tracesSampleRate("   ")).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBeLessThanOrEqual(0.1);
  });

  it("número entre 0 e 1 é respeitado, 0 desliga", () => {
    expect(tracesSampleRate("0")).toBe(0);
    expect(tracesSampleRate("0.25")).toBe(0.25);
    expect(tracesSampleRate(" .5 ")).toBe(0.5);
    expect(tracesSampleRate("1")).toBe(1);
    expect(tracesSampleRate("1.0")).toBe(1);
  });

  it("valor ilegível DESLIGA, em vez de cair no padrão", () => {
    for (const ruim of ["abc", "1.5", "-0.1", "10%", "0,2", "Infinity", "NaN", "1e-1", "2"]) {
      expect(tracesSampleRate(ruim), ruim).toBe(0);
    }
  });
});

describe("sentryServerOptions", () => {
  const opcoes = sentryServerOptions({
    dsn: "https://chave@exemplo.ingest.sentry.io/1",
    environment: "production",
    release: "abc123",
    tracesSampleRate: "0.2",
  });

  it("nunca manda PII padrão nem propaga trace para terceiro", () => {
    expect(opcoes.sendDefaultPii).toBe(false);
    // `baggage` leva chave pública, release e nome da transação para cada
    // board que a sincronização consulta.
    expect(opcoes.tracePropagationTargets).toEqual([]);
    expect(opcoes.tracesSampleRate).toBe(0.2);
    expect(opcoes).toMatchObject({ dsn: "https://chave@exemplo.ingest.sentry.io/1", environment: "production", release: "abc123" });
  });

  it("os três ganchos estão ligados às peneiras", () => {
    // Este é o teste que reprova se alguém trocar a peneira por identidade.
    naoVaza(opcoes.beforeSendTransaction(transacaoDeVerdade()));
    naoVaza(opcoes.beforeSend({ request: { url: `/jobs?q=${PRIVADO.termo}`, cookies: PRIVADO.sessao }, user: { email: PRIVADO.email } }));
    naoVaza(opcoes.beforeSendSpan({ description: `GET /jobs?q=${PRIVADO.termo}`, data: { "url.full": PRIVADO.termo } }));
  });

  it("a taxa configurada vence a decisão que chega no cabeçalho sentry-trace", () => {
    // Sem isto, `sentry-trace: …-1` de qualquer cliente amostraria 100%, e o
    // `0` não desligaria nada.
    const desligado = sentryServerOptions({ dsn: "x", environment: "production", tracesSampleRate: "0" });
    expect(desligado.tracesSampler({ parentSampled: true, parentSampleRate: 1 })).toBe(0);
    expect(opcoes.tracesSampler({ parentSampled: true, parentSampleRate: 1 })).toBe(0.2);
  });

  it("sem amostragem configurada, fica no padrão", () => {
    expect(sentryServerOptions({ dsn: "x", environment: "production" }).tracesSampleRate).toBe(DEFAULT_TRACES_SAMPLE_RATE);
  });
});

describe("sourceMapPlan", () => {
  it("sem token, não publica e diz por quê", () => {
    for (const env of [{}, { SENTRY_AUTH_TOKEN: "" }, { SENTRY_AUTH_TOKEN: "   " }]) {
      const plano = sourceMapPlan(env);
      expect(plano.upload).toBe(false);
      expect(plano).toHaveProperty("reason", expect.stringContaining("SENTRY_AUTH_TOKEN"));
    }
  });

  it("com token, usa organização e projeto padrão e o SHA como release — sem o token no plano", () => {
    const plano = sourceMapPlan({ SENTRY_AUTH_TOKEN: "sntrys_token-de-verdade", VERCEL_GIT_COMMIT_SHA: " abc123 " });
    expect(plano).toEqual({ upload: true, org: SENTRY_DEFAULT_ORG, project: SENTRY_DEFAULT_PROJECT, release: "abc123" });
    expect(JSON.stringify(plano)).not.toContain("sntrys_token-de-verdade");
  });

  it("organização e projeto do ambiente vencem o padrão; vazio não vence", () => {
    expect(sourceMapPlan({ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "outra", SENTRY_PROJECT: "proj" })).toEqual({ upload: true, org: "outra", project: "proj" });
    expect(sourceMapPlan({ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "", SENTRY_PROJECT: " " })).toEqual({
      upload: true,
      org: SENTRY_DEFAULT_ORG,
      project: SENTRY_DEFAULT_PROJECT,
    });
  });
});
