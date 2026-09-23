import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * Suite: o E2E de navegador no CI (governança task_08, V08-02)
 * Invariant: o CI executa a suíte hermética inteira, sem segredo e sem banco
 * que não seja o descartável do próprio harness — e ainda não é obrigatório.
 * Boundary IN: `.github/workflows/ci.yml` lido como dado, que é o que o
 * GitHub executa.
 * Boundary OUT: se a suíte reprova falha real — é o próprio job rodando.
 */

type Step = { name?: string; run?: string; uses?: string; if?: string; with?: Record<string, unknown> };
type Job = {
  if?: string;
  needs?: string[];
  env?: Record<string, unknown>;
  services?: unknown;
  permissions?: Record<string, string>;
  "timeout-minutes"?: number;
  steps: Step[];
};

const raw = readFileSync(".github/workflows/ci.yml", "utf8");
const workflow = parse(raw) as { jobs: Record<string, Job> };
const job = workflow.jobs["e2e-navegador"]!;

describe("V08-02 — o CI roda o navegador geral", () => {
  it("o job existe e executa o runner hermético, não um atalho", () => {
    expect(job).toBeDefined();
    const runs = job.steps.map((step) => step.run ?? "");
    expect(runs).toContain("pnpm test:e2e");
    // `test:e2e:external` mediria um servidor e um banco que ninguém isolou.
    expect(runs.join("\n")).not.toContain("test:e2e:external");
  });

  it("fica separado do portão `qualidade`, com teto de tempo próprio", () => {
    const quality = workflow.jobs.qualidade!.steps.map((step) => step.run ?? "").join("\n");
    expect(quality).not.toContain("test:e2e");
    expect(job.needs ?? []).toEqual([]);
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(60);
  });

  it("não carrega segredo, banco externo nem permissão de escrita", () => {
    const text = JSON.stringify(job);
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/DATABASE_URL|POSTGRES_URL|SUPABASE_/);
    // O harness sobe o próprio PostgreSQL no loopback; um `services:` seria um
    // segundo banco, fora do caminho que `database-guard.mjs` protege.
    expect(job.services).toBeUndefined();
    expect(job.permissions).toEqual({ contents: "read" });
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("guarda os navegadores em cache pela versão do Playwright e instala o WebKit", () => {
    const restore = job.steps.find((step) => step.uses?.startsWith("actions/cache/restore@"));
    expect(restore?.with?.path).toBe("~/.cache/ms-playwright");
    expect(String(restore?.with?.key)).toContain("steps.playwright.outputs.version");
    // Gravação própria, fora do pós-job: o `actions/cache` inteiro só grava em
    // job verde, e uma suíte vermelha baixaria os navegadores toda vez.
    const save = job.steps.find((step) => step.uses?.startsWith("actions/cache/save@"));
    expect(save?.with?.path).toBe("~/.cache/ms-playwright");
    expect(String(save?.with?.key)).toContain("cache-primary-key");
    expect(job.steps.some((step) => /^actions\/cache@/.test(step.uses ?? ""))).toBe(false);
    const install = job.steps.map((step) => step.run ?? "").join("\n");
    expect(install).toMatch(/playwright install --with-deps chromium webkit/);
    expect(install).toMatch(/playwright install-deps chromium webkit/);
  });

  it("ainda não é obrigatório: fora de `validacao` e fora da chamada da promoção", () => {
    // Tornar obrigatório espera a medição de instabilidade (issue #202).
    // Quem mudar isto muda também este teste, de propósito.
    expect(workflow.jobs.validacao!.needs).not.toContain("e2e-navegador");
    expect(job.if).toBe("inputs.target-sha == ''");
  });

  it("a PWA continua no portão obrigatório", () => {
    const quality = workflow.jobs.qualidade!.steps.map((step) => step.run ?? "").join("\n");
    expect(quality).toContain("pnpm test:pwa-browser");
  });
});
