import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * F3-04 — o SQL do vigia de cota (`supabase/cron/watchdog.sql`) não
 * referencia nenhuma tabela ou serviço hospedado em Vercel/GitHub como
 * dependência de EXECUÇÃO — só Supabase e as APIs externas que ele consulta
 * (ADR 0030 decisão 6: um vigia que depende do app hospedado na Vercel some
 * junto quando ela cai, e para de existir exatamente quando mais precisa).
 *
 * Teste estático de propósito, no espírito de `workflow-environment-isolation
 * .test.ts`: a falha que ele pega (alguém "simplificando" para chamar
 * `/api/cron/watchdog` de dentro do SQL) só apareceria num incidente real de
 * indisponibilidade da Vercel.
 */

const SQL = readFileSync("supabase/cron/watchdog.sql", "utf8");
const APP_HOST = "jobs.mastertimm.com.br";
const ALLOWED_CALL_HOSTS = ["https://api.vercel.com", "https://api.github.com", "https://www.githubstatus.com"];

function httpCallTargets(sql: string): string[] {
  // Cada `url := '<literal>'` que segue um `net.http_get(`/`net.http_post(`.
  // Não tenta resolver concatenação dinâmica (`|| variável`) — só o prefixo
  // literal, que é o que decide o host chamado.
  const targets: string[] = [];
  for (const match of sql.matchAll(/net\.http_(?:get|post)\(\s*\n?\s*url\s*:=\s*'([^']+)'/g)) {
    targets.push(match[1]!);
  }
  return targets;
}

/** Quantas vezes `net.http_get(`/`net.http_post(` aparece de fato no arquivo. */
function httpCallCount(sql: string): number {
  return [...sql.matchAll(/net\.http_(?:get|post)\(/g)].length;
}

/** Os blocos `create or replace function ... $$;` — onde `jho_cron_base_url` nunca pode aparecer. */
function functionBodies(sql: string): string[] {
  return [...sql.matchAll(/create or replace function[\s\S]*?\n\$\$;/g)].map((m) => m[0]);
}

describe("F3-04 — o vigia mora fora dos provedores monitorados", () => {
  it("todo net.http_get/post chama um host externo permitido, nunca o próprio app", () => {
    const targets = httpCallTargets(SQL);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(ALLOWED_CALL_HOSTS.some((host) => target.startsWith(host)), target).toBe(true);
      expect(target).not.toContain(APP_HOST);
    }
  });

  it("nenhum net.http_get/post escapa da extração — o nº de chamadas bate com o nº de alvos literais (minor #9)", () => {
    // Se alguém trocasse um `url := '<literal>'` por uma expressão 100%
    // dinâmica (sem prefixo literal nenhum), `httpCallTargets` deixaria de
    // vê-la, mas a chamada continuaria existindo — esta contagem cruzada pega
    // exatamente essa lacuna.
    expect(httpCallTargets(SQL).length).toBe(httpCallCount(SQL));
  });

  it("o domínio do próprio app só aparece na trava de ambiente, nunca como alvo de chamada", () => {
    const lines = SQL.split("\n");
    const withAppHost = lines.filter((line) => line.includes(APP_HOST));
    expect(withAppHost.length).toBeGreaterThan(0);
    for (const line of withAppHost) {
      // A trava compara `jho_cron_base_url` a este valor; nenhuma linha com o
      // domínio pode conter `net.http_get`/`net.http_post`.
      expect(line).not.toMatch(/net\.http_(get|post)/);
    }
  });

  it("jho_cron_base_url só aparece na trava de ambiente, nunca dentro do corpo de uma função (minor #9)", () => {
    const bodies = functionBodies(SQL);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain("jho_cron_base_url");
    }
  });

  it("nenhuma chamada depende de um workflow ou Action do GitHub para executar", () => {
    expect(SQL).not.toMatch(/workflow_dispatch|actions\/workflows\//);
  });

  it("os limiares citados no comentário batem com DEFAULT_QUOTA_THRESHOLDS (70/90, 10/20 min, 100/dia)", async () => {
    const { DEFAULT_QUOTA_THRESHOLDS } = await import("../src/contexts/operations/domain/quota-watch.ts");
    expect(DEFAULT_QUOTA_THRESHOLDS.vercelDailyDeployLimit).toBe(100);
    expect(DEFAULT_QUOTA_THRESHOLDS.vercelWarnRatio).toBe(0.7);
    expect(DEFAULT_QUOTA_THRESHOLDS.vercelActionRatio).toBe(0.9);
    // 70/90 aparecem como limiar inteiro (70/90 % de 100) no SQL.
    expect(SQL).toMatch(/vercel_deploys >= 90/);
    expect(SQL).toMatch(/vercel_deploys >= 70/);
    expect(DEFAULT_QUOTA_THRESHOLDS.actionsQueueWarnS).toBe(600);
    expect(DEFAULT_QUOTA_THRESHOLDS.actionsQueueActionS).toBe(1200);
    expect(SQL).toMatch(/actions_wait_s >= 1200/);
    expect(SQL).toMatch(/actions_wait_s >= 600/);
  });

  it("nenhum segredo em texto — só nome de secret do Vault (regra 16)", () => {
    expect(SQL).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    // Os dois segredos de verdade (PAT do GitHub, token da Vercel) só entram
    // como placeholder `<...>` no runbook do cabeçalho — nunca um valor real.
    for (const secret of ["watchdog_github_token", "watchdog_vercel_token"]) {
      const line = SQL.split("\n").find((l) => l.includes(`'${secret}'`) && l.includes("create_secret"));
      expect(line, secret).toBeDefined();
      expect(line).toMatch(/create_secret\('<[^']*>'/);
    }
  });
});
