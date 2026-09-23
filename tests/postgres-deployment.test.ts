import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { expect, it } from "vitest";

it("migrates main on push only for drizzle/postgres, and manual dispatch still needs the typed project ref", () => {
  const workflow = parse(readFileSync(".github/workflows/migrate.yml", "utf8"));
  expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_dispatch"]);
  // Só main, e só quando o push traz migração: dev e staging não têm banco
  // próprio ainda, e um push sem migração não tem o que aplicar.
  expect(workflow.on.push).toEqual({ branches: ["main"], paths: ["drizzle/postgres/**"] });
  expect(workflow.jobs.migrar.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.migrar.if).toContain("github.event_name == 'push' || inputs.confirm_project == 'bujawvnxwtmneiggizje'");
  expect(workflow.jobs.migrar.environment).toBe("production");
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  const step = workflow.jobs.migrar.steps.find((s: { env?: unknown }) => s.env);
  expect(step.env.DATABASE_MIGRATION_URL).toBe("${{ secrets.SUPABASE_MIGRATION_URL }}");
  expect(step.env.DATABASE_URL).toBeUndefined();
  // O push nunca aplica o que não for aditivo; só o disparo humano aplica o lote inteiro.
  expect(step.env.MIGRATION_MODE).toBe("${{ github.event_name == 'push' && 'aditiva' || 'revisada' }}");
  const script = readFileSync(".github/scripts/migrar.sh", "utf8");
  expect(script).toMatch(/aditiva\) flags=\(--additive-only\)/);
});

it("refuses to migrate without an explicit, known mode", () => {
  for (const mode of [undefined, "", "completa", "ADITIVA"]) {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_MIGRATION_URL: "postgres://x:secret-password@localhost/postgres" };
    delete env.MIGRATION_MODE;
    if (mode !== undefined) env.MIGRATION_MODE = mode;
    const result = spawnSync("bash", [".github/scripts/migrar.sh"], { encoding: "utf8", env });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("MIGRATION_MODE deve ser 'aditiva' ou 'revisada'");
    expect(result.stdout + result.stderr).not.toContain("secret-password");
  }
});

it("keeps crawlers opt-in and gives them only runtime credentials", () => {
  const workflow = parse(readFileSync(".github/workflows/varredura.yml", "utf8"));
  expect(workflow.jobs.varrer.if).toContain("vars.SUPABASE_CRAWL_ENABLED == 'true'");
  expect(workflow.jobs.varrer.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.varrer.env.DATABASE_URL).toBe("${{ secrets.SUPABASE_DATABASE_URL }}");
  expect(workflow.jobs.varrer.env.DATABASE_MIGRATION_URL).toBeUndefined();
});

it("lets a slow sync time out without taking the day's terms and scores with it", () => {
  // The 1.15.0 sweep spent its whole hour syncing and was cancelled before the
  // saved terms, captures and scores ran. The sync gets its own ceiling, the
  // later steps run on what it stored, and the run still ends red.
  const workflow = parse(readFileSync(".github/workflows/varredura.yml", "utf8"));
  const steps: { id?: string; name?: string; if?: string; run?: string; "continue-on-error"?: boolean; "timeout-minutes"?: number }[] =
    workflow.jobs.varrer.steps;
  const sync = steps.find((s) => s.run === "pnpm jho jobs sync");
  expect(sync?.id).toBe("sync");
  expect(sync?.["continue-on-error"]).toBe(true);
  expect(sync?.["timeout-minutes"]).toBeLessThan(workflow.jobs.varrer["timeout-minutes"]);
  const after = steps.slice(steps.indexOf(sync!) + 1);
  expect(after.some((s) => s.run === "pnpm jho terms run")).toBe(true);
  // O passo pode ter condição — a rotina pedida na tela do admin gateia cada um
  // —, mas ela não pode depender do resultado do sync: é justamente isso que
  // fazia o dia inteiro parar quando a busca nas fontes estourava o tempo.
  const nota = after.find((s) => s.run === "pnpm jho jobs score --every-candidate");
  expect(nota).toBeDefined();
  expect(nota?.if ?? "").not.toContain("steps.sync");
  const alarm = after.find((s) => s.if?.includes("steps.sync.outcome == 'failure'"));
  expect(alarm?.if).toContain("always()");
  expect(alarm?.run).toContain("exit 1");
});

