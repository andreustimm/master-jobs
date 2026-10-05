// Suite: runner de CI selecionável por variável, sem literal novo, sem fork
//   no runner próprio (issue #367, Fase 2 da contingência de CI/deploy)
// Invariant: todo `runs-on:` de `ci.yml` é a mesma expressão — ausência de
//   `vars.CI_RUNS_ON` mantém o hospedado, e PR de fork nunca resolve para o
//   runner próprio, mesmo com a variável setada (ADR 0030 decisões 1 e 4)
// Boundary IN: `.github/workflows/ci.yml` e a fixture desta suíte, lidos como
//   dado (YAML), e `scripts/github/fork-guard.ts`, executado de verdade
// Boundary OUT: o motor de expressões do GitHub Actions e o runner real
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isForkPullRequest, type WorkflowEvent } from "../scripts/github/fork-guard.ts";
import {
  CANONICAL_RUNS_ON,
  ciWorkflow,
  ciWorkflowFrom,
  resolveCanonicalRunsOn,
  runsOnViolations,
} from "./support/ci-workflow.ts";

const ci = ciWorkflow();

/**
 * Os mesmos eventos-fixture de F2-03, reaproveitados pelo teste de
 * equivalência de F2-04 (m4, re-revisão): a mesma lista de entrada prova que
 * `isForkPullRequest` e `resolveCanonicalRunsOn` concordam evento a evento,
 * não só em dois exemplos escolhidos à parte para cada um.
 */
const FORK_GUARD_FIXTURE_EVENTS: Array<{ description: string; event: WorkflowEvent }> = [
  {
    description: "pull_request de fork",
    event: {
      eventName: "pull_request",
      pullRequestHeadRepoFullName: "outra-conta/master-jobs",
      repository: "andreustimm/master-jobs",
    },
  },
  {
    description: "pull_request do próprio repositório",
    event: {
      eventName: "pull_request",
      pullRequestHeadRepoFullName: "andreustimm/master-jobs",
      repository: "andreustimm/master-jobs",
    },
  },
  {
    description: "push de branch de tarefa",
    event: { eventName: "push", repository: "andreustimm/master-jobs" },
  },
  {
    description: "workflow_dispatch",
    event: { eventName: "workflow_dispatch", repository: "andreustimm/master-jobs" },
  },
  {
    description: "workflow_call (chamada reutilizável da promoção)",
    event: { eventName: "workflow_call", repository: "andreustimm/master-jobs" },
  },
];

describe("F2-01 — runs-on só pela variável, sem literal novo", () => {
  it("todo job de ci.yml usa a mesma expressão canônica", () => {
    expect(Object.keys(ci.jobs).length).toBeGreaterThan(0);
    expect(runsOnViolations(ci)).toEqual([]);
  });

  it("a expressão cai no hospedado quando CI_RUNS_ON está ausente/vazia", () => {
    expect(CANONICAL_RUNS_ON).toContain("fromJSON(vars.CI_RUNS_ON || '\"ubuntu-latest\"')");
  });
});

describe("F2-02 — o gate pega regressão, não só o estado atual", () => {
  it("reprova um job novo com runs-on literal na fixture, sem tocar em ci.yml real", () => {
    const fixture = ciWorkflowFrom(readFileSync("tests/fixtures/ci-runner-selection/job-com-literal.yml", "utf8"));
    expect(runsOnViolations(fixture)).toEqual(["job-novo-com-literal"]);
  });
});

describe("F2-03 — a guarda de fork é uma função pura testável isolada", () => {
  it("é true só para pull_request cuja head pertence a outro repositório", () => {
    const [forkPr] = FORK_GUARD_FIXTURE_EVENTS;
    expect(isForkPullRequest(forkPr!.event)).toBe(true);
  });

  it("é false para pull_request do próprio repositório", () => {
    const [, ownPr] = FORK_GUARD_FIXTURE_EVENTS;
    expect(isForkPullRequest(ownPr!.event)).toBe(false);
  });

  it("é false para push, mesmo sem head de PR nenhuma", () => {
    const push = FORK_GUARD_FIXTURE_EVENTS.find((fixture) => fixture.event.eventName === "push")!;
    expect(isForkPullRequest(push.event)).toBe(false);
  });

  it("é false para workflow_dispatch e para o workflow_call da promoção", () => {
    for (const eventName of ["workflow_dispatch", "workflow_call"]) {
      const fixture = FORK_GUARD_FIXTURE_EVENTS.find((entry) => entry.event.eventName === eventName)!;
      expect(isForkPullRequest(fixture.event)).toBe(false);
    }
  });
});

