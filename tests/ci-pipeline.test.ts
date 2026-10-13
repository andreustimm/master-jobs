// Suite: CI em jobs paralelos
// Invariant: `qualidade` só passa quando todos os gates passaram, e a suíte
//   fatiada mede a cobertura contra o mesmo piso global do `pnpm check`
// Boundary IN: .github/workflows/ci.yml e o script do agregador, executado de verdade
// Boundary OUT: o scheduler do GitHub Actions e a proteção de branch remota
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../vitest.config.ts";
import {
  AGGREGATOR,
  NON_BLOCKING_JOBS,
  checkoutOf,
  ciWorkflow,
  needsOf,
  type CiJob,
  type CiStep,
} from "./support/ci-workflow.ts";

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
    const others = Object.keys(ci.jobs).filter((name) =>
      name !== AGGREGATOR && name !== "validacao" && !(name in NON_BLOCKING_JOBS));
    expect(new Set(needsOf(aggregator))).toEqual(new Set(others));
    // Exceção só existe para job que existe, e nunca para um que já bloqueia.
    // E exceção sem política não é exceção: cada uma diz por quê.
    for (const [name, why] of Object.entries(NON_BLOCKING_JOBS)) {
      expect(ci.jobs[name], name).toBeDefined();
      expect(needsOf(aggregator)).not.toContain(name);
      expect(why.trim(), `${name} sem motivo registrado`).not.toBe("");
    }
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

  describe("recorte de PR só de documentação (#528)", () => {
    const recortaveis = ["pwa-browser", "banco-nas-majors"];
    const documentacao = { result: "success", outputs: { completo: "false" } };
    const completo = { result: "success", outputs: { completo: "true" } };
    const verdes = Object.fromEntries(needsOf(aggregator).map((name) => [name, { result: "success" }]));
    const pulados = Object.fromEntries(recortaveis.map((name) => [name, { result: "skipped" }]));

    it("os jobs recortáveis dependem de escopo e pulam só com completo=false", () => {
      for (const name of recortaveis) {
        expect(needsOf(ci.jobs[name]!), name).toEqual(["escopo"]);
        expect(ci.jobs[name]!.if, name).toBe("needs.escopo.outputs.completo != 'false'");
      }
      // O resto da suíte nunca é recortado. `build` fica de fora porque o
      // Tailwind varre os `.md` do repositório: Markdown pode mudar o CSS.
      for (const name of ["contratos", "testes", "cobertura", "build"]) {
        expect(ci.jobs[name]!.if ?? "", name).not.toContain("escopo");
        expect(needsOf(ci.jobs[name]!), name).not.toContain("escopo");
      }
    });

    it("aprova os recortáveis pulados quando escopo verde disse completo=false", () => {
      expect(runAggregator({ ...verdes, escopo: documentacao, ...pulados }).status).toBe(0);
    });

    it("reprova os mesmos pulos sem o recorte: escopo completo, vermelho ou sem saída", () => {
      for (const escopo of [completo, { result: "failure" }, { result: "success" }]) {
        expect(runAggregator({ ...verdes, escopo, ...pulados }).status, JSON.stringify(escopo)).not.toBe(0);
      }
    });

    it("reprova pulo de job que não é recortável, mesmo com o recorte", () => {
      for (const name of ["contratos", "testes", "cobertura", "build", "schema-e-migracao"]) {
        const outcome = runAggregator({ ...verdes, escopo: documentacao, ...pulados, [name]: { result: "skipped" } });
        expect(outcome.status, name).not.toBe(0);
      }
    });

    it("reprova falha de job recortável, mesmo com o recorte", () => {
      expect(runAggregator({ ...verdes, escopo: documentacao, "pwa-browser": { result: "failure" } }).status).not.toBe(0);
    });

    it("schema-e-migracao aceita banco-nas-majors pulado só no recorte", () => {
      const schema = ci.jobs["schema-e-migracao"]!;
      expect(new Set(needsOf(schema))).toEqual(new Set(["escopo", "banco-nas-majors"]));
      const step = schema.steps.find((candidate) => candidate.env?.RESULTADOS)!;
      const run = (needs: Record<string, unknown>) =>
        spawnSync("bash", ["-e", "-c", step.run!], { encoding: "utf8", env: { ...process.env, RESULTADOS: JSON.stringify(needs) } }).status;
      expect(run({ escopo: documentacao, "banco-nas-majors": { result: "skipped" } })).toBe(0);
      expect(run({ escopo: completo, "banco-nas-majors": { result: "skipped" } })).not.toBe(0);
      expect(run({ escopo: documentacao, "banco-nas-majors": { result: "failure" } })).not.toBe(0);
      expect(run({ escopo: completo, "banco-nas-majors": { result: "success" } })).toBe(0);
    });
  });

  it("nenhuma dependência, `plano` inclusive, passa sem sucesso", () => {
    const all = Object.fromEntries(needsOf(aggregator).map((name) => [name, { result: "success" }]));
    for (const name of needsOf(aggregator)) {
      for (const result of ["failure", "skipped", "cancelled"]) {
        expect(runAggregator({ ...all, [name]: { result } }).status, `${name}: ${result}`).not.toBe(0);
      }
    }
  });
});

