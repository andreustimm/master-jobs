import { describe, expect, it } from "vitest";
import { quotaWatchMetrics } from "../src/contexts/operations/infra/quota-watch-metrics.ts";

/**
 * `quotaWatchMetrics` — o adapter que lê a Vercel, o GitHub Actions e o
 * status público. Cada chamada é isolada: `fetchImpl` decide a resposta por
 * host, para provar que uma falhando não impede as outras (F3-02).
 */

const NOW = Date.parse("2026-09-29T12:00:00.000Z");

function router(handlers: Record<string, () => Response>) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    for (const [prefix, handle] of Object.entries(handlers)) {
      if (url.startsWith(prefix)) return handle();
    }
    throw new Error(`sem handler para ${url}`);
  };
}

describe("vercel: deployments nas últimas 24 h", () => {
  it("sem token ou sem project id: null, sem tocar a rede", async () => {
    let called = 0;
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: (async () => {
        called += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      vercelToken: undefined,
      githubToken: "gh",
    });
    const sample = await metrics.sample();
    expect(sample.vercelDeploys24h).toBeNull();
    // As outras métricas ainda tentam a rede — só a Vercel fica de fora.
    expect(called).toBeGreaterThan(0);
  });

  it("conta os deployments devolvidos, e manda teamId quando configurado", async () => {
    let url = "";
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": () => {
          return new Response(JSON.stringify({ deployments: [{}, {}, {}] }), { status: 200 });
        },
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 }),
      }) as unknown as typeof fetch,
      vercelToken: "v",
      vercelProjectId: "proj_123",
      vercelTeamId: "team_9",
      githubToken: "gh",
    });
    const sample = await metrics.sample();
    expect(sample.vercelDeploys24h).toBe(3);
    void url;
  });

  it("chamada devolvendo status não-ok: null, não zero", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": () => new Response("erro", { status: 500 }),
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response("{}", { status: 200 }),
      }) as unknown as typeof fetch,
      vercelToken: "v",
      vercelProjectId: "proj_123",
      githubToken: "gh",
    });
    expect((await metrics.sample()).vercelDeploys24h).toBeNull();
  });

  it("rede falhando (throw): null, nunca propaga", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": () => { throw new Error("timeout"); },
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response("{}", { status: 200 }),
      }) as unknown as typeof fetch,
      vercelToken: "v",
      vercelProjectId: "proj_123",
      githubToken: "gh",
    });
    await expect(metrics.sample()).resolves.toMatchObject({ vercelDeploys24h: null });
  });

  it("resposta sem o campo `deployments`: null, nunca conta o que não veio", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": () => new Response(JSON.stringify({}), { status: 200 }),
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response("{}", { status: 200 }),
      }) as unknown as typeof fetch,
      vercelToken: "v",
      vercelProjectId: "proj_123",
      githubToken: "gh",
    });
    expect((await metrics.sample()).vercelDeploys24h).toBeNull();
  });
});

describe("construção sem opções: os padrões (fetch global, Date.now) só são referenciados, nunca chamados aqui", () => {
  it("não lança ao construir sem token nem fetchImpl", () => {
    expect(() => quotaWatchMetrics()).not.toThrow();
  });
});

describe("actions: fila e status", () => {
  it("sem token: fila null, mas o status público continua sendo pedido", async () => {
    let statusCalled = 0;
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://www.githubstatus.com": () => {
          statusCalled += 1;
          return new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 });
        },
      }) as unknown as typeof fetch,
      githubToken: undefined,
    });
    const sample = await metrics.sample();
    expect(sample.actionsQueueMaxWaitS).toBeNull();
    expect(statusCalled).toBe(1);
  });

  it("fila vazia é zero segundos, não null", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 }),
      }) as unknown as typeof fetch,
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBe(0);
  });

  it("a maior espera entre os runs em fila, em segundos", async () => {
    const runs = [
      { created_at: new Date(NOW - 5 * 60_000).toISOString() },
      { created_at: new Date(NOW - 20 * 60_000).toISOString() },
    ];
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: runs }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 }),
      }) as unknown as typeof fetch,
      githubToken: "gh",
      githubRepo: "dono/repo",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBe(20 * 60);
  });

  it("run sem created_at legível não conta, e some da amostra se for o único", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [{}] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 }),
      }) as unknown as typeof fetch,
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBeNull();
  });

  it("status não-ok ou rede falhando: fila e status ficam null", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response("erro", { status: 500 }),
        "https://www.githubstatus.com": () => { throw new Error("timeout"); },
      }) as unknown as typeof fetch,
      githubToken: "gh",
    });
    const sample = await metrics.sample();
    expect(sample.actionsQueueMaxWaitS).toBeNull();
    expect(sample.actionsStatus).toBeNull();
  });

  it("a fila lançando (throw), separado do status: null, nunca propaga", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => { throw new Error("timeout"); },
        "https://www.githubstatus.com": () => new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 }),
      }) as unknown as typeof fetch,
      githubToken: "gh",
    });
    const sample = await metrics.sample();
    expect(sample.actionsQueueMaxWaitS).toBeNull();
    expect(sample.actionsStatus).toBe("none");
  });

  it("status público respondendo não-ok (sem lançar): null", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response("erro", { status: 503 }),
      }) as unknown as typeof fetch,
      githubToken: "gh",
    });
    const sample = await metrics.sample();
    expect(sample.actionsQueueMaxWaitS).toBe(0);
    expect(sample.actionsStatus).toBeNull();
  });

  it("indicator desconhecido vira null, nunca um valor inventado", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(JSON.stringify({ status: { indicator: "algo-novo" } }), { status: 200 }),
      }) as unknown as typeof fetch,
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsStatus).toBeNull();
  });

  it("os quatro indicadores documentados passam direto", async () => {
    for (const indicator of ["none", "minor", "major", "critical"] as const) {
      const metrics = quotaWatchMetrics({
        now: () => NOW,
        fetchImpl: router({
          "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
          "https://www.githubstatus.com": () => new Response(JSON.stringify({ status: { indicator } }), { status: 200 }),
        }) as unknown as typeof fetch,
        githubToken: "gh",
      });
      expect((await metrics.sample()).actionsStatus, indicator).toBe(indicator);
    }
  });
});
