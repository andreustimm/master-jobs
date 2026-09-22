import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ROUTES, type History, type Report } from "../scripts/governance/model.ts";

const REPO = "repos/andreustimm/master-jobs";
const ARTIFACTS = `${REPO}/actions/artifacts?name=governanca-producao&per_page=100`;
const RUNS = `${REPO}/actions/workflows/governanca.yml/runs?branch=main&per_page=2`;
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "jho-governance-"));
  temporary.push(root);
  const out = join(root, "output"), bin = join(root, "bin"), archiveDirectory = join(root, "archive");
  for (const path of [out, bin, archiveDirectory]) mkdirSync(path);
  const now = Date.now();
  const history: History = {
    schemaVersion: 1, startedAt: new Date(now - 31 * 86_400_000).toISOString(),
    delivery: { collectedAt: new Date(now).toISOString(), deployments: [] },
    probes: [{ at: new Date(now - 600_000).toISOString(), scheduled: true,
      checks: ROUTES.map(route => ({ route, status: 503, elapsedMs: 500, good: false })) }],
  };
  const data = {
    api: {
      [ARTIFACTS]: { total_count: 1, artifacts: [{ id: 10, expired: false, workflow_run: { id: 123, head_branch: "main", repository_id: 7, head_repository_id: 7 } }] },
      [`${REPO}/actions/runs/123`]: { path: ".github/workflows/governanca.yml", event: "schedule" },
    } as Record<string, unknown>,
    archive: join(root, "history.zip"), probeFailed: false,
  };
  const transport = join(root, "transport.json");
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(process.env.GOVERNANCE_FIXTURE, "utf8"));
const path = process.argv[3];
if (path === "${REPO}/actions/artifacts/10/zip") process.stdout.write(readFileSync(data.archive));
else if (Object.hasOwn(data.api, path)) process.stdout.write(JSON.stringify(data.api[path]));
else { process.stderr.write("synthetic-sensitive-api-detail"); process.exitCode = 1; }
`);
  chmodSync(join(bin, "gh"), 0o755);
  const preload = join(root, "fetch.mjs");
  writeFileSync(preload, `import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(process.env.GOVERNANCE_FIXTURE, "utf8"));
globalThis.fetch = async (url) => {
  const target = new URL(url);
  if (target.origin !== "https://jobs.mastertimm.com.br") throw new Error("Unexpected origin");
  if (target.pathname === "/login") return new Response('data-testid="route-login" data-app-version="1.20.5"', { status: data.probeFailed ? 503 : 200 });
  if (target.pathname === "/jobs") return new Response(null, { status: 307, headers: { location: "/login?next=%2Fjobs" } });
  if (target.pathname === "/p/slug-que-nao-existe") return new Response(null, { status: 404 });
  throw new Error("Unexpected route");
};
`);
  function run(event = "workflow_dispatch", archived: unknown = history) {
    writeFileSync(transport, JSON.stringify(data));
    writeFileSync(join(archiveDirectory, "history.json"), JSON.stringify(archived));
    execFileSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.write(sys.argv[2],'history.json'); z.close()", data.archive, join(archiveDirectory, "history.json")]);
    return spawnSync(process.execPath, ["--import", preload, "scripts/governance/collect.ts", "--restore", "--out", out], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GOVERNANCE_FIXTURE: transport,
        GITHUB_REPOSITORY: "andreustimm/master-jobs", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ID: "999",
        GITHUB_EVENT_NAME: event, GITHUB_STEP_SUMMARY: join(root, "summary.md") },
    });
  }
  return { history, data, out, run,
    persisted: () => JSON.parse(readFileSync(join(out, "history.json"), "utf8")) as History,
    report: () => JSON.parse(readFileSync(join(out, "report.json"), "utf8")) as Report,
  };
}

it("o comando restaura uma falha agendada e acrescenta a sonda manual sem mudar seu denominador", () => {
  const f = fixture();
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  const saved = f.persisted();
  expect(saved.startedAt).toBe(f.history.startedAt);
  expect(saved.probes).toHaveLength(2);
  expect(saved.probes[0]).toEqual(f.history.probes[0]);
  expect(saved.probes[1]!.scheduled).toBe(false);
  expect(saved.probes[1]!.checks.every(c => c.good)).toBe(true);
  expect(f.report().availability).toMatchObject({ total: 1, good: 0, ratio: 0 });
});

it("o comando preserva a data dos deployments quando a atualização falha e sanitiza o erro", () => {
  const f = fixture();
  f.history.delivery!.collectedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const result = f.run();
  expect(result.status).toBe(1);
  expect(f.persisted().delivery).toEqual(f.history.delivery);
  expect(f.persisted().probes).toHaveLength(2);
  expect(f.report().delivery.deploymentsPerDay).toBeNull();
  expect(result.stderr).toContain("Coleta de deployments indisponível");
  expect(result.stdout + result.stderr).not.toContain("synthetic-sensitive-api-detail");
});

it("o comando falha por sonda ruim depois de persistir a observação agendada", () => {
  const f = fixture();
  f.data.probeFailed = true;
  const result = f.run("schedule");
  expect(result.status).toBe(2);
  expect(f.persisted().probes[1]).toMatchObject({ scheduled: true });
  expect(f.persisted().probes[1]!.checks[0]).toMatchObject({ status: 503, good: false });
  expect(f.report().availability).toMatchObject({ total: 2, good: 0 });
});

it.each(["corrompido", "expirado", "outra origem", "segunda tentativa"])("o comando não substitui a cópia local por histórico %s", kind => {
  const f = fixture();
  const previous = JSON.stringify(f.history);
  writeFileSync(join(f.out, "history.json"), previous);
  if (kind === "expirado") f.data.api[ARTIFACTS] = { total_count: 1, artifacts: [] };
  if (kind === "outra origem") f.data.api[`${REPO}/actions/runs/123`] = { path: ".github/workflows/outro.yml", event: "schedule" };
  if (kind === "segunda tentativa") {
    f.data.api[ARTIFACTS] = { total_count: 0, artifacts: [] };
    f.data.api[RUNS] = { workflow_runs: [{ id: 999, head_branch: "main", run_attempt: 2 }] };
  }
  const result = f.run("schedule", kind === "corrompido" ? { probes: "synthetic-sensitive-api-detail" } : f.history);
  expect(result.status).toBe(1);
  expect(readFileSync(join(f.out, "history.json"), "utf8")).toBe(previous);
  expect(result.stderr).toContain("restauração do histórico");
  expect(result.stdout + result.stderr).not.toContain("synthetic-sensitive-api-detail");
});

it("a primeira tentativa comprovada inicia a série sem inventar observações anteriores", () => {
  const f = fixture();
  f.data.api[ARTIFACTS] = { total_count: 0, artifacts: [] };
  f.data.api[RUNS] = { workflow_runs: [{ id: 999, head_branch: "main", run_attempt: 1 }] };
  f.data.api[`${REPO}/deployments?environment=Production&per_page=100&page=1`] = [];
  const result = f.run("schedule");
  expect(result.status, result.stderr).toBe(0);
  expect(f.persisted().probes).toHaveLength(1);
  expect(f.report().availability).toMatchObject({ total: 1, good: 1, status: "dados insuficientes" });
});
