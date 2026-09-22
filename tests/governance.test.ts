import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { historySchema, ledgerSchema, POLICY, ROUTES, summarize, type History, type Ledger, type Probe } from "../scripts/governance/model.ts";
import { collectDelivery, confirmFirstMonitorRun } from "../scripts/governance/github.ts";
import { probe, PRODUCTION } from "../scripts/governance/probe.ts";

const now = new Date("2026-10-23T12:00:00Z");
const since = "2026-09-23T12:00:00Z";
const ledger: Ledger = { schemaVersion: 1, recordingStartedAt: since, incidents: [], changes: [] };
function sample(at: string, good = true): Probe {
  return { at, scheduled: true, checks: ROUTES.map(route => ({ route, status: good ? route === "/login" ? 200 : route === "/jobs" ? 307 : 404 : 503, elapsedMs: good ? 500 : 10_000, good })) };
}
function history(): History {
  return { schemaVersion: 1, startedAt: since, delivery: null,
    probes: Array.from({ length: 4320 }, (_, i) => sample(new Date(now.getTime() - i * 600_000).toISOString())) };
}

describe("governança: dados ausentes e orçamento de erros", () => {
  it("não transforma ausência de coleta em 100% nem ausência de incidentes em zero", () => {
    const r = summarize({ ...history(), probes: [] }, ledger, now);
    expect(r.availability.ratio).toBeNull();
    expect(r.availability.status).toBe("sem dados");
    expect(r.availability.budgetRemainingPercent).toBeNull();
    expect(r.delivery.changeFailureRate).toBeNull();
    expect(r.delivery.deploymentsPerDay).toBeNull();
  });
  it("só declara conformidade com janela e cobertura suficientes", () => {
    const h = history();
    expect(summarize(h, ledger, now).availability.status).toBe("dentro da meta");
    expect(summarize({ ...h, probes: h.probes.slice(0, 100) }, ledger, now).availability.status).toBe("dados insuficientes");
    expect(summarize({ ...h, startedAt: now.toISOString() }, ledger, now).availability.status).toBe("dados insuficientes");
  });
  it("retrys e sondas manuais não diluem falhas, nem contam fora da janela", () => {
    const h = history();
    h.probes[0] = sample(now.toISOString(), false);
    h.probes.push(sample(now.toISOString()), { ...sample(now.toISOString()), scheduled: false });
    h.probes.push(sample("2026-11-01T12:00:00Z"), sample("2026-09-01T12:00:00Z"));
    const r = summarize(h, ledger, now);
    expect(r.availability.total).toBe(4320);
    expect(r.availability.good).toBe(4319);
    expect(r.availability.coverage).toBe(1);
  });
  it("conta todos os contratos e timeouts no orçamento e na latência", () => {
    const h = history();
    for (let i = 0; i < 220; i++) h.probes[i] = sample(h.probes[i]!.at, false);
    const r = summarize(h, ledger, now);
    expect(r.availability.status).toBe("fora da meta");
    expect(r.availability.budgetRemainingPercent).toBeLessThan(0);
    expect(r.publicLatency.status).toBe("fora da meta");
    expect(r.publicLatency.p95Ms).toBe(10_000);
  });
  it("preserva falhas e a pior latência de cada rota quando o slot é repetido", () => {
    const h = history();
    const first = sample(now.toISOString());
    first.checks[1] = { ...first.checks[1]!, status: 503, good: false };
    const retry = sample(now.toISOString());
    retry.checks[0]!.elapsedMs = 4_000;
    h.probes = [first, retry, sample(now.toISOString())];
    const result = summarize(h, ledger, now);
    expect(result.availability.good).toBe(0);
    expect(result.publicLatency.fast).toBe(0);
    expect(result.publicLatency.p95Ms).toBe(4_000);
  });
  it("rejeita histórico corrompido e classificação duplicada", () => {
    const h = history();
    h.probes[0]!.checks[0]!.elapsedMs = NaN;
    expect(historySchema.safeParse(h).success).toBe(false);
    h.probes[0] = sample(now.toISOString());
    h.probes[0]!.checks[0]!.status = 500;
    expect(historySchema.safeParse(h).success).toBe(false);
    const c = { deploymentId: 1, rework: false, assessedAt: now.toISOString(), evidence: "https://github.com/andreustimm/master-jobs/pull/192" };
    expect(ledgerSchema.safeParse({ ...ledger, changes: [c, c] }).success).toBe(false);
  });
});