describe("F2-04 — a guarda de F2-03 está embutida em todo runs-on que pode resolver self-hosted", () => {
  it("a expressão canônica usa exatamente a comparação de isForkPullRequest", () => {
    // As duas fontes (aqui e scripts/github/fork-guard.ts) não podem divergir
    // sem que este teste, ou o de F2-03, quebre primeiro.
    expect(CANONICAL_RUNS_ON).toContain("github.event_name == 'pull_request'");
    expect(CANONICAL_RUNS_ON).toContain(
      "github.event.pull_request.head.repo.full_name != github.repository",
    );
    // Trava o fragmento exato, não só as duas metades soltas: prova que o
    // `&&`/`||` que decide "fork cai no hospedado, senão lê a variável" está
    // na ordem certa, não só que as palavras aparecem em algum lugar
    // (revisão L2 da PR #376, minor F2-04).
    expect(CANONICAL_RUNS_ON).toContain("!= github.repository && 'ubuntu-latest' ||");
    // A guarda decide ANTES do fromJSON: uma PR de fork nunca alcança
    // `vars.CI_RUNS_ON`, mesmo que ela aponte para o runner próprio.
    const guardIndex = CANONICAL_RUNS_ON.indexOf("head.repo.full_name != github.repository");
    const fromJsonIndex = CANONICAL_RUNS_ON.indexOf("fromJSON(vars.CI_RUNS_ON");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(fromJsonIndex).toBeGreaterThan(guardIndex);
  });

  it("nenhum job de ci.yml escapa da expressão guardada — nenhum literal e nenhuma variação", () => {
    for (const [name, job] of Object.entries(ci.jobs)) {
      expect(job["runs-on"], name).toBe(CANONICAL_RUNS_ON);
    }
  });

  it("m4 (re-revisão) — resolve para o MESMO runner que isForkPullRequest decidiria, evento a evento", () => {
    // Prova de equivalência de comportamento, não só de texto: para cada
    // evento de F2-03, o mini-avaliador da expressão canônica
    // (`resolveCanonicalRunsOn`) e a função pura (`isForkPullRequest`)
    // precisam concordar sobre quando o runner próprio é alcançado — com
    // `CI_RUNS_ON` setado para o runner próprio E com a variável ausente.
    const selfHosted = '["self-hosted","linux","master-jobs"]';
    for (const { description, event } of FORK_GUARD_FIXTURE_EVENTS) {
      const isFork = isForkPullRequest(event);

      const resolvedWithSelfHosted = resolveCanonicalRunsOn(event, selfHosted);
      expect(resolvedWithSelfHosted === "ubuntu-latest", description).toBe(isFork);
      if (!isFork) {
        expect(resolvedWithSelfHosted, description).toEqual(["self-hosted", "linux", "master-jobs"]);
      }

      // Sem CI_RUNS_ON, todo mundo cai no hospedado de qualquer forma — a
      // guarda de fork nunca é o único motivo de ver ubuntu-latest aqui.
      expect(resolveCanonicalRunsOn(event, undefined), description).toBe("ubuntu-latest");
    }
  });
});

