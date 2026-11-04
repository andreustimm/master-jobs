/** Explicit opt-in rehearsal against an existing LOCAL clone; never production. */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { prepareBackup, decryptArchive } from "./retention-backup.ts";
import { verifyBackupAttestation } from "../src/core/db/backup-attestation.ts";

process.umask(0o077);
const source = process.env.LOCAL_BACKUP_CLONE_CONTAINER;
const database = process.env.LOCAL_BACKUP_CLONE_DATABASE;
if (!source?.startsWith("master-jobs-restore-") || !database || !/^[a-z0-9_]+$/.test(database)) throw new Error("Set LOCAL_BACKUP_CLONE_CONTAINER=master-jobs-restore-* and LOCAL_BACKUP_CLONE_DATABASE to an existing LOCAL clone.");
const root = await mkdtemp(join(tmpdir(), "mj-backup-rehearsal-"));
const container = `mj-backup-rehearsal-${randomUUID()}`;
const password = randomBytes(24).toString("hex");
const sourceDump = `/tmp/mj-rehearsal-${randomUUID()}.dump`;
function docker(args: string[], env = process.env): string {
  const result = spawnSync("docker", args, { encoding: "utf8", env, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Local Docker operation failed: ${args[0]} ${args.includes("pg_restore") ? "pg_restore" : ""} (exit ${result.status}).`);
  return result.stdout.trim();
}
let admin: postgres.Sql | undefined;
try {
  console.log("Rehearsal stage: copying application snapshot from existing LOCAL clone");
  docker(["exec", source, "pg_dump", "-U", "postgres", "-d", database, "--format=custom", "--no-owner", "--no-acl", "--schema=production", "--schema=drizzle", "--schema=release_backup", `--file=${sourceDump}`]);
  docker(["cp", `${source}:${sourceDump}`, join(root, "source.dump")]);
  docker(["run", "--rm", "--detach", "--name", container, "-p", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD", "postgres:17"], { ...process.env, POSTGRES_PASSWORD: password });
  const binding = docker(["port", container, "5432/tcp"]);
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error("Clone binding must be loopback.");
  const url = `postgres://postgres:${password}@${binding}/postgres`;
  admin = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
  let ready = false;
  for (let index = 0; index < 40; index++) {
    try { await admin`select 1`; ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error("Disposable clone unavailable.");
  await admin.unsafe('create schema extensions; create extension pg_trgm; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions');
  docker(["cp", join(root, "source.dump"), `${container}:/tmp/source.dump`]);
  docker(["exec", container, "pg_restore", "-U", "postgres", "-d", "postgres", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "/tmp/source.dump"]);
  const key = randomBytes(32);
  process.env.RETENTION_BACKUP_ENCRYPTION_KEY = key.toString("base64");
  delete process.env.DATABASE_CA_CERT;
  const directory = await prepareBackup({ url, root, container });
  process.env.DATABASE_URL = url;
  await verifyBackupAttestation(join(directory, "attestation.json"));
  const downloaded = join(root, "downloaded.mjenc");
  await copyFile(join(directory, "backup.mjenc"), downloaded);
  const verify = spawnSync(process.execPath, ["--no-warnings", "scripts/retention-backup.ts", "verify-upload", directory, downloaded], { env: { ...process.env, RETENTION_BACKUP_ARTIFACT_ID: "1" }, encoding: "utf8" });
  if (verify.status !== 0) throw new Error("Artifact download verification failed.");
  const recovery = join(root, "recovered.tar.gz");
  await decryptArchive(downloaded, recovery, key);
  const hash = (contents: Buffer) => createHash("sha256").update(contents).digest("hex");
  if (hash(await readFile(recovery)) !== hash(await readFile(join(directory, "backup.tar.gz")))) throw new Error("Recovered package differs.");
  const evidence = JSON.parse(await readFile(join(directory, "restore-evidence.json"), "utf8"));
  const summary = { passed: true, postgresMajor: 17, tables: evidence.tables.length, rows: evidence.tables.reduce((count: number, table: { rows: number }) => count + table.rows, 0), sequences: evidence.sequences.length, roles: evidence.roles.length, extensions: evidence.extensions.map((extension: { name: string }) => extension.name), schemas: evidence.schemas, captureRestoreValidated: true, encryptionRecoveryValidated: true, simulatedArtifactDownloadValidated: true, actualGithubUpload: false, productionAccess: false };
  const report = process.env.LOCAL_BACKUP_REHEARSAL_REPORT;
  if (report) await writeFile(report, JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary));
} finally {
  await admin?.end({ timeout: 2 });
  spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  spawnSync("docker", ["exec", source, "rm", "-f", sourceDump], { stdio: "ignore" });
  await rm(root, { recursive: true, force: true });
}