describe("DORA: mudanças e incidentes são denominadores distintos", () => {
  it("mede commit até primeiro deploy, sem contar o mesmo commit novamente", () => {
    const h = history();
    h.delivery = { collectedAt: now.toISOString(), deployments: [
      { id: 1, sha: "a".repeat(40), at: "2026-10-20T12:00:00Z", commits: [{ sha: "a".repeat(40), at: "2026-10-20T10:00:00Z" }] },
      { id: 2, sha: "b".repeat(40), at: "2026-10-21T12:00:00Z", commits: [{ sha: "a".repeat(40), at: "2026-10-20T10:00:00Z" }, { sha: "b".repeat(40), at: "2026-10-21T08:00:00Z" }] },
    ] };
    const r = summarize(h, ledger, now);
    expect(r.delivery.deploymentsPerDay).toBe(2 / POLICY.windowDays);
    expect(r.delivery.leadTimeMedianHours).toBe(3);
    expect(r.delivery.measuredCommits).toBe(2);
    expect(r.delivery.changeFailureRate).toBeNull();
    h.delivery.deployments[0]!.commits = null;
    expect(summarize(h, ledger, now).delivery.leadTimeMedianHours).toBeNull();
  });
  it("só calcula falha/retrabalho com cobertura e avaliação explícitas", () => {
    const h = history();
    h.delivery = { collectedAt: now.toISOString(), deployments: [
      { id: 1, sha: "a".repeat(40), at: "2026-10-20T12:00:00Z", commits: [] },
      { id: 2, sha: "b".repeat(40), at: "2026-10-21T12:00:00Z", commits: [] },
    ] };
    const l: Ledger = { ...ledger, changes: [1, 2].map(deploymentId => ({ deploymentId, rework: deploymentId === 2, assessedAt: now.toISOString(), evidence: "https://github.com/andreustimm/master-jobs/pull/192" })), incidents: [
      { id: "INC-1", severity: "SEV1", startedAt: "2026-10-20T12:10:00Z", detectedAt: "2026-10-20T12:20:00Z", acknowledgedAt: null, restoredAt: "2026-10-20T13:10:00Z", cause: "change", causedByDeploymentId: 1, evidence: "https://github.com/andreustimm/master-jobs/issues/1" },
    ] };
    const r = summarize(h, l, now);
    expect(r.delivery.changeFailureRate).toBe(0.5);
    expect(r.delivery.deploymentReworkRate).toBe(0.5);
    expect(r.delivery.failedDeploymentRecoveryMedianHours).toBe(1);
    expect(summarize(h, { ...l, recordingStartedAt: now.toISOString() }, now).delivery.changeFailureRate).toBeNull();
    l.incidents[0]!.restoredAt = null;
    expect(summarize(h, l, now).delivery.failedDeploymentRecoveryMedianHours).toBeNull();
    expect(summarize(h, l, now).delivery.openChangeIncidents).toBe(1);
    l.incidents[0]!.startedAt = "2026-09-20T12:10:00Z";
    expect(summarize(h, l, now).delivery.failedDeploymentRecoveryMedianHours).toBeNull();
    expect(summarize(h, l, now).delivery.openChangeIncidents).toBe(1);
    l.incidents[0]!.cause = "unknown";
    l.incidents[0]!.causedByDeploymentId = null;
    expect(summarize(h, l, now).delivery.changeFailureRate).toBeNull();
    h.delivery.collectedAt = "2026-10-20T12:00:00Z";
    expect(summarize(h, l, now).delivery.deploymentsPerDay).toBeNull();
  });
});