describe("C1 (re-revisão de 29/09/2026) — job nunca sobe com --privileged", () => {
  // `--privileged`, se usado no `docker run` do controller, daria ao
  // contêiner do JOB acesso aos dispositivos de bloco do PRÓPRIO HOST — o
  // job poderia montar `/dev/sda` de dentro de si e ler
  // `/etc/master-jobs-runner/env` (o PAT que controla até a política de
  // aprovação de fork). `sysbox-runc` é o runtime que substitui essa
  // necessidade sem abrir mão do isolamento.
  const runnerScriptFiles = readdirSync("scripts/runner")
    .filter((name) => !name.endsWith(".md"))
    .map((name) => ({ name, content: readFileSync(join("scripts/runner", name), "utf8") }));

  it("existem scripts do runner para inspecionar", () => {
    expect(runnerScriptFiles.length).toBeGreaterThan(0);
  });

  it("nenhuma invocação de docker run/dockerd usa --privileged", () => {
    // Comentários e mensagens de log (`log "..."`, `echo "..."`) citam
    // "--privileged" de propósito, para explicar por que ele NÃO é usado — o
    // que a suíte precisa travar é a invocação de verdade
    // (`docker run ... --privileged`), não qualquer ocorrência textual do
    // nome da flag dentro de uma string.
    const isProseLine = (line: string) => {
      const trimmed = line.trim();
      return trimmed.startsWith("#") || trimmed.startsWith("log \"") || trimmed.startsWith("echo \"");
    };
    const invocationStart = /^\s*(exec\s+)?(docker\s+run|dockerd)\b/;
    let totalInvocations = 0;
    for (const file of runnerScriptFiles) {
      const invocationLines = file.content
        .split("\n")
        .filter((line) => !isProseLine(line) && invocationStart.test(line));
      totalInvocations += invocationLines.length;
      for (const line of invocationLines) {
        expect(line, file.name).not.toContain("--privileged");
      }
    }
    // Sanity: prova que o filtro de linhas acha as invocações de verdade
    // (docker run do controller + dockerd do entrypoint), não que a
    // varredura ficou vazia por engano e "passou" sem checar nada.
    expect(totalInvocations).toBeGreaterThanOrEqual(2);
  });

  it("o docker run do controller usa --runtime=sysbox-runc", () => {
    const controller = runnerScriptFiles.find((file) => file.name === "runner-controller.sh");
    expect(controller, "runner-controller.sh não encontrado").toBeDefined();
    expect(controller!.content).toMatch(/docker run\b[^\n]*--runtime=sysbox-runc/);
  });
});

describe("M2 (revisão L2 da PR #376) — instalação do Playwright pula no runner próprio", () => {
  // `--with-deps`/`install-deps` pedem apt/sudo, que o job do runner próprio
  // não tem — e não precisa, com Chromium/WebKit já na imagem
  // (scripts/runner/Dockerfile). `runner.environment` é `github-hosted` ou
  // `self-hosted`, contexto do próprio GitHub Actions.
  const stepsThatInstallBrowsers = Object.values(ci.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => /playwright (install|install-deps)\b.*(--with-deps|chromium|webkit)/.test(step.run ?? ""));

  it("existe ao menos um passo de instalação de navegador para proteger", () => {
    expect(stepsThatInstallBrowsers.length).toBeGreaterThan(0);
  });

  it("todo passo que instala navegador/dependência do Playwright exige runner hospedado", () => {
    for (const step of stepsThatInstallBrowsers) {
      expect(step.if, step.name ?? step.run).toContain("runner.environment != 'self-hosted'");
    }
  });
});