it("conferência de produção espera a versão promovida antes de julgar", () => {
  // Um `sleep` fixo testaria o deploy anterior e passaria verde sem provar nada:
  // o deploy da Vercel dispara do mesmo push. A página de login carrega a versão,
  // então a espera tem critério.
  const workflow = parse(readFileSync(".github/workflows/fumaca-producao.yml", "utf8")) as {
    on: { push: { branches: string[] } };
    jobs: { fumaca: { steps: { name?: string; run?: string }[] } };
  };
  expect(workflow.on.push.branches).toEqual(["main"]);

  const passos = workflow.jobs.fumaca.steps;
  const espera = passos.find((s) => s.name?.includes("Esperar o deploy"))?.run ?? "";
  expect(espera).toContain("steps.versao.outputs.esperada");
  expect(espera).toContain("exit 1");

  // Pelo atributo, e não por "número com dois pontos": o primeiro casamento no
  // HTML era hash de asset, e a primeira execução real reprovou comparando
  // `022.617.46` com `1.17.1`. Os dois lados do contrato ficam presos aqui.
  expect(espera).toContain("data-app-version=");
  expect(readFileSync("app/footer.tsx", "utf8")).toContain("data-app-version={versao}");

  // Rota autenticada redireciona; nunca 5xx. `/p/` inexistente é 404 e não 403,
  // porque 403 confirmaria que o slug existe.
  const fumaca = passos.find((s) => s.name?.includes("Rotas públicas"))?.run ?? "";
  for (const linha of [
    "conferir /login 200",
    "conferir / 307",
    "conferir /jobs 307",
    "conferir /api/export 307",
    "conferir /p/slug-que-nao-existe 404",
  ]) {
    expect(fumaca, linha).toContain(linha);
  }
  // A ordem importa: fumaça depois da espera, ou ela julga a versão velha.
  expect(passos.findIndex((s) => s.name?.includes("Esperar o deploy")))
    .toBeLessThan(passos.findIndex((s) => s.name?.includes("Rotas públicas")));
});

it("keeps scheduled retention on the PostgreSQL runtime contract", () => {
  const workflow = parse(readFileSync(".github/workflows/manutencao-banco.yml", "utf8"));
  expect(workflow.jobs.limpar.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.limpar.environment).toBe("production");
  expect(workflow.jobs.limpar.env.DATABASE_URL).toBe("${{ secrets.SUPABASE_DATABASE_URL }}");
  expect(workflow.jobs.limpar.env.DATABASE_CA_CERT).toBe("config/certs/supabase-ca.crt");
  expect(workflow.jobs.limpar.env.TURSO_DATABASE_URL).toBeUndefined();
  expect(workflow.jobs.limpar.env.TURSO_AUTH_TOKEN).toBeUndefined();
  const validation = workflow.jobs.limpar.steps.find((s: { name?: string }) => s.name === "Validar credencial");
  expect(validation.run).toContain("DATABASE_URL");
});

it("rejects missing, malformed, other-project and insecure migration destinations without leaking secrets", () => {
  for (const url of ["", "secret-invalid-url", "postgres://postgres:secret-password@localhost/postgres",
    "postgres://postgres.other:secret-password@aws-0-sa-east-1.pooler.supabase.com/postgres",
    "postgres://postgres.bujawvnxwtmneiggizje:secret-password@aws-0-sa-east-1.pooler.supabase.com/postgres?sslmode=disable"]) {
    // Os dois modos passam pela mesma validação de destino.
    for (const mode of ["aditiva", "revisada"]) {
      const result = spawnSync("bash", [".github/scripts/migrar.sh"], {
        encoding: "utf8", env: { ...process.env, DATABASE_MIGRATION_URL: url, MIGRATION_MODE: mode },
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("MIGRATION_MODE");
      expect(result.stdout + result.stderr).not.toContain("secret-password");
      expect(result.stdout + result.stderr).not.toContain("secret-invalid-url");
    }
  }
});

it("bundles the provider CA as a server tracing asset", () => {
  const certificate = new X509Certificate(readFileSync("config/certs/supabase-ca.crt"));
  expect(certificate.ca).toBe(true);
  expect(certificate.subject).toContain("Supabase Root 2021 CA");
  expect(Date.parse(certificate.validTo)).toBeGreaterThan(Date.parse("2030-01-01"));
  expect(readFileSync("next.config.ts", "utf8")).toContain('"./config/certs/supabase-ca.crt"');
});