it("sonda só GETs públicos, valida o destino do redirect e rejeita 200 de página de erro", async () => {
  const calls: string[] = [];
  const request = (async (url, init) => {
    calls.push(String(url));
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).not.toHaveProperty("cookie");
    if (String(url).endsWith("/login")) return new Response('data-testid="route-login" data-app-version="1.20.5"', { status: 200 });
    if (String(url).endsWith("/jobs")) return new Response(null, { status: 307, headers: { location: "/login?next=%2Fjobs" } });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const result = await probe(now, true, request);
  expect(result.checks.every(c => c.good)).toBe(true);
  expect(calls).toEqual(ROUTES.map(route => PRODUCTION + route));
  const broken = await probe(now, false, (async () => new Response("Vercel error", { status: 200 })) as typeof fetch);
  expect(broken.checks.every(c => !c.good)).toBe(true);
  const offline = await probe(now, false, (async () => { throw new Error("sensitive transport detail"); }) as typeof fetch);
  expect(offline.checks.every(c => !c.good && c.status === 0)).toBe(true);
  expect(JSON.stringify(offline)).not.toContain("sensitive");
});

it("workflow mede só produção e preserva evidência de falha com permissões de leitura", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/governanca.yml", import.meta.url), "utf8"));
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read", deployments: "read" });
  expect(workflow.jobs.medir.if).toBe("github.ref == 'refs/heads/main'");
  const artifact = workflow.jobs.medir.steps.find((s: { uses?: string }) => s.uses?.startsWith("actions/upload-artifact@"));
  expect(artifact.if).toBe("always()");
  expect(artifact.with["retention-days"]).toBe(3);
  // A grade de slots começa no minuto do cron; divergir volta a perder slots por atraso.
  const minutes = String(workflow.on.schedule[0].cron).split(" ")[0]!.split(",").map(Number);
  expect(minutes).toEqual(Array.from({ length: 6 }, (_, i) => POLICY.slotOffsetMinutes + i * POLICY.intervalMinutes));
});

it("atraso de minutos do agendador não junta dois runs no mesmo slot", () => {
  // Run de :37 atrasado 3,5 min e run de :47 no horário: slots diferentes.
  const h: History = { schemaVersion: 1, startedAt: since, delivery: null,
    probes: [sample("2026-10-23T11:40:30Z"), sample("2026-10-23T11:47:40Z")] };
  expect(summarize(h, ledger, now).availability.total).toBe(2);
});


it("coletor exclui cron/previews e retém success anterior a inactive", () => {
  const calls: string[] = [];
  const sha = "a".repeat(40), old = "b".repeat(40);
  const request = <T,>(path: string): T => {
    calls.push(path);
    let value: unknown;
    if (path.includes("deployments?")) value = [
      { id: 3, sha, environment: "production", task: "deploy", creator: { login: "andreustimm" } },
      { id: 4, sha, environment: "Preview", task: "deploy", creator: { login: "vercel[bot]" } },
      { id: 2, sha, environment: "Production", task: "deploy", creator: { login: "vercel[bot]" } },
      { id: 1, sha: old, environment: "Production", task: "deploy", creator: { login: "vercel[bot]" } },
    ];
    else if (path.includes("/2/statuses")) value = [{ state: "inactive", created_at: "2026-10-22T12:00:00Z" }, { state: "success", created_at: "2026-10-20T12:00:00Z" }];
    else if (path.includes("/1/statuses")) value = [{ state: "success", created_at: "2026-09-20T12:00:00Z" }];
    else if (path.includes("/compare/")) value = { status: "ahead", total_commits: 1, commits: [{ sha, commit: { committer: { date: "2026-10-20T10:00:00Z" } } }] };
    else throw new Error("Requisição inesperada");
    return value as T;
  };
  const result = collectDelivery(now, request);
  expect(result.deployments).toHaveLength(1);
  expect(result.deployments[0]).toMatchObject({ id: 2, at: "2026-10-20T12:00:00Z", commits: [{ sha, at: "2026-10-20T10:00:00Z" }] });
  expect(calls.some(p => p.includes("/3/statuses") || p.includes("/4/statuses"))).toBe(false);
});

