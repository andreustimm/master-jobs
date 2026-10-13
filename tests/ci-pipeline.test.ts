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

type Needs = Record<string, { result: string; outputs?: Record<string, string> }>;

/** Executa de verdade o `jq` do check obrigatório `job`, com o `toJSON(needs)` dado. */
function runGate(job: string, needs: Needs) {
  const step = ci.jobs[job]!.steps.find((candidate) => candidate.run !== undefined && candidate.env?.RESULTADOS !== undefined)!;
  return spawnSync("bash", ["-e", "-c", step.run!], {
    encoding: "utf8",
    env: { ...process.env, RESULTADOS: JSON.stringify(needs) },
  });
}

const runAggregator = (needs: Needs) => runGate(AGGREGATOR, needs);

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

  it("cada job pesado lê a saída do plano que lhe cabe; `contratos` não espera o plano", () => {
    const guards: Record<string, string> = {
      "e2e-navegador": "e2e",
      testes: "suite",
      cobertura: "suite",
      "pwa-browser": "suite",
      build: "suite",
      "banco-nas-majors": "banco",
    };
    for (const [name, output] of Object.entries(guards)) {
      expect(needsOf(ci.jobs[name]!), name).toContain("plano");
      expect(ci.jobs[name]!.if, name).toContain(`needs.plano.outputs.${output} == 'true'`);
    }
    // Os que rodam sempre: nunca esperam o plano nem dependem de uma saída dele.
    expect(ci.jobs.contratos!.needs).toBeUndefined();
    expect(ci.jobs.contratos!.if).toBeUndefined();
    const consumers = Object.entries(ci.jobs)
      .filter(([, job]) => needsOf(job).includes("plano"))
      .map(([name]) => name);
    expect(consumers.sort()).toEqual([...Object.keys(guards), "qualidade", "schema-e-migracao"].sort());
    expect(ci.jobs["e2e-navegador"]!.needs).toBe("plano");
  });
});

