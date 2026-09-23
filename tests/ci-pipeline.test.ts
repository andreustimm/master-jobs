// Suite: CI em jobs paralelos
// Invariant: `qualidade` só passa quando todos os gates passaram, e a suíte
//   fatiada mede a cobertura contra o mesmo piso global do `pnpm check`
// Boundary IN: .github/workflows/ci.yml e o script do agregador, executado de verdade
// Boundary OUT: o scheduler do GitHub Actions e a proteção de branch remota
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import config from "../vitest.config.ts";
import { AGGREGATOR, checkoutOf, ciWorkflow, needsOf, type CiJob, type CiStep } from "./support/ci-workflow.ts";

const ci = ciWorkflow();
const aggregator = ci.jobs[AGGREGATOR]!;

function stepIndex(job: CiJob, matches: (step: CiStep) => boolean): number {
  const index = job.steps.findIndex(matches);
  expect(index, "passo ausente").toBeGreaterThanOrEqual(0);
  return index;
}

function runAggregator(needs: Record<string, { result: string }>) {
  const step = aggregator.steps.find((candidate) => candidate.run !== undefined)!;
  return spawnSync("bash", ["-e", "-c", step.run!], {
    encoding: "utf8",
    env: { ...process.env, RESULTADOS: JSON.stringify(needs) },
  });
}

describe("agregador qualidade", () => {
  it("depende de todo job do CI, para que nenhum gate rode sem bloquear", () => {
    const others = Object.keys(ci.jobs).filter((name) => name !== AGGREGATOR && name !== "validacao");
    expect(new Set(needsOf(aggregator))).toEqual(new Set(others));
  });

  it("roda sempre, inclusive quando uma dependência falha", () => {
    expect(aggregator.if).toBe("${{ always() }}");
    expect(aggregator.steps.find((step) => step.run)?.env).toEqual({
      RESULTADOS: "${{ toJSON(needs) }}",
    });
  });

  it("aprova só quando todas as dependências terminaram em sucesso", () => {
    const all = Object.fromEntries(needsOf(aggregator).map((name) => [name, { result: "success" }]));
    expect(runAggregator(all).status).toBe(0);

    for (const result of ["failure", "skipped", "cancelled"]) {
      const outcome = runAggregator({ ...all, testes: { result } });
      expect(outcome.status, result).not.toBe(0);
      expect(outcome.stdout).toContain(`testes: ${result}`);
    }
    // Sem dependência nenhuma não há prova de nada.
    expect(runAggregator({}).status).not.toBe(0);
  });
});

describe("suíte fatiada", () => {
  const tests = ci.jobs.testes!;
  const coverage = ci.jobs.cobertura!;
  const shards = (tests.strategy?.matrix?.fatia ?? []) as number[];
  const shardStep = tests.steps.find((step) => step.run?.includes("vitest run --shard="))!;

  it("cobre todas as fatias, sem buraco nem repetição", () => {
    expect(shards.length).toBeGreaterThan(1);
    expect(shards).toEqual(shards.map((_, index) => index + 1));
    expect(shardStep.run).toContain(`--shard=\${{ matrix.fatia }}/${shards.length}`);
    expect(shardStep.run).toContain("--reporter=blob");
    expect(shardStep.run).toContain("--coverage");
  });

  it("gera o changelog e o service worker ANTES dos testes", () => {
    const run = stepIndex(tests, (step) => step === shardStep);
    expect(stepIndex(tests, (step) => step.run === "node scripts/sw-version.mjs")).toBeLessThan(run);
    expect(stepIndex(tests, (step) => step.run === "pnpm changelog:build")).toBeLessThan(run);
  });

  it("publica os blobs, que moram num diretório oculto", () => {
    const upload = tests.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;
    expect(upload.with?.name).toBe("blob-${{ matrix.fatia }}");
    expect(upload.with?.["include-hidden-files"]).toBe(true);
    expect(upload.with?.["if-no-files-found"]).toBe("error");
    // Refazer só a fatia vermelha reenvia o mesmo nome no mesmo run.
    expect(upload.with?.overwrite).toBe(true);
  });

  it("aplica o piso de vitest.config.ts sobre o total mesclado, não sobre a fatia", () => {
    const thresholds = config.test?.coverage && "thresholds" in config.test.coverage
      ? config.test.coverage.thresholds
      : undefined;
    expect(thresholds).toMatchObject({
      statements: expect.any(Number),
      branches: expect.any(Number),
      functions: expect.any(Number),
      lines: expect.any(Number),
    });
    // A fatia zera exatamente as quatro métricas do piso, nada além.
    const zeroed = [...shardStep.run!.matchAll(/--coverage\.thresholds\.(\w+)=0/g)].map((match) => match[1]);
    expect(new Set(zeroed)).toEqual(new Set(["statements", "branches", "functions", "lines"]));

    expect(needsOf(coverage)).toEqual(["testes"]);
    const download = coverage.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"))!;
    expect(download.with).toMatchObject({ pattern: "blob-*", path: ".vitest-reports", "merge-multiple": true });
    const merge = coverage.steps.find((step) => step.run?.includes("--merge-reports"))!;
    expect(merge.run).toBe("pnpm vitest run --merge-reports --coverage");
  });

  it("dá às fatias o histórico com tags que os testes de release exigem", () => {
    expect(checkoutOf(tests)?.with).toMatchObject({ "fetch-depth": 0, "fetch-tags": true });
  });
});

describe("navegador real", () => {
  it("gera o service worker antes do gate PWA", () => {
    const job = ci.jobs["pwa-browser"]!;
    const browser = stepIndex(job, (step) => step.run === "pnpm test:pwa-browser");
    expect(stepIndex(job, (step) => step.run?.includes("node scripts/sw-version.mjs") ?? false)).toBeLessThan(browser);
    expect(stepIndex(job, (step) => step.run === "pnpm exec playwright install --with-deps chromium")).toBeLessThan(browser);
  });
});