it("coletor pagina status até alcançar success anterior a mais de 100 atualizações", () => {
  const sha = "a".repeat(40);
  const request = <T,>(path: string): T => {
    if (path.includes("deployments?")) return [{ id: 2, sha, environment: "Production", task: "deploy", creator: { login: "vercel[bot]" } }] as T;
    if (path.endsWith("page=1")) return Array.from({ length: 100 }, () => ({ state: "inactive", created_at: "2026-10-22T12:00:00Z" })) as T;
    if (path.endsWith("page=2")) return [{ state: "success", created_at: "2026-10-20T12:00:00Z" }] as T;
    throw new Error("Requisição inesperada");
  };
  expect(collectDelivery(now, request).deployments[0]?.at).toBe("2026-10-20T12:00:00Z");
});

it("coletor recusa lista de deployments truncada em vez de subcontar silenciosamente", () => {
  let pages = 0;
  const request = <T,>(path: string): T => {
    expect(path).toContain("deployments?");
    pages++;
    return Array.from({ length: 100 }, () => ({ creator: { login: "andreustimm" }, environment: "production", task: "deploy" })) as T;
  };
  expect(() => collectDelivery(now, request)).toThrow("Paginação");
  expect(pages).toBe(20);
});

it("artefatos ausentes só iniciam série quando é comprovadamente a primeira execução", () => {
  const first = <T,>() => ({ workflow_runs: [{ id: 100, head_branch: "main", run_attempt: 1 }] }) as T;
  expect(() => confirmFirstMonitorRun("100", first)).not.toThrow();
  const lost = <T,>() => ({ workflow_runs: [{ id: 100, head_branch: "main" }, { id: 99, head_branch: "main" }] }) as T;
  expect(() => confirmFirstMonitorRun("100", lost)).toThrow("recuperar o histórico");
  expect(() => confirmFirstMonitorRun("101", first)).toThrow();
  expect(() => confirmFirstMonitorRun(undefined, first)).toThrow();
  const retry = <T,>() => ({ workflow_runs: [{ id: 100, head_branch: "main", run_attempt: 2 }] }) as T;
  expect(() => confirmFirstMonitorRun("100", retry)).toThrow("recuperar o histórico");
});

it("não duplica deployments quando uma inserção desloca a paginação", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, sha: (i + 1).toString(16).padStart(40, "0"), environment: "Production", task: "deploy", creator: { login: "vercel[bot]" } }));
  const calls: string[] = [];
  const request = <T,>(path: string): T => {
    calls.push(path);
    if (path.includes("deployments?")) return (path.endsWith("page=1") ? rows : [rows[99]]) as T;
    if (path.includes("/statuses?")) return [{ state: "success", created_at: "2026-10-20T12:00:00Z" }] as T;
    if (path.includes("/compare/")) return { status: "ahead", total_commits: 0, commits: [] } as T;
    throw new Error("Requisição inesperada");
  };
  const delivery = collectDelivery(now, request);
  expect(delivery.deployments).toHaveLength(100);
  expect(calls.filter(p => p.includes("/100/statuses?"))).toHaveLength(1);
  const assessed: Ledger = { ...ledger, changes: rows.map(r => ({ deploymentId: r.id, rework: false, assessedAt: now.toISOString(), evidence: "https://github.com/andreustimm/master-jobs/pull/192" })), incidents: [
    { id: "INC-1", severity: "SEV2", startedAt: "2026-10-20T12:10:00Z", detectedAt: "2026-10-20T12:20:00Z", acknowledgedAt: null, restoredAt: null, cause: "change", causedByDeploymentId: 100, evidence: "https://github.com/andreustimm/master-jobs/issues/1" },
  ] };
  const report = summarize({ ...history(), delivery }, assessed, now);
  expect(report.delivery.deploymentsPerDay).toBe(100 / POLICY.windowDays);
  expect(report.delivery.changeFailureRate).toBe(0.01);
});