describe("pulo só com plano (#535)", () => {
  /** Os jobs que o plano pode pular, com a saída que o declara. */
  const SKIPPABLE: Record<string, "suite" | "banco"> = {
    testes: "suite",
    cobertura: "suite",
    "pwa-browser": "suite",
    build: "suite",
    "banco-nas-majors": "banco",
  };
  const planned = (outputs: Record<string, string>, result = "success") => ({ result, outputs });
  const everyone = (extra: Needs = {}): Needs => ({
    ...Object.fromEntries(needsOf(aggregator).map((name) => [name, { result: "success" }])),
    plano: planned({ e2e: "true", suite: "true", banco: "true" }),
    ...extra,
  });
  const skip = (names: string[]) => Object.fromEntries(names.map((name) => [name, { result: "skipped" }]));

  it("PR L0: o plano declarou os cinco pulos, e `qualidade` passa", () => {
    const needs = everyone({ ...skip(Object.keys(SKIPPABLE)), plano: planned({ e2e: "false", suite: "false", banco: "false" }) });
    expect(runAggregator(needs).status).toBe(0);
  });

  it("cada pulo passa só pela saída que o declara", () => {
    for (const [name, output] of Object.entries(SKIPPABLE)) {
      const other = output === "suite" ? "banco" : "suite";
      const declared = planned({ [output]: "false", [other]: "true" });
      expect(runAggregator(everyone({ ...skip([name]), plano: declared })).status, `${name} declarado`).toBe(0);
      // A outra saída falsa não desculpa este job.
      const wrong = planned({ [output]: "true", [other]: "false" });
      expect(runAggregator(everyone({ ...skip([name]), plano: wrong })).status, `${name} contra o plano`).not.toBe(0);
    }
  });

  it("pulado sem plano reprova: plano ausente, vermelho, cancelado, pulado ou sem saída", () => {
    const declared = { e2e: "false", suite: "false", banco: "false" };
    for (const name of Object.keys(SKIPPABLE)) {
      const sem = everyone(skip([name]));
      delete sem.plano;
      expect(runAggregator(sem).status, `${name}: sem plano na lista`).not.toBe(0);
      for (const result of ["failure", "cancelled", "skipped"]) {
        const needs = everyone({ ...skip([name]), plano: planned(declared, result) });
        expect(runAggregator(needs).status, `${name}: plano ${result}`).not.toBe(0);
      }
      const invalid: Record<string, string>[] = [{}, { suite: "", banco: "" }, { suite: "False", banco: "FALSE" }, { suite: "0", banco: "0" }];
      for (const outputs of invalid) {
        const needs = everyone({ ...skip([name]), plano: planned(outputs) });
        expect(runAggregator(needs).status, `${name}: saídas ${JSON.stringify(outputs)}`).not.toBe(0);
      }
      const semSaidas = everyone({ ...skip([name]), plano: { result: "success" } });
      expect(runAggregator(semSaidas).status, `${name}: plano sem outputs`).not.toBe(0);
    }
  });

  it("o plano declarar o pulo não aceita falha nem cancelamento do job", () => {
    const declared = planned({ e2e: "false", suite: "false", banco: "false" });
    for (const name of Object.keys(SKIPPABLE)) {
      for (const result of ["failure", "cancelled"]) {
        expect(runAggregator(everyone({ [name]: { result }, plano: declared })).status, `${name}: ${result}`).not.toBe(0);
      }
    }
  });

  it("o que roda sempre nunca passa pulado, nem com tudo declarado", () => {
    const declared = planned({ e2e: "false", suite: "false", banco: "false" });
    const always = needsOf(aggregator).filter((name) => !(name in SKIPPABLE));
    expect(always.sort()).toEqual(["contratos", "plano", "schema-e-migracao"]);
    for (const name of always) {
      expect(runAggregator(everyone({ [name]: { result: "skipped" }, plano: name === "plano" ? { result: "skipped" } : declared })).status, name).not.toBe(0);
    }
  });

  it("a lista de pulos é a do workflow: todo job que o plano guarda pode pular, e só ele", () => {
    // Job novo guardado pelo plano que o agregador não conhece reprovaria o PR
    // L0 inteiro; pulo permitido a job que roda sempre abriria um buraco.
    const declared = planned({ e2e: "false", suite: "false", banco: "false" });
    for (const name of needsOf(aggregator).filter((candidate) => candidate !== "plano")) {
      const guard = /needs\.plano\.outputs\.(suite|banco) == 'true'/.exec(ci.jobs[name]!.if ?? "")?.[1];
      const accepted = runAggregator(everyone({ [name]: { result: "skipped" }, plano: declared })).status === 0;
      expect(accepted, name).toBe(guard !== undefined);
      expect(SKIPPABLE[name], name).toBe(guard);
    }
  });

  describe("schema-e-migracao: o banco pulado passa só com o plano que o declarou", () => {
    const gate = (needs: Needs) => runGate("schema-e-migracao", needs);
    const ok = { "banco-nas-majors": { result: "success" }, plano: planned({ banco: "true" }) };

    it("depende do plano e das majors, e roda sempre", () => {
      expect(needsOf(ci.jobs["schema-e-migracao"]!)).toEqual(["plano", "banco-nas-majors"]);
      expect(ci.jobs["schema-e-migracao"]!.if).toBe("${{ always() }}");
    });

    it("sucesso passa; banco pulado passa só com `banco == 'false'` e plano verde", () => {
      expect(gate(ok).status).toBe(0);
      const pulado = { "banco-nas-majors": { result: "skipped" } };
      expect(gate({ ...pulado, plano: planned({ banco: "false" }) }).status).toBe(0);
      expect(gate({ ...pulado, plano: planned({ banco: "true" }) }).status).not.toBe(0);
      expect(gate({ ...pulado, plano: planned({ suite: "false" }) }).status).not.toBe(0);
      expect(gate({ ...pulado, plano: planned({ banco: "false" }, "failure") }).status).not.toBe(0);
      expect(gate({ ...pulado, plano: planned({ banco: "false" }, "cancelled") }).status).not.toBe(0);
      expect(gate(pulado).status).not.toBe(0);
    });

    it("plano que não passou reprova até com o banco verde, e o banco vermelho reprova com o plano certo", () => {
      expect(gate({ ...ok, plano: planned({ banco: "true" }, "failure") }).status).not.toBe(0);
      expect(gate({ ...ok, plano: planned({ banco: "true" }, "skipped") }).status).not.toBe(0);
      for (const result of ["failure", "cancelled"]) {
        expect(gate({ "banco-nas-majors": { result }, plano: planned({ banco: "false" }) }).status, result).not.toBe(0);
      }
      expect(gate({}).status).not.toBe(0);
    });
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

    expect(needsOf(coverage)).toEqual(["plano", "testes"]);
    // Uma fatia vermelha não pode pular a mesclagem que mostra as falhas — mas
    // sem fatia nenhuma (PR L0, #535) não há blob para mesclar, e o
    // `!cancelled()` sozinho o rodaria assim mesmo.
    expect(coverage.if).toBe("${{ !cancelled() && needs.plano.outputs.suite == 'true' }}");
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
