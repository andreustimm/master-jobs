import { describe, expect, it } from "vitest";
import { quotaWatchMetrics } from "../src/contexts/operations/infra/quota-watch-metrics.ts";

/**
 * `quotaWatchMetrics` — o adapter que lê a Vercel, o GitHub Actions e o
 * componente "Actions" do githubstatus.com (M2). Cada chamada é isolada:
 * `fetchImpl` decide a resposta por host, para provar que uma falhando não
 * impede as outras (F3-02).
 */

const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const EMPTY_RUNS = JSON.stringify({ workflow_runs: [] });

function componentsBody(status: string, extra: Array<{ name: string; status: string }> = []): string {
  return JSON.stringify({ components: [{ name: "Actions", status }, ...extra] });
}
const STATUS_OPERATIONAL = componentsBody("operational");

function router(handlers: Record<string, (input: string, init?: RequestInit) => Response>) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    for (const [prefix, handle] of Object.entries(handlers)) {
      if (url.startsWith(prefix)) return handle(url, init);
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

  it("token vazio (\"\") é tratado como ausente — firstNonEmpty, não ??", async () => {
    let vercelCalled = 0;
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": () => { vercelCalled += 1; return new Response("{}", { status: 200 }); },
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      vercelToken: "",
      vercelProjectId: "proj_1",
      githubToken: "gh",
    });
    expect((await metrics.sample()).vercelDeploys24h).toBeNull();
    expect(vercelCalled).toBe(0);
  });

  it("conta os deployments devolvidos, e a URL leva projectId, since, limit e teamId (M8)", async () => {
    let url: URL | undefined;
    let authorization = "";
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": (rawUrl, init) => {
          url = new URL(rawUrl);
          authorization = String((init?.headers as Record<string, string>).authorization);
          return new Response(JSON.stringify({ deployments: [{}, {}, {}] }), { status: 200 });
        },
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      vercelToken: "v-token",
      vercelProjectId: "proj_123",
      vercelTeamId: "team_9",
      githubToken: "gh",
    });
    const sample = await metrics.sample();
    expect(sample.vercelDeploys24h).toBe(3);
    expect(url?.searchParams.get("projectId")).toBe("proj_123");
    expect(url?.searchParams.get("teamId")).toBe("team_9");
    expect(url?.searchParams.get("limit")).toBe("100");
    expect(Number(url?.searchParams.get("since"))).toBe(NOW - 24 * 3_600_000);
    expect(authorization).toBe("Bearer v-token");
  });

  it("sem teamId configurado, a URL não leva o parâmetro (conta pessoal)", async () => {
    let url: URL | undefined;
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": (rawUrl) => { url = new URL(rawUrl); return new Response(JSON.stringify({ deployments: [] }), { status: 200 }); },
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      vercelToken: "v-token",
      vercelProjectId: "proj_123",
      githubToken: "gh",
    });
    await metrics.sample();
    expect(url?.searchParams.has("teamId")).toBe(false);
  });

  it("chamada devolvendo status não-ok: null, não zero", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.vercel.com": () => new Response("erro", { status: 500 }),
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
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
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
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
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
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

describe("actions: fila (com run_started_at, M7) e status por componente (M2)", () => {
  it("sem token: fila null, mas o status público continua sendo pedido", async () => {
    let statusCalled = 0;
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://www.githubstatus.com": () => { statusCalled += 1; return new Response(STATUS_OPERATIONAL, { status: 200 }); },
      }),
      githubToken: undefined,
    });
    const sample = await metrics.sample();
    expect(sample.actionsQueueMaxWaitS).toBeNull();
    expect(statusCalled).toBe(1);
  });

  it("fila vazia é zero segundos, não null, e a URL usa o repositório configurado", async () => {
    let url = "";
    let authorization = "";
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": (rawUrl, init) => {
          url = rawUrl;
          authorization = String((init?.headers as Record<string, string>).authorization);
          return new Response(EMPTY_RUNS, { status: 200 });
        },
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      githubToken: "gh-token",
      githubRepo: "dono/repo",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBe(0);
    expect(url).toBe("https://api.github.com/repos/dono/repo/actions/runs?status=queued&per_page=100");
    expect(authorization).toBe("Bearer gh-token");
  });

  it("200 sem o campo `workflow_runs`: null, nunca 'fila vazia' (M3 residual)", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({}), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      githubToken: "gh-token",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBeNull();
  });

  it("repo vazio (\"\") cai no repositório padrão", async () => {
    let url = "";
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": (rawUrl) => { url = rawUrl; return new Response(EMPTY_RUNS, { status: 200 }); },
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      githubToken: "gh",
      githubRepo: "",
    });
    await metrics.sample();
    expect(url).toContain("/repos/andreustimm/master-jobs/actions");
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
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      githubToken: "gh",
      githubRepo: "dono/repo",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBe(20 * 60);
  });

  it("M7 — run_started_at, quando presente, manda mais que created_at (o runner já pegou o run)", async () => {
    // created_at é de 30 min atrás (esperaria muito), mas run_started_at é de
    // agora mesmo — a fila de verdade já esvaziou para este run.
    const runs = [{ created_at: new Date(NOW - 30 * 60_000).toISOString(), run_started_at: new Date(NOW - 1_000).toISOString() }];
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: runs }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBe(1);
  });

  it("M7 — sem run_started_at (ainda queued), cai para created_at", async () => {
    const runs = [{ created_at: new Date(NOW - 12 * 60_000).toISOString() }];
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: runs }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsQueueMaxWaitS).toBe(12 * 60);
  });

  it("run sem created_at nem run_started_at legíveis não conta, e some da amostra se for o único", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(JSON.stringify({ workflow_runs: [{}] }), { status: 200 }),
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
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
      }),
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
        "https://www.githubstatus.com": () => new Response(STATUS_OPERATIONAL, { status: 200 }),
      }),
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
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response("erro", { status: 503 }),
      }),
      githubToken: "gh",
    });
    const sample = await metrics.sample();
    expect(sample.actionsQueueMaxWaitS).toBe(0);
    expect(sample.actionsStatus).toBeNull();
  });

  it("M2 — só o componente \"Actions\" importa: outro componente em outage não acende o vigia", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(componentsBody("operational", [{ name: "Pages", status: "major_outage" }]), { status: 200 }),
      }),
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsStatus).toBe("none");
  });

  it("M2 — componente \"Actions\" ausente da lista: status desconhecido, null", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(JSON.stringify({ components: [{ name: "Pages", status: "operational" }] }), { status: 200 }),
      }),
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsStatus).toBeNull();
  });

  it("status de componente desconhecido vira null, nunca um valor inventado", async () => {
    const metrics = quotaWatchMetrics({
      now: () => NOW,
      fetchImpl: router({
        "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
        "https://www.githubstatus.com": () => new Response(componentsBody("algo-novo"), { status: 200 }),
      }),
      githubToken: "gh",
    });
    expect((await metrics.sample()).actionsStatus).toBeNull();
  });

  it("os cinco status documentados do componente mapeiam para o vocabulário do domínio", async () => {
    const casos: Array<[string, "none" | "minor" | "major" | "critical"]> = [
      ["operational", "none"],
      ["under_maintenance", "none"],
      ["degraded_performance", "minor"],
      ["partial_outage", "major"],
      ["major_outage", "critical"],
    ];
    for (const [status, esperado] of casos) {
      const metrics = quotaWatchMetrics({
        now: () => NOW,
        fetchImpl: router({
          "https://api.github.com": () => new Response(EMPTY_RUNS, { status: 200 }),
          "https://www.githubstatus.com": () => new Response(componentsBody(status), { status: 200 }),
        }),
        githubToken: "gh",
      });
      expect((await metrics.sample()).actionsStatus, status).toBe(esperado);
    }
  });
});
