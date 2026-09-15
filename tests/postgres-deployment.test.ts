import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { expect, it } from "vitest";

it("requires manual main dispatch and the production environment for migrations", () => {
  const workflow = parse(readFileSync(".github/workflows/migrate.yml", "utf8"));
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.jobs.migrar.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.migrar.if).toContain("inputs.confirm_project == 'bujawvnxwtmneiggizje'");
  expect(workflow.jobs.migrar.environment).toBe("production");
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  const step = workflow.jobs.migrar.steps.find((s: { env?: unknown }) => s.env);
  expect(step.env.DATABASE_MIGRATION_URL).toBe("${{ secrets.SUPABASE_MIGRATION_URL }}");
  expect(step.env.DATABASE_URL).toBeUndefined();
});

it("keeps crawlers opt-in and gives them only runtime credentials", () => {
  const workflow = parse(readFileSync(".github/workflows/varredura.yml", "utf8"));
  expect(workflow.jobs.varrer.if).toContain("vars.SUPABASE_CRAWL_ENABLED == 'true'");
  expect(workflow.jobs.varrer.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.varrer.env.DATABASE_URL).toBe("${{ secrets.SUPABASE_DATABASE_URL }}");
  expect(workflow.jobs.varrer.env.DATABASE_MIGRATION_URL).toBeUndefined();
});

it("rejects missing, malformed, other-project and insecure migration destinations without leaking secrets", () => {
  for (const url of ["", "secret-invalid-url", "postgres://postgres:secret-password@localhost/postgres",
    "postgres://postgres.other:secret-password@aws-0-sa-east-1.pooler.supabase.com/postgres",
    "postgres://postgres.bujawvnxwtmneiggizje:secret-password@aws-0-sa-east-1.pooler.supabase.com/postgres?sslmode=disable"]) {
    const result = spawnSync("bash", [".github/scripts/migrar.sh"], {
      encoding: "utf8", env: { ...process.env, DATABASE_MIGRATION_URL: url },
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("secret-password");
    expect(result.stdout + result.stderr).not.toContain("secret-invalid-url");
  }
});

it("bundles the provider CA as a server tracing asset", () => {
  const certificate = new X509Certificate(readFileSync("config/certs/supabase-ca.crt"));
  expect(certificate.ca).toBe(true);
  expect(certificate.subject).toContain("Supabase Root 2021 CA");
  expect(Date.parse(certificate.validTo)).toBeGreaterThan(Date.parse("2030-01-01"));
  expect(readFileSync("next.config.ts", "utf8")).toContain('"./config/certs/supabase-ca.crt"');
});
