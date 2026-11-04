import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";
import { decryptArchive, encryptArchive, encryptionKey } from "../scripts/retention-backup.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "backup-test-")); directories.push(directory);
  const input = join(directory, "input");
  const encrypted = join(directory, "backup.mjenc");
  const output = join(directory, "output");
  const contents = randomBytes(131_071);
  const key = randomBytes(32);
  await writeFile(input, contents);
  await encryptArchive(input, encrypted, key);
  return { directory, input, encrypted, output, contents, key };
}

it("recovers the exact archive with the separately held encryption key", async () => {
  const f = await fixture();
  await decryptArchive(f.encrypted, f.output, f.key);
  expect(await readFile(f.output)).toEqual(f.contents);
  expect((await readFile(f.encrypted)).includes(f.contents)).toBe(false);
});

it.each(["wrong key", "tampered ciphertext"])("never publishes plaintext after %s", async failure => {
  const f = await fixture();
  if (failure === "tampered ciphertext") {
    const encrypted = await readFile(f.encrypted); encrypted[40] = encrypted[40]! ^ 1; await writeFile(f.encrypted, encrypted);
  }
  await expect(decryptArchive(f.encrypted, f.output, failure === "wrong key" ? randomBytes(32) : f.key)).rejects.toThrow();
  expect(await readdir(f.directory)).not.toContain("output");
  expect((await readdir(f.directory)).some(name => name.endsWith(".partial"))).toBe(false);
});

it("refuses missing/noncanonical keys and preserves an existing recovery destination", async () => {
  for (const key of [undefined, "", randomBytes(31).toString("base64"), `${randomBytes(32).toString("base64")}\n`]) expect(() => encryptionKey(key)).toThrow();
  const f = await fixture();
  await writeFile(f.output, "previous recovery");
  await expect(decryptArchive(f.encrypted, f.output, f.key)).rejects.toThrow();
  expect(await readFile(f.output, "utf8")).toBe("previous recovery");
});

it("gates every scheduled deletion behind restored, encrypted, remotely verified backup", async () => {
  const raw = await readFile(".github/workflows/manutencao-banco.yml", "utf8");
  const job = parse(raw).jobs.limpar;
  const steps = job.steps as { run?: string; uses?: string; if?: string; with?: Record<string, unknown> }[];
  const prepare = steps.findIndex(step => step.run?.includes("retention-backup.ts prepare"));
  const upload = steps.findIndex(step => step.uses?.startsWith("actions/upload-artifact@"));
  const download = steps.findIndex(step => step.uses?.startsWith("actions/download-artifact@"));
  const verify = steps.findIndex(step => step.run?.includes("retention-backup.ts verify-upload"));
  expect(prepare).toBeGreaterThan(-1); expect(upload).toBeGreaterThan(prepare);
  expect(download).toBeGreaterThan(upload); expect(verify).toBeGreaterThan(download);
  expect(steps[upload]!.with?.path).toBe("${{ steps.backup.outputs.artifact }}");
  expect(steps[upload]!.with?.["retention-days"]).toBe(90);
  for (const [index, step] of steps.entries()) {
    if (!step.run?.includes("--apply")) continue;
    expect(index).toBeGreaterThan(verify); expect(step.if).toBeUndefined();
  }
  expect(raw).toContain("--backup-attestation");
  expect(raw).toContain("secrets.RETENTION_BACKUP_ENCRYPTION_KEY");
  const protection = steps.find(step => step.run?.includes("retention-backup.ts verify-protection"));
  expect(protection?.if).toBe("always() && steps.capture.outcome == 'success'");
  expect(job.environment).toBe("production");
});

// Five real Node CLI launches plus database setup/teardown share this budget.
// Each child remains bounded to 5s; the suite-wide 5s default is not a CLI SLA.
it("checks original protected job and interaction identities while permitting new interactions", async () => {
  const url = process.env.JHO_TEST_POSTGRES_URL!;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const directory = await mkdtemp(join(tmpdir(), "backup-protection-test-")); directories.push(directory);
  const path = join(directory, "protection.json");
  const tables = ["application", "application_event", "job_analysis", "mail_suggestion", "recruiter_suggestion", "verify_task", "scrape_task"];
  const run = (command: string) => {
    const started = performance.now();
    const result = spawnSync(process.execPath, ["--no-warnings", "scripts/retention-backup.ts", command, path], { env: { ...process.env, DATABASE_URL: url, DATABASE_CA_CERT: "" }, encoding: "utf8", timeout: 5_000 });
    console.info(`Backup protection CLI ${command}: ${Math.round(performance.now() - started)}ms`);
    expect(result.error, command).toBeUndefined();
    return result;
  };
  try {
    await sql.unsafe("create schema production; create table production.source(id text primary key,kind text); create table production.job(id int primary key,source_id text,posted_by_user_id int,archived_at text); insert into production.source values('s','greenhouse'); insert into production.job values(1,'s',null,null),(2,'s',null,null)");
    for (const table of tables) await sql.unsafe(`create table production.${table}(id int primary key, job_id int); insert into production.${table} values(1,1)`);
    expect(run("capture-protection").status).toBe(0);
    expect(run("verify-protection").status).toBe(0);
    await sql.unsafe("insert into production.application values(2,2)");
    expect(run("verify-protection").status).toBe(0);
    await sql.unsafe("delete from production.application_event where id=1");
    expect(run("verify-protection").status).toBe(1);
    await sql.unsafe("insert into production.application_event values(1,1); delete from production.job where id=1");
    expect(run("verify-protection").status).toBe(1);
  } finally { await sql.unsafe("drop schema if exists production cascade"); await sql.end(); }
}, 30_000);
