/**
 * Instrumentação nunca derruba o que ela observa.
 *
 * `register` roda antes de o servidor atender a primeira requisição e o Next
 * espera que ela conclua. Uma exceção ali não degrada o relato de erro: ela
 * impede o servidor de subir — trocando "não sei o que quebrou" por "quebrou
 * tudo". Estes testes existem para que a guarda não seja removida por parecer
 * supérflua.
 *
 * Nota de honestidade sobre o que cada teste prova. DSN inválido **não** faz o
 * SDK estourar — `Sentry.init` registra "Invalid Sentry Dsn" e se desativa,
 * verificado ao escrever isto. Então um teste com DSN quebrado passaria com ou
 * sem a guarda, e não serviria de prova. O caso que realmente exercita o
 * `catch` é o módulo falhar ao carregar ou ao inicializar, e é esse que está
 * simulado abaixo.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataCollectionDoCliente, naoColetaNada } from "./support/sentry-client.ts";

const original = process.env.SENTRY_DSN;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (original === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = original;
  vi.doUnmock("@sentry/nextjs");
  vi.resetModules();
});

describe("register", () => {
  it("sem DSN não faz nada e não estoura", async () => {
    delete process.env.SENTRY_DSN;
    const { register } = await import("../instrumentation.ts");
    await expect(register()).resolves.toBeUndefined();
  });

  it("DSN só com espaço conta como ausente", async () => {
    process.env.SENTRY_DSN = "   ";
    const { register } = await import("../instrumentation.ts");
    await expect(register()).resolves.toBeUndefined();
  });

  it("SDK que estoura ao inicializar não impede o servidor de subir", async () => {
    // Este é o teste que a guarda existe para passar. Sem o `try/catch` em
    // `register`, esta exceção sobe para o Next e o processo não atende a
    // primeira requisição — o modo de falha do corte da 1.13.1, de novo.
    process.env.SENTRY_DSN = "https://chave@exemplo.ingest.sentry.io/1";
    vi.doMock("@sentry/nextjs", () => ({
      init: () => {
        throw new Error("falha simulada ao inicializar o SDK");
      },
      captureRequestError: () => {},
    }));
    const { register } = await import("../instrumentation.ts");
    await expect(register()).resolves.toBeUndefined();
  });

  it("o init recebe as peneiras e a amostragem do ambiente, não uma cópia escrita à mão", async () => {
    // Liga o que `tests/sentry-tracing.test.ts` prova na função pura ao que o
    // SDK realmente recebe: trocar `sentryServerOptions` por um objeto literal
    // sem `beforeSendTransaction` reprova aqui.
    process.env.SENTRY_DSN = "https://chave@exemplo.ingest.sentry.io/1";
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.05";
    let recebido: Record<string, unknown> = {};
    vi.doMock("@sentry/nextjs", () => ({
      init: (opcoes: Record<string, unknown>) => {
        recebido = opcoes;
      },
      withStaticSpan: (callback: unknown) => callback,
      captureRequestError: () => {},
    }));
    try {
      const { register } = await import("../instrumentation.ts");
      await register();
    } finally {
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    }
    expect(recebido).toMatchObject({ tracesSampleRate: 0.05, tracePropagationTargets: [] });
    // O que o `init` recebeu, entregue a um cliente real do SDK: é o cliente
    // que resolve `dataCollection`, e uma chave que ele não lê não desliga nada.
    const real = await vi.importActual<typeof import("@sentry/nextjs")>("@sentry/nextjs");
    naoColetaNada(await dataCollectionDoCliente(recebido, real));
    const peneira = recebido.beforeSendTransaction as (e: object) => unknown;
    const limpo = peneira({
      transaction: "GET /jobs?q=termo-secreto",
      request: { url: "/jobs?q=termo-secreto", cookies: { jho_session: "x" } },
    });
    expect(JSON.stringify(limpo)).not.toContain("termo-secreto");
    expect(JSON.stringify(limpo)).not.toContain("jho_session");
  });

  it("no SDK 11 o ciclo de trace é estático e a peneira de span vai marcada para ele", async () => {
    // O `@sentry/nextjs` 11 passou a transmitir spans em fluxo por padrão
    // (`traceLifecycle: 'stream'`). Nesse modo o SDK IGNORA
    // `beforeSendTransaction` e só chama `beforeSendSpan` se ele não estiver
    // marcado como estático — e um span em fluxo traz `name`/`attributes`, que a
    // peneira não conhece. Resultado: a URL com o filtro da pessoa sairia
    // inteira. O ciclo estático mantém as duas peneiras testadas em
    // `tests/sentry-tracing.test.ts` no caminho; `withStaticSpan` é o que faz o
    // SDK entregar a `scrubSpan` o formato que ela conhece.
    process.env.SENTRY_DSN = "https://chave@exemplo.ingest.sentry.io/1";
    let recebido: Record<string, unknown> = {};
    const marcadas = new Set<unknown>();
    vi.doMock("@sentry/nextjs", () => ({
      init: (opcoes: Record<string, unknown>) => {
        recebido = opcoes;
      },
      withStaticSpan: (callback: unknown) => {
        marcadas.add(callback);
        return callback;
      },
      captureRequestError: () => {},
    }));
    const { register } = await import("../instrumentation.ts");
    await register();
    expect(recebido.traceLifecycle).toBe("static");
    expect(marcadas.has(recebido.beforeSendSpan)).toBe(true);
    const span = (recebido.beforeSendSpan as (s: object) => unknown)({
      description: "GET /jobs?q=termo-secreto",
      data: { "url.full": "https://x/jobs?q=termo-secreto" },
    });
    expect(JSON.stringify(span)).not.toContain("termo-secreto");
  });

  it("acha `withStaticSpan` também em `default`, onde o import nativo do Node o deixa", async () => {
    // O build CJS do `@sentry/nextjs` reexporta o `@sentry/node` por um laço
    // dinâmico: empacotado pelo Next o nome aparece no módulo, mas no
    // `import()` nativo do Node ele só existe em `default`. Sem procurar ali,
    // o `init` estouraria e o servidor ficaria sem relato nenhum.
    process.env.SENTRY_DSN = "https://chave@exemplo.ingest.sentry.io/1";
    let recebido: Record<string, unknown> = {};
    const marcadas = new Set<unknown>();
    const sdk = {
      init: (opcoes: Record<string, unknown>) => {
        recebido = opcoes;
      },
      withStaticSpan: (callback: unknown) => {
        marcadas.add(callback);
        return callback;
      },
      captureRequestError: () => {},
    };
    vi.doMock("@sentry/nextjs", () => ({ init: sdk.init, captureRequestError: sdk.captureRequestError, default: sdk }));
    const { register } = await import("../instrumentation.ts");
    await register();
    expect(recebido.traceLifecycle).toBe("static");
    expect(marcadas.has(recebido.beforeSendSpan)).toBe(true);
  });

  it("sem `withStaticSpan` em lugar nenhum, não inicializa com a peneira de span desligada", async () => {
    process.env.SENTRY_DSN = "https://chave@exemplo.ingest.sentry.io/1";
    let iniciou = false;
    vi.doMock("@sentry/nextjs", () => ({
      init: () => {
        iniciou = true;
      },
      captureRequestError: () => {},
    }));
    const { register } = await import("../instrumentation.ts");
    await expect(register()).resolves.toBeUndefined();
    expect(iniciou).toBe(false);
  });

  it("a major instalada do SDK é a que as peneiras conhecem", () => {
    // O SDK 12 remove `beforeSendTransaction`, e o `init` recebe as opções por
    // spread — o compilador não reclamaria da chave órfã, e as transações
    // passariam a sair sem peneira. Subir de major exige reescrever a peneira
    // para spans em fluxo (`name`/`attributes`) e só então mudar este número.
    const instalado = JSON.parse(readFileSync("node_modules/@sentry/nextjs/package.json", "utf8")) as { version: string };
    expect(instalado.version.split(".")[0]).toBe("11");
  });
});

describe("onRequestError", () => {
  it("sem DSN não faz nada e não estoura", async () => {
    delete process.env.SENTRY_DSN;
    const { onRequestError } = await import("../instrumentation.ts");
    await expect(
      onRequestError(
        new Error("falha qualquer"),
        { path: "/jobs", method: "GET", headers: {} },
        { routerKind: "App Router", routePath: "/jobs", routeType: "render" } as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("falhar ao RELATAR não vira um segundo erro por cima do primeiro", async () => {
    process.env.SENTRY_DSN = "https://chave@exemplo.ingest.sentry.io/1";
    vi.doMock("@sentry/nextjs", () => ({
      init: () => {},
      captureRequestError: () => {
        throw new Error("falha simulada ao relatar");
      },
    }));
    const { onRequestError } = await import("../instrumentation.ts");
    await expect(
      onRequestError(
        new Error("a falha que a pessoa realmente viu"),
        { path: "/jobs", method: "GET", headers: {} },
        { routerKind: "App Router", routePath: "/jobs", routeType: "render" } as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("requisição malformada não derruba o redutor", async () => {
    process.env.SENTRY_DSN = "https://chave@exemplo.ingest.sentry.io/1";
    vi.doMock("@sentry/nextjs", () => ({ init: () => {}, captureRequestError: () => {} }));
    const { onRequestError } = await import("../instrumentation.ts");
    await expect(
      onRequestError("não é nem um Error", undefined as never, undefined as never),
    ).resolves.toBeUndefined();
  });
});
