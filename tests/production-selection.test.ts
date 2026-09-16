import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { afterEach, beforeEach, expect, it } from "vitest";
import { connectDatabase } from "../src/core/db/client.ts";
import { importProduction } from "../scripts/migration/import-production.ts";
import { selectProduction } from "../scripts/migration/select-production.ts";
import { PRODUCTION_PROJECT_REF } from "../scripts/migration/production-target.ts";
import { provisionTestDatabase } from "./support/db.ts";

let directory: string;
let path: string;
let source: DatabaseSync;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "jho-selection-"));
  path = join(directory, "fixture.db");
  const client = createClient({ url: `file:${path}` });
  try { await migrate(drizzle(client), { migrationsFolder: "./drizzle" }); }
  finally { client.close(); }
  source = new DatabaseSync(path);
  source.exec(`
    INSERT INTO source(id,kind,handle,label,last_error) VALUES
      ('web','ashby','fixture','Web','crawler diagnostic'),
      ('manual','manual','fixture','Manual',NULL);
    INSERT INTO job(id,fingerprint,content_hash,source_id,external_id,company_name,title,url,raw,description_html,description_text)
    VALUES (1,'one','hash','web','one','Fixture','One','https://example.com/1','{"crawler":"raw","workplaceType":"Remote"}','<p>Useful</p>','Useful'),
      (2,'two','hash','web','two','Fixture','Two','https://example.com/2','{}',NULL,'Unselected'),
      (3,'three','hash','manual','three','Fixture','Three','https://example.com/3','{"comparison":true}',NULL,'Manual');
    INSERT INTO candidate(id,slug,name) VALUES (50,'fixture','Fixture');
    INSERT INTO application(id,candidate_id,job_id,notes) VALUES (1,50,1,'Business history');
    INSERT INTO application_event(application_id,kind,to_status) VALUES (1,'status_change','backlog');
    INSERT INTO scrape_task(job_id,url) VALUES (1,'https://example.com/1');
  `);
});
afterEach(() => { source?.close(); rmSync(directory, { recursive: true, force: true }); });

it("preserves business references and manual metadata, excluding crawler payload and queues", () => {
  const result = selectProduction(path);
  expect(result.rows.job!.map((r) => r.id)).toEqual([1, 3]);
  expect(result.rows.job![0]).toMatchObject({ raw: { workplaceType: "Remote" }, description_html: null, description_text: "Useful" });
  expect(result.rows.job![1]!.raw).toEqual({ comparison: true });
  expect(result.rows.application![0]!.notes).toBe("Business history");
  expect(result.rows.application_event).toHaveLength(1);
  expect(result.rows.scrape_task).toEqual([]);
  expect(result.rows.source!.every((r) => r.last_error === null)).toBe(true);
  expect(source.prepare("SELECT raw FROM job WHERE id = 1").get()!.raw).toBe('{"crawler":"raw","workplaceType":"Remote"}');
  expect(selectProduction(path).manifest).toEqual(result.manifest);
});

it("imports the selected snapshot into PostgreSQL and verifies the committed rows", async () => {
  const target = await provisionTestDatabase();
  const { client, db } = connectDatabase(target.url);
  try {
    await migratePostgres(db, { migrationsFolder: "./drizzle/postgres" });
    const selection = selectProduction(path);
    const corrupt = structuredClone(selection);
    corrupt.manifest[0]!.sha256 = "0".repeat(64);
    await expect(importProduction(client, corrupt)).rejects.toThrow("Target data verification failed");
    for (const table of Object.keys(selection.rows)) {
      const rows = await client.unsafe(`SELECT count(*) AS n FROM production."${table.replaceAll('"', '""')}"`);
      expect(Number(rows[0]!.n)).toBe(0);
    }
    const result = await importProduction(client, selection);
    expect(result.importedRows).toBeGreaterThan(0);
    const [job] = await client`SELECT raw->>'workplaceType' AS workplace_type FROM production.job WHERE id = 1`;
    expect(job!.workplace_type).toBe("Remote");
    await expect(importProduction(client, selection)).rejects.toThrow("Target is not empty");
  } finally {
    await client.end({ timeout: 5 });
    await target.drop();
  }
});

it("refuses new tables and columns until transfer policy is reviewed", () => {
  source.exec("CREATE TABLE new_business_data (id INTEGER PRIMARY KEY)");
  expect(() => selectProduction(path)).toThrow("table drift");
  source.exec("DROP TABLE new_business_data; ALTER TABLE candidate ADD COLUMN new_private_field TEXT");
  expect(() => selectProduction(path)).toThrow("column drift: candidate");
});

it("rejects invalid booleans and JSON instead of silently coercing data", () => {
  source.exec("UPDATE candidate SET public_cv = 2");
  expect(() => selectProduction(path)).toThrow("Invalid boolean");
  source.exec("UPDATE candidate SET public_cv = 0; UPDATE job SET raw = 'invalid' WHERE id = 3");
  expect(() => selectProduction(path)).toThrow();
});

it("rejects orphan source data before selecting rows", () => {
  source.exec("PRAGMA foreign_keys = OFF; UPDATE application SET job_id = 99999");
  expect(() => selectProduction(path)).toThrow("invalid foreign keys");
});

function runImport(args: string[]) {
  return spawnSync(process.execPath, ["scripts/migration/production.ts", "--source", path, ...args], {
    encoding: "utf8", env: { ...process.env, DATABASE_MIGRATION_URL: "synthetic-secret-invalid-target" },
  });
}

it("plans locally without credentials and never emits selected private values", () => {
  const result = runImport([]);
  expect(result.status).toBe(0);
  const plan = JSON.parse(result.stdout);
  expect(plan).toMatchObject({ mode: "plan-only", project: PRODUCTION_PROJECT_REF });
  expect(plan.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(plan.manifest.find((row: { table: string }) => row.table === "application").selectedCount).toBe(1);
  expect(result.stdout + result.stderr).not.toContain("Business history");
  expect(result.stdout + result.stderr).not.toContain("synthetic-secret");
});

it("refuses each missing or mismatched cutover confirmation before target configuration", () => {
  const plan = JSON.parse(runImport([]).stdout);
  const confirmed = ["--apply", "--confirm-project", PRODUCTION_PROJECT_REF, "--writers-paused", "--source-sha256", plan.sourceSha256];
  const cases = [
    ["--apply"],
    confirmed.filter((arg) => arg !== "--writers-paused"),
    confirmed.map((arg) => arg === PRODUCTION_PROJECT_REF ? "other-project" : arg),
    confirmed.map((arg) => arg === plan.sourceSha256 ? "0".repeat(64) : arg),
  ];
  for (const args of cases) {
    const result = runImport(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("Business history");
    expect(JSON.parse(result.stderr)).toMatchObject({ status: "failed", stage: "cutover-confirmation" });
  }
  // With all acknowledgements present, the next guard rejects our deliberately
  // invalid target. No real credentials or network endpoint enter this test.
  const result = runImport(confirmed);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ status: "failed", stage: "target-configuration" });
  expect(result.stderr).not.toContain("synthetic-secret");
});

it("does not expose corrupt private JSON in command diagnostics", () => {
  source.exec("UPDATE job SET raw = 'private synthetic resume content' WHERE id = 3");
  const result = runImport([]);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("private synthetic resume content");
  expect(JSON.parse(result.stderr)).toMatchObject({ status: "failed", stage: "selection" });
});
