import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { assertProductionTarget, PRODUCTION_PROJECT_REF } from "../scripts/migration/production-target.ts";

it("accepts only the authorized direct or São Paulo session connection", () => {
  for (const authority of [`postgres:synthetic@db.${PRODUCTION_PROJECT_REF}.supabase.co`,
    `postgres.${PRODUCTION_PROJECT_REF}:synthetic@aws-0-sa-east-1.pooler.supabase.com:5432`]) {
    const url = `postgresql://${authority}/postgres`;
    expect(assertProductionTarget(url)).toBe(url);
  }
});

it("rejects other projects, identities, databases, ports and TLS overrides", () => {
  const valid = `postgresql://postgres.${PRODUCTION_PROJECT_REF}:synthetic@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
  for (const value of [undefined, "synthetic-secret", valid.replace(PRODUCTION_PROJECT_REF, "other"),
    valid.replace(":5432", ":6543"), valid.replace("/postgres", "/other"),
    valid.replace(":synthetic@", "@"), valid + "?sslmode=disable", valid + "#fragment",
    valid.replace("sa-east-1", "us-east-1"), valid.replace("postgresql:", "https:")]) {
    expect(() => assertProductionTarget(value)).toThrow();
    try { assertProductionTarget(value); }
    catch (error) { expect(String(error)).not.toContain("synthetic"); }
  }
});

it("reports argument failures without echoing sensitive arguments or connecting", () => {
  const result = spawnSync(process.execPath, ["scripts/migration/production.ts", "--synthetic-secret"], {
    encoding: "utf8", env: { ...process.env, DATABASE_MIGRATION_URL: "synthetic-credential" },
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("synthetic");
  expect(JSON.parse(result.stderr)).toMatchObject({ status: "failed", stage: "arguments" });
});

it("refuses manual QA seeding outside a local provisioned database", () => {
  for (const url of ["", "synthetic-private-credential", "postgres://postgres:synthetic@localhost/postgres",
    `postgres://postgres:synthetic@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`]) {
    const result = spawnSync(process.execPath, ["tests/e2e/setup-manual.ts"], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Manual QA requires a freshly provisioned isolated test database");
    expect(result.stderr).not.toContain("synthetic@");
    expect(result.stderr).not.toContain("synthetic-private-credential");
  }
  // Quatro processos Node inteiros, um por URL recusada: 2,2s nesta máquina e
  // mais no runner, onde estourou o limite padrão de 5s e reprovou uma PR que
  // não tocava este arquivo. O caso declara o tempo que precisa em vez de
  // depender da máquina estar de bom humor.
}, 30_000);
