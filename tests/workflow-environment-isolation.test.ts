import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * Suite: composição de ambiente nos workflows (F-08, IT-003)
 * Invariant: ingestão recorrente só existe em produção, e o contrato de
 * preview/staging não carrega credencial de produção.
 * Boundary IN: os arquivos de workflow e a configuração de cron, lidos como
 * dados — é o que o CI realmente executa.
 * Boundary OUT: a decisão da política, coberta por UT-001.
 *
 * Teste estático de propósito: a falha que ele pega não aparece em runtime até
 * alguém ter gastado cota ou vazado segredo, e aí já aconteceu.
 */

function workflow(name: string): Record<string, unknown> {
  return parse(readFileSync(`.github/workflows/${name}`, "utf8")) as Record<string, unknown>;
}

const INGESTION_WORKFLOWS = ["varredura.yml"] as const;

describe("IT-003 — ingestão recorrente é exclusiva de produção", () => {
  it("a varredura declara ambiente, allowlist e trava na branch de produção", () => {
    const parsed = workflow("varredura.yml") as { jobs: Record<string, any> };
    const job = parsed.jobs.varrer;

    // Três travas independentes: a branch, o ambiente do GitHub e a política
    // da aplicação. Uma sozinha é um esquecimento longe de um incidente.
    expect(job.if).toContain("refs/heads/main");
    expect(job.environment).toBe("production");
    expect(job.env.JHO_ENV).toBe("production");
    expect(String(job.env.JHO_SOURCE_ALLOWLIST)).toContain("JHO_SOURCE_ALLOWLIST");
  });

  it("nenhum workflow fora de produção declara ambiente de ingestão permitido", () => {
    for (const file of ["ci.yml", "promover-para-staging.yml", "sincronizar-apos-main.yml"]) {
      const raw = readFileSync(`.github/workflows/${file}`, "utf8");

      expect(raw, file).not.toMatch(/JHO_ENV:\s*production/);
      expect(raw, file).not.toMatch(/JHO_INGESTION_OPT_IN:\s*true/);
    }
  });

  it("segredo de banco de produção só aparece em job com ambiente de produção", () => {
    for (const file of ["ci.yml", "promover-para-staging.yml", "sincronizar-apos-main.yml"]) {
      const raw = readFileSync(`.github/workflows/${file}`, "utf8");

      // O CI roda em PR de qualquer branch: uma credencial de produção aqui
      // fica ao alcance de quem abrir uma PR.
      expect(raw, file).not.toContain("SUPABASE_DATABASE_URL");
      expect(raw, file).not.toContain("SUPABASE_MIGRATION_URL");
    }
  });

  it("os workflows que tocam produção pedem o ambiente protegido do GitHub", () => {
    for (const file of [...INGESTION_WORKFLOWS, "migrate.yml", "manutencao-banco.yml"]) {
      const parsed = workflow(file) as { jobs: Record<string, any> };

      for (const [name, job] of Object.entries(parsed.jobs)) {
        const usesProductionSecret = JSON.stringify(job.env ?? {}).includes("SUPABASE_");
        if (!usesProductionSecret) continue;
        expect(job.environment, `${file}:${name}`).toBe("production");
      }
    }
  });
});

describe("IT-003 — o contrato de ambiente não vaza produção", () => {
  it("o exemplo de ambiente não carrega URL, token nem segredo real", () => {
    const example = readFileSync(".env.example", "utf8");

    // O arquivo é um molde: `<project-ref>` e `<senha-url-encoded>` devem
    // aparecer. O que não pode é o ref concreto do projeto nem uma senha —
    // template vira segredo no dia em que alguém cola a URL que funcionou.
    for (const line of example.split("\n")) {
      if (!/postgres(ql)?:\/\//.test(line)) continue;
      // Credencial de loopback pode ser literal: ela só alcança a máquina de
      // quem a lê. URL remota, não — essa vira segredo assim que funcionar.
      if (/@(127\.0\.0\.1|localhost|\[::1\])/.test(line)) continue;
      expect(line, line.trim().slice(0, 60)).toMatch(/<[a-z-]+>/);
    }
    expect(example).not.toContain("bujawvnxwtmneiggizje");
    expect(example).not.toMatch(/bearer\s|sk-[a-z0-9]{10}|re_[a-z0-9]{10}/i);
    // Nome de variável é contrato e pode aparecer; valor não.
    expect(example).toContain("DATABASE_URL");
  });

  it("o cron da Vercel aponta para uma rota que consulta a política", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: { path: string }[];
    };
    const paths = (vercel.crons ?? []).map((cron) => cron.path);

    expect(paths).toContain("/api/cron/recheck");

    const route = readFileSync("app/api/cron/recheck/route.ts", "utf8");
    // Segredo prova quem chama; a política diz se este deployment pode gastar
    // cota. Um preview com o segredo herdado continuaria autenticado.
    expect(route).toContain("canRunIngestion");
    expect(route).toContain("CRON_SECRET");
  });
});
