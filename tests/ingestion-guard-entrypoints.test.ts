import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IngestionBlockedError } from "../src/core/ingest/environment.ts";
import { probe } from "../src/core/ingest/probe.ts";
import { syncAll } from "../src/core/ingest/run.ts";
import { verifyJobs } from "../src/core/ingest/verify.ts";
import { runFetchStage } from "../src/core/scrape/fetcher.ts";
import { requestTermCaptures, runTermCaptures } from "../src/contexts/sourcing/index.ts";

/**
 * Suite: contrato de não-I/O dos entrypoints bloqueados (F-08, IT-002)
 * Invariant: em dev/staging/preview, sync, scrape, recheck e probe saem antes
 * de abrir HTTP ou tocar o banco — sem estado parcial.
 * Boundary IN: os quatro entrypoints reais, com espiões na fronteira de rede.
 * Boundary OUT: a decisão em si, coberta por UT-001.
 *
 * O teste não usa banco de propósito: se algum guarda faltar, a chamada tenta
 * `getDb()` sem `DATABASE_URL` e falha com OUTRO erro — e é exatamente essa
 * diferença que o teste afirma. Bloqueio tem que vir antes de tudo.
 */

const previous = { ...process.env };

/** Espera a rejeição e devolve o erro já tipado, sem união com o sucesso. */
async function blockedBy(promise: Promise<unknown>): Promise<IngestionBlockedError> {
  const outcome = await promise.then(
    () => new Error("a chamada deveria ter sido bloqueada"),
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(IngestionBlockedError);
  return outcome as IngestionBlockedError;
}

beforeEach(() => {
  process.env.JHO_ENV = "staging";
  delete process.env.JHO_INGESTION_OPT_IN;
  delete process.env.JHO_SOURCE_ALLOWLIST;
});

afterEach(() => {
  process.env = { ...previous };
  vi.restoreAllMocks();
});

describe("IT-002 — entrypoint bloqueado não abre rede nem fila", () => {
  it("recusa sync, recheck, probe e scrape sem tocar em fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(syncAll([])).rejects.toBeInstanceOf(IngestionBlockedError);
    await expect(verifyJobs()).rejects.toBeInstanceOf(IngestionBlockedError);
    await expect(probe("https://example.test/vaga")).rejects.toBeInstanceOf(IngestionBlockedError);
    await expect(runFetchStage()).rejects.toBeInstanceOf(IngestionBlockedError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("nomeia o ambiente e o motivo, sem vazar configuração", async () => {
    const error = await blockedBy(syncAll([]));

    expect(error.environment).toBe("staging");
    expect(error.reason).toBe("staging runs on fixtures only");
    expect(error.message).not.toMatch(/postgres|token|secret|password/i);
  });

  it("repetir a chamada bloqueada custa o mesmo e não acumula estado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => syncAll([]).catch((thrown) => (thrown as Error).message)),
    );

    expect(new Set(results).size).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("IT-127 captura por termo: drenar recusa, pedir responde bloqueado sem gravar", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Sem banco neste arquivo: se a guarda viesse depois do primeiro acesso, o
    // erro seria outro. Pedir captura devolve o código em vez de lançar — é o
    // que deixa o termo ser salvo com "capturas desligadas" (TechSpec).
    await expect(runTermCaptures({ worker: "test" })).rejects.toBeInstanceOf(IngestionBlockedError);
    await expect(
      requestTermCaptures({ termKey: "laravel", query: "Laravel", origin: "web", now: new Date() }),
    ).resolves.toEqual({ enqueued: 0, existing: 0, skipped: "ingestion_blocked" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preview sem declaração nenhuma também é negado", async () => {
    delete process.env.JHO_ENV;

    const error = await blockedBy(probe("https://example.test/vaga"));

    expect(error.environment).toBe("preview");
  });

  it("produção com allowlist passa do guarda e falha adiante, não nele", async () => {
    // A prova de que o guarda não é um bloqueio universal: com contexto de
    // produção declarado, a chamada segue e morre por falta de banco — o erro
    // seguinte na fila, não o de ambiente.
    process.env.JHO_ENV = "production";
    process.env.JHO_SOURCE_ALLOWLIST = "ashby";

    const outcome = await verifyJobs().then(
      () => null,
      (error: unknown) => error,
    );

    expect(outcome).not.toBeInstanceOf(IngestionBlockedError);
  });
});