describe("Minor SIGTERM (issue #367) — o entrypoint repassa o sinal de parada ao run.sh", () => {
  // O entrypoint é o PID 1 do contêiner: sem handler, o kernel descarta
  // SIGTERM e o `docker stop` do host espera o timeout e mata com SIGKILL.
  // O que dá para provar sem root nem docker: a forma do script (estático) e
  // o comportamento da lógica de supervisão com um runner de mentira, em bash
  // puro. Ficam de fora, e só um runner de verdade prova: `setpriv` trocando
  // para o usuário `runner` e o `run.sh` do GitHub reagindo ao SIGTERM.
  const entrypoint = readFileSync("scripts/runner/entrypoint.sh", "utf8");
  const codeLines = entrypoint.split("\n").filter((line) => !line.trim().startsWith("#"));
  const code = codeLines.join("\n");

  it("instala trap para TERM e INT", () => {
    expect(code).toMatch(/^\s*trap\s+'[^']*'\s+TERM\b/m);
    expect(code).toMatch(/^\s*trap\s+'[^']*'\s+INT\b/m);
  });

  it("o run.sh roda em segundo plano, sem a camada do su, e o laço de wait espera o filho de verdade", () => {
    expect(code).toMatch(/^\s*launch_runner_process\s+&\s*$/m);
    expect(code).not.toMatch(/\bsu\s+-/);
    expect(code).toMatch(/while true; do\s+wait "\$RUNNER_PID"/);
    expect(code).toContain("exec env -i");
    expect(code).toMatch(/setpriv --reuid=runner/);
  });

  it("o código 75 só sai depois de run.sh status 0 e ausência do log de Worker", () => {
    const sentinelExits = codeLines.filter((line) => line.includes('exit "$NO_JOB_PICKED_UP_EXIT_CODE"'));
    expect(sentinelExits).toHaveLength(1);
    const statusGuardIndex = code.indexOf('if [ "$run_status" -ne 0 ]');
    const guardIndex = code.indexOf('! compgen -G "${RUNNER_RUNTIME}/_diag/Worker_*.log"');
    const sentinelIndex = code.indexOf('exit "$NO_JOB_PICKED_UP_EXIT_CODE"');
    expect(statusGuardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(statusGuardIndex);
    expect(sentinelIndex).toBeGreaterThan(guardIndex);
  });

  it("para o dockerd interno na saída", () => {
    expect(code).toMatch(/^\s*trap stop_isolated_dockerd EXIT\s*$/m);
  });

  describe("comportamento, com um runner de mentira (bash puro, sem root nem docker)", () => {
    const stubScript = [
      'case "$STUB_MODE" in',
      "  wait-for-term)",
      "    trap 'echo term > \"$MARKER_DIR/received-term\"; exit 0' TERM",
      '    echo ready > "$MARKER_DIR/ready"',
      "    while :; do sleep 0.05; done ;;",
      "  exit-clean) exit 0 ;;",
      "  worker-log) mkdir -p _diag; : > _diag/Worker_1.log; exit 0 ;;",
      "  fail) exit 3 ;;",
      "esac",
      "",
    ].join("\n");

    const harness = [
      "set -euo pipefail",
      'source "$ENTRYPOINT"',
      'RUNNER_RUNTIME="$TEST_RUNTIME"',
      "prepare_writable_runtime_copy() { :; }",
      "start_isolated_dockerd() { :; }",
      'launch_runner_process() { cd "$RUNNER_RUNTIME"; exec bash "$STUB_SCRIPT"; }',
      "main",
    ].join("\n");

    type Run = { child: ChildProcess; dir: string; done: Promise<number | null> };

    function start(mode: string): Run {
      const dir = mkdtempSync(join(tmpdir(), "entrypoint-"));
      const runtime = join(dir, "runtime");
      mkdirSync(runtime);
      writeFileSync(join(dir, "stub.sh"), stubScript);
      const child = spawn("bash", ["-c", harness], {
        env: {
          ...process.env,
          ENTRYPOINT: join(process.cwd(), "scripts/runner/entrypoint.sh"),
          JIT_CONFIG: "jit-de-mentira",
          TEST_RUNTIME: runtime,
          STUB_SCRIPT: join(dir, "stub.sh"),
          STUB_MODE: mode,
          MARKER_DIR: dir,
        },
        stdio: "ignore",
      });
      const done = new Promise<number | null>((resolve) => child.on("close", (exitCode) => resolve(exitCode)));
      return { child, dir, done };
    }

    async function waitForFile(path: string) {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (existsSync(path)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`arquivo não apareceu: ${path}`);
    }

    it("run.sh sem log de Worker e status 0 sai com 75", async () => {
      expect(await start("exit-clean").done).toBe(75);
    });

    it("run.sh com log de Worker e status 0 sai com 0", async () => {
      expect(await start("worker-log").done).toBe(0);
    });

    it("status diferente de 0 do run.sh propaga", async () => {
      expect(await start("fail").done).toBe(3);
    });

    it("SIGTERM chega ao runner, o entrypoint espera ele sair e termina com 143, nunca 75", async () => {
      const run = start("wait-for-term");
      await waitForFile(join(run.dir, "ready"));
      run.child.kill("SIGTERM");
      expect(await run.done).toBe(143);
      // O runner de mentira sai 0 sem log de Worker ao receber o sinal: sem o
      // desvio de parada, o entrypoint leria isso como "nenhum job" (75).
      expect(existsSync(join(run.dir, "received-term"))).toBe(true);
    }, 15_000);

    it("SIGINT também chega ao runner (como SIGTERM) e termina com 130", async () => {
      const run = start("wait-for-term");
      await waitForFile(join(run.dir, "ready"));
      run.child.kill("SIGINT");
      expect(await run.done).toBe(130);
      expect(existsSync(join(run.dir, "received-term"))).toBe(true);
    }, 15_000);
  });
});
