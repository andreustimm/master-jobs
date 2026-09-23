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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      captureRequestError: () => {},
    }));
    try {
      const { register } = await import("../instrumentation.ts");
      await register();
    } finally {
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    }
    expect(recebido).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0.05, tracePropagationTargets: [] });
    const peneira = recebido.beforeSendTransaction as (e: object) => unknown;
    const limpo = peneira({
      transaction: "GET /jobs?q=termo-secreto",
      request: { url: "/jobs?q=termo-secreto", cookies: { jho_session: "x" } },
    });
    expect(JSON.stringify(limpo)).not.toContain("termo-secreto");
    expect(JSON.stringify(limpo)).not.toContain("jho_session");
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
