import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/cron/watchdog`: a checagem manual/de teste do vigia de cota (ADR
 * 0030, Fase 3) — mesma borda de segredo de toda rota de `/api/cron/`
 * (`tests/architecture.test.ts` prova, por descoberta, que `cronDenied` roda
 * antes do primeiro `await`). Aqui a prova é da rota em si: sem segredo,
 * nada roda; com segredo, devolve o relatório.
 */

const runQuotaWatchNow = vi.fn();

vi.mock("../src/contexts/operations/index.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/contexts/operations/index.ts")>();
  return { ...original, runQuotaWatchNow };
});

const { GET } = await import("../app/api/cron/watchdog/route.ts");

const saved = process.env.CRON_SECRET;

function pedido(authorization?: string) {
  return new NextRequest("https://exemplo.test/api/cron/watchdog", { headers: authorization ? { authorization } : {} });
}

const REPORT = {
  checkedAt: "2026-09-29T12:00:00.000Z",
  sample: { vercelDeploys24h: 5, actionsQueueMaxWaitS: 0, actionsStatus: "none" },
  decision: { state: "ok" },
  alerted: false,
};

beforeEach(() => {
  delete process.env.CRON_SECRET;
  runQuotaWatchNow.mockReset();
  runQuotaWatchNow.mockResolvedValue(REPORT);
});

afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("recusa antes de qualquer efeito", () => {
  it("sem CRON_SECRET configurado, 503 — fechada por omissão", async () => {
    const r = await GET(pedido("Bearer qualquer"));
    expect(r.status).toBe(503);
    expect(runQuotaWatchNow).not.toHaveBeenCalled();
  });

  it("sem cabeçalho, com segredo errado ou sem `Bearer`: 401", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    for (const header of [undefined, "Bearer outro", "segredo-de-verdade"]) {
      const r = await GET(pedido(header));
      expect(r.status, String(header)).toBe(401);
    }
    expect(runQuotaWatchNow).not.toHaveBeenCalled();
  });
});

describe("com o segredo certo", () => {
  it("roda a checagem e devolve o relatório", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    const r = await GET(pedido("Bearer segredo-de-verdade"));

    expect(r.status).toBe(200);
    expect(runQuotaWatchNow).toHaveBeenCalledTimes(1);
    expect(await r.json()).toMatchObject({ decision: { state: "ok" } });
  });
});
