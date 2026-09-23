import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/cron/varredura`: a rota que o `pg_cron` chama sem sessão (ADR 0025).
 *
 * A prova que importa é a da ordem: sem o segredo certo, NADA acontece — nem
 * leitura de banco, nem fila, nem rede. Por isso a fatia é substituída por um
 * espião, e cada recusa confere que ele não foi chamado.
 */

const runSweep = vi.fn();

vi.mock("../src/contexts/operations/index.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/contexts/operations/index.ts")>();
  return { ...original, runSweep };
});

const { GET } = await import("../app/api/cron/varredura/route.ts");

const ENV_KEYS = ["CRON_SECRET", "JHO_ENV", "VERCEL_ENV", "JHO_SOURCE_ALLOWLIST", "JHO_INGESTION_OPT_IN"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function pedido(fatia: string | null, authorization?: string) {
  const url = new URL("https://exemplo.test/api/cron/varredura");
  if (fatia !== null) url.searchParams.set("fatia", fatia);
  return new NextRequest(url, { headers: authorization ? { authorization } : {} });
}

const RELATORIO = {
  slice: "sync",
  startedAt: "2026-09-23T12:00:00.000Z",
  durationMs: 1234,
  items: 3,
  errors: 0,
  units: [],
  detail: {},
  staleSources: [],
};

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  runSweep.mockReset();
  runSweep.mockResolvedValue(RELATORIO);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function produção() {
  process.env.CRON_SECRET = "segredo-de-verdade";
  process.env.JHO_ENV = "production";
  process.env.JHO_SOURCE_ALLOWLIST = "ashby";
}

describe("recusa antes de qualquer efeito", () => {
  it("sem CRON_SECRET configurado, 503 — fechada por omissão", async () => {
    const r = await GET(pedido("sync", "Bearer qualquer"));
    expect(r.status).toBe(503);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it("sem cabeçalho, com segredo errado ou sem `Bearer`: 401", async () => {
    produção();
    for (const header of [undefined, "Bearer outro", "segredo-de-verdade", "Bearer segredo"]) {
      const r = await GET(pedido("sync", header));
      expect(r.status, String(header)).toBe(401);
    }
    expect(runSweep).not.toHaveBeenCalled();
  });

  it("segredo errado com fatia inválida ainda é 401: o nome da fatia não vaza por outro código", async () => {
    produção();
    expect((await GET(pedido("inexistente", "Bearer outro"))).status).toBe(401);
  });

  it("fatia ausente ou desconhecida: 400, sem trabalho", async () => {
    produção();
    for (const fatia of [null, "", "tudo", "recheck", "SYNC"]) {
      const r = await GET(pedido(fatia, "Bearer segredo-de-verdade"));
      expect(r.status, String(fatia)).toBe(400);
    }
    expect(runSweep).not.toHaveBeenCalled();
  });

  it("deployment que não pode gastar cota: 503 com motivo nas fatias de rede", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    process.env.VERCEL_ENV = "preview";
    for (const fatia of ["sync", "termos", "captura", "reconferencia"]) {
      const r = await GET(pedido(fatia, "Bearer segredo-de-verdade"));
      expect(r.status, fatia).toBe(503);
      expect(await r.json()).toMatchObject({ error: "ingestão bloqueada" });
    }
    expect(runSweep).not.toHaveBeenCalled();
  });

  it("produção sem allowlist declarada também é bloqueada", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    process.env.JHO_ENV = "production";
    expect((await GET(pedido("sync", "Bearer segredo-de-verdade"))).status).toBe(503);
    expect(runSweep).not.toHaveBeenCalled();
  });
});

describe("com o segredo certo", () => {
  it("roda a fatia pedida e devolve o relatório", async () => {
    produção();
    const r = await GET(pedido("sync", "Bearer segredo-de-verdade"));

    expect(r.status).toBe(200);
    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(runSweep.mock.calls[0]![0]).toBe("sync");
    expect(await r.json()).toMatchObject({ slice: "sync", items: 3, durationMs: 1234 });
  });

  it("pontuar não toca rede de terceiro e roda mesmo onde a ingestão é bloqueada", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    process.env.VERCEL_ENV = "preview";
    const r = await GET(pedido("pontuar", "Bearer segredo-de-verdade"));
    expect(r.status).toBe(200);
    expect(runSweep.mock.calls[0]![0]).toBe("pontuar");
  });

  it("o alarme de fonte sem sync sai no log mesmo sem Sentry", async () => {
    produção();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runSweep.mockImplementation(async (_slice: string, opts: { alarm: (a: { kind: string; sources: string[] }) => Promise<void> }) => {
      await opts.alarm({ kind: "fonte_sem_sync", sources: ["ashby:acme"] });
      return RELATORIO;
    });
    await GET(pedido("sync", "Bearer segredo-de-verdade"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ashby:acme"));
    warn.mockRestore();
  });
});