describe("plano do CI de PR (#535)", () => {
  const plan = ci.jobs.plano!;
  const raw = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = plan.steps.find((candidate) => candidate.id === "plano")!;

  it("é gate do portão: está em `qualidade.needs` e nenhum passo seu é tolerante a falha", () => {
    expect(needsOf(aggregator)).toContain("plano");
    expect(plan.steps.some((candidate) => "continue-on-error" in candidate)).toBe(false);
    expect(plan["continue-on-error"]).toBeUndefined();
    expect(plan.needs).toBeUndefined();
  });

  it("lê o diff do commit de merge do alvo exato, sem credencial e sem instalar nada", () => {
    expect(checkoutOf(plan)?.with).toEqual({
      ref: "${{ inputs.target-sha || github.sha }}",
      "persist-credentials": false,
      // A PR testada é um commit de merge; a base é o primeiro pai dele.
      "fetch-depth": 2,
    });
    expect(plan.steps.map((candidate) => candidate.run ?? "").join("\n")).not.toMatch(/pnpm|npm|yarn/);
  });

  it("passa o contexto do GitHub por `env:`, nunca interpolado no `run:`", () => {
    expect(step.env).toEqual({
      EVENTO: "${{ github.event_name }}",
      BASE_REF: "${{ github.base_ref }}",
      TARGET_SHA: "${{ inputs.target-sha }}",
    });
    // `github.base_ref` é nome de branch: texto de quem abre a PR.
    expect(step.run).not.toContain("${{");
    expect(step.run).toBe(
      'node --experimental-strip-types --no-warnings scripts/github/ci-plan.ts >> "$GITHUB_OUTPUT"',
    );
  });

  it("as saídas declaradas são as que o script escreve, e todo consumidor lê uma delas", () => {
    // Saída com nome errado vira "" no Actions, e `== 'true'` falha em silêncio:
    // o E2E sumiria de todo PR sem nenhum job vermelho.
    const script = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", "scripts/github/ci-plan.ts"],
      { encoding: "utf8", env: { ...process.env, EVENTO: "push", BASE_REF: "", TARGET_SHA: "" } },
    );
    expect(script.status).toBe(0);
    const written = script.stdout.trim().split("\n").map((line) => line.split("=")[0]);
    expect(Object.keys(plan.outputs ?? {}).sort()).toEqual(written.sort());
    for (const [name, expression] of Object.entries(plan.outputs ?? {})) {
      expect(expression).toBe(`\${{ steps.plano.outputs.${name} }}`);
    }
    const consumed = [...raw.matchAll(/needs\.plano\.outputs\.([\w-]+)/g)].map((match) => match[1]!);
    expect(consumed.length).toBeGreaterThan(0);
    for (const name of consumed) expect(written, name).toContain(name);
  });

  it("só o E2E consome o plano, e fora do portão", () => {
    const consumers = Object.entries(ci.jobs)
      .filter(([, job]) => needsOf(job).includes("plano"))
      .map(([name]) => name);
    expect(consumers.sort()).toEqual(["e2e-navegador", "qualidade"]);
    expect(ci.jobs["e2e-navegador"]!.needs).toBe("plano");
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
    // Uma fatia vermelha não pode pular a mesclagem que mostra as falhas.
    expect(coverage.if).toBe("${{ !cancelled() }}");
    const download = coverage.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"))!;
    // `.vitest/blob` é onde o Vitest 5 grava e lê os blobs por padrão.
    expect(download.with).toMatchObject({ pattern: "blob-*", path: ".vitest/blob", "merge-multiple": true });
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
