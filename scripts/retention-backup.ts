/** Weekly application-data backup. Plaintext stays on the ephemeral runner. */
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { connectDatabase } from "../src/core/db/client.ts";
import { databaseIdentity } from "../src/core/db/backup-attestation.ts";
import { resolveDatabaseUrl } from "../src/core/db/config.ts";
import { MANUAL_SOURCE_KINDS } from "../src/core/sources/types.ts";

const SCHEMAS = ["production", "drizzle", "release_backup"];
const MAGIC = Buffer.from("MJBACKUP1");
const EXTENSIONS = new Set(["pg_trgm", "pgcrypto", "unaccent", "citext", "uuid-ossp"]);
let stage = "configuration";
function checkpoint(name: string) { stage = name; console.log(`Backup stage: ${name}`); }

export function encryptionKey(value: string | undefined): Buffer {
  const key = Buffer.from(value ?? "", "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error("RETENTION_BACKUP_ENCRYPTION_KEY deve conter 32 bytes em base64 canônico.");
  }
  return key;
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Errors from pg_dump/restore can include row contents or connection details.
// Preserve their exit status, never their stderr in Actions logs.
async function command(program: string, args: string[], env = process.env): Promise<void> {
  await new Promise<void>((done, reject) => {
    const child = spawn(program, args, { env, stdio: "ignore" });
    child.once("error", () => reject(new Error(`${program} não pôde iniciar.`)));
    child.once("close", code => code === 0 ? done() : reject(new Error(`${program} falhou, código ${code}. Nenhuma limpeza autorizada.`)));
  });
}

export async function encryptArchive(input: string, output: string, key: Buffer): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  await writeFile(output, Buffer.concat([MAGIC, iv]), { mode: 0o600, flag: "wx" });
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }));
  await appendFile(output, cipher.getAuthTag());
}

export async function decryptArchive(input: string, output: string, key: Buffer): Promise<void> {
  // This utility is for recovery, so an unauthenticated plaintext is never
  // published under the requested path. GCM is verified before atomic rename.
  const { open, link, rm, stat } = await import("node:fs/promises");
  const size = (await stat(input)).size;
  const headerSize = MAGIC.length + 12;
  if (size < headerSize + 16) throw new Error("Backup criptografado incompleto.");
  const fd = await open(input, "r");
  const header = Buffer.alloc(headerSize);
  const tag = Buffer.alloc(16);
  try {
    await fd.read(header, 0, headerSize, 0);
    await fd.read(tag, 0, 16, size - 16);
  } finally { await fd.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Formato de backup desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const temporary = `${output}.${randomUUID()}.partial`;
  try {
    await pipeline(createReadStream(input, { start: headerSize, end: size - 17 }), decipher, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    await link(temporary, output);
    await rm(temporary);
  } catch {
    await rm(temporary, { force: true });
    throw new Error("Falha na autenticação do backup criptografado.");
  }
}

type Inventory = { schema: string; table: string; rows: number; sha256: string };
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function inventory(sql: postgres.Sql, tables: { schema: string; table: string }[]): Promise<Inventory[]> {
  const result: Inventory[] = [];
  for (const table of tables) {
    const hash = createHash("sha256");
    let rows = 0;
    // Hash every full row in deterministic order, keeping memory bounded.
    for await (const batch of sql.unsafe(`select md5(row_to_json(t)::text) as hash from ${identifier(table.schema)}.${identifier(table.table)} t order by 1`).cursor(1000)) {
      for (const row of batch) { hash.update(`${row.hash}\n`); rows++; }
    }
    result.push({ ...table, rows, sha256: hash.digest("hex") });
  }
  return result;
}

type LocalRehearsal = { url: string; root: string; container: string };
/** Explicit test seam: only a loopback connection to a named disposable clone. */
export async function prepareBackup(local?: LocalRehearsal): Promise<string> {
  checkpoint("configuration");
  const key = encryptionKey(process.env.RETENTION_BACKUP_ENCRYPTION_KEY);
  const root = local?.root ?? process.env.RUNNER_TEMP;
  if (!root || (!local && process.env.GITHUB_ACTIONS !== "true")) throw new Error("Preparação automática exige runner efêmero do GitHub Actions.");
  const directory = join(root, `retention-backup-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const { url, source } = local ? { url: local.url, source: "LOCAL_REHEARSAL" } : resolveDatabaseUrl("migration");
  const identity = databaseIdentity(url);
  const parsed = new URL(url);
  if (local && (!identity.startsWith("local:") || !/^mj-backup-rehearsal-[a-z0-9-]+$/.test(local.container))) throw new Error("Ensaio exige clone loopback descartável identificado.");
  if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port !== "5432") {
    throw new Error("Backup exige conexão direta ou pooler em modo sessão na porta 5432.");
  }
  const ca = process.env.DATABASE_CA_CERT?.trim();
  if (!ca && !local) throw new Error("DATABASE_CA_CERT é obrigatório no backup remoto.");
  const caPath = join(directory, "ca.crt");
  if (ca) await writeFile(caPath, ca.includes("BEGIN CERTIFICATE") ? ca : await readFile(ca), { mode: 0o600 });
  const { client } = connectDatabase(url, source);
  const majorConfig = JSON.parse(await readFile("config/postgres-majors.json", "utf8")) as { production: string };
  const image = `postgres:${majorConfig.production}`;
  const container = `mj-retention-restore-${randomUUID()}`;
  const env = { ...process.env, PGHOST: local ? "127.0.0.1" : parsed.hostname, PGPORT: local ? "5432" : parsed.port || "5432", PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)), PGSSLMODE: local ? "disable" : "verify-full", PGSSLROOTCERT: "/backup/ca.crt" };
  const mounted = ["--mount", `type=bind,src=${directory},dst=/backup`];
  const credentials = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGSSLROOTCERT"].flatMap(name => ["--env", name]);
  const dumpPath = join(directory, "database.dump");
  const schemaPath = join(directory, "schema.sql");
  let expected: Inventory[] = [];
  let extensions: { name: string; schema: string }[] = [];
  let schemas: string[] = [];
  let roles: string[] = [];
  let sequences: { schema: string; sequence: string; last_value: string; is_called: boolean }[] = [];
  const capturedAt = new Date().toISOString();
  try {
    checkpoint("snapshot-capture");
    await client.begin("isolation level repeatable read read only", async tx => {
      await tx`set local timezone = 'UTC'`;
      await tx`set local idle_in_transaction_session_timeout = '15min'`;
      const version = (await tx`select current_setting('server_version_num') as version`)[0]!.version;
      if (Math.floor(Number(version) / 10000).toString() !== majorConfig.production) throw new Error("Major de produção diverge da configuração. Backup recusado.");
      const snapshot = (await tx`select pg_export_snapshot() as snapshot`)[0]!.snapshot;
      schemas = (await tx`select nspname from pg_namespace where nspname = any(${SCHEMAS}) order by 1`).map(row => String(row.nspname));
      if (!schemas.includes("production")) throw new Error("Esquema production ausente.");
      // A schema-only dump cannot restore cross-schema dependencies. Require
      // review if a future migration adds one outside the captured application.
      const outside = await tx`select 1 from pg_constraint c join pg_class a on a.oid=c.conrelid join pg_namespace na on na.oid=a.relnamespace join pg_class b on b.oid=c.confrelid join pg_namespace nb on nb.oid=b.relnamespace where c.contype='f' and na.nspname=any(${schemas}) and not nb.nspname=any(${schemas}) limit 1`;
      if (outside.length) throw new Error("Backup de aplicação possui FK externa ao escopo capturado.");
      extensions = (await tx`select e.extname as name, n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname <> 'plpgsql'`).map(row => ({ name: String(row.name), schema: String(row.schema) })).filter(row => EXTENSIONS.has(row.name));
      roles = (await tx`select distinct r.rolname from pg_policy p cross join lateral unnest(p.polroles) v(role) join pg_roles r on r.oid=v.role join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any(${schemas}) and r.rolname <> 'postgres'`).map(row => String(row.rolname));
      await command("docker", ["run", "--rm", "--network", local ? `container:${local.container}` : "host", ...mounted, ...credentials, image, "pg_dump", "--format=custom", "--no-owner", "--no-acl", `--snapshot=${snapshot}`, ...schemas.flatMap(name => ["--schema", name]), "--file=/backup/database.dump"], env);
      checkpoint("source-inventory");
      const tables = (await tx`select schemaname as schema, tablename as table from pg_tables where schemaname = any(${schemas}) order by 1,2`).map(row => ({ schema: String(row.schema), table: String(row.table) }));
      expected = await inventory(tx as unknown as postgres.Sql, tables);
      for (const row of await tx`select schemaname, sequencename from pg_sequences where schemaname=any(${schemas}) order by 1,2`) {
        const [value] = await tx.unsafe(`select last_value::text, is_called from ${identifier(String(row.schemaname))}.${identifier(String(row.sequencename))}`);
        sequences.push({ schema: String(row.schemaname), sequence: String(row.sequencename), last_value: String(value!.last_value), is_called: Boolean(value!.is_called) });
      }
    });
    checkpoint("isolated-restore-start");
    await command("docker", ["run", "--rm", "--network", "none", ...mounted, image, "pg_restore", "--schema-only", "--no-owner", "--no-acl", "--file=/backup/schema.sql", "/backup/database.dump"]);
    // No host port, no outbound network, no production credentials in restore.
    await command("docker", ["run", "--detach", "--name", container, "--network", "none", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", image]);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await command("docker", ["exec", container, "pg_isready", "-U", "postgres"]); ready = true; break; }
      catch { await new Promise(done => setTimeout(done, 1000)); }
    }
    if (!ready) throw new Error("Banco isolado de restauração indisponível.");
    for (const extension of extensions) {
      await command("docker", ["exec", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create schema if not exists ${identifier(extension.schema)}; create extension if not exists ${identifier(extension.name)} with schema ${identifier(extension.schema)}`]);
    }
    for (const role of roles) await command("docker", ["exec", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create role ${identifier(role)} nologin`]);
    await command("docker", ["cp", dumpPath, `${container}:/tmp/database.dump`]);
    // Constraints are created after data and validated by PostgreSQL. Any
    // unresolved dependency or restore error prevents attestation and deletion.
    checkpoint("isolated-restore-archive");
    await command("docker", ["exec", container, "pg_restore", "-U", "postgres", "-d", "postgres", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "/tmp/database.dump"]);
    checkpoint("restore-content-validation");
    const actual: Inventory[] = [];
    for (const table of expected) {
      const hash = createHash("sha256");
      let rows = 0;
      const query = `select md5(row_to_json(t)::text) from ${identifier(table.schema)}.${identifier(table.table)} t order by 1`;
      await new Promise<void>((done, reject) => {
        const child = spawn("docker", ["exec", "--env", "PGTZ=UTC", container, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { stdio: ["ignore", "pipe", "ignore"] });
        let pending = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          pending += chunk;
          const lines = pending.split("\n");
          pending = lines.pop()!;
          for (const line of lines) { hash.update(`${line}\n`); rows++; }
        });
        child.once("error", () => reject(new Error("Validação de restauração não iniciou.")));
        child.once("close", code => code === 0 && !pending ? done() : reject(new Error("Validação de restauração falhou.")));
      });
      actual.push({ schema: table.schema, table: table.table, rows, sha256: hash.digest("hex") });
    }
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Conteúdo restaurado diverge do snapshot. Limpeza recusada.");
    for (const sequence of sequences) {
      await command("docker", ["exec", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `do $$ begin if not exists(select 1 from ${identifier(sequence.schema)}.${identifier(sequence.sequence)} where last_value::text='${sequence.last_value}' and is_called=${sequence.is_called}) then raise exception 'Sequence restore mismatch'; end if; end $$`]);
    }
    const evidencePath = join(directory, "restore-evidence.json");
    const restoreValidatedAt = new Date().toISOString();
    await writeFile(evidencePath, JSON.stringify({ version: 1, database: identity, capturedAt, restoreValidatedAt, schemas, scope: "application schemas only; Supabase managed auth/storage and external objects excluded", tables: actual, sequences, roles, extensions, constraints: "pg_restore --single-transaction --exit-on-error" }), { mode: 0o600 });
    const file = async (path: string) => ({ path: path.slice(directory.length + 1), sha256: await digest(path) });
    await writeFile(join(directory, "attestation.json"), JSON.stringify({ version: 1, database: identity, capturedAt, restoreValidatedAt, data: await file(dumpPath), schema: await file(schemaPath), restoreEvidence: await file(evidencePath) }), { mode: 0o600 });
    checkpoint("package-encryption-recovery-check");
    await command("tar", ["-czf", join(directory, "backup.tar.gz"), "-C", directory, "database.dump", "schema.sql", "restore-evidence.json", "attestation.json"]);
    await chmod(join(directory, "backup.tar.gz"), 0o600);
    await encryptArchive(join(directory, "backup.tar.gz"), join(directory, "backup.mjenc"), key);
    const recoveryPath = join(directory, "recovery-check.tar.gz");
    await decryptArchive(join(directory, "backup.mjenc"), recoveryPath, key);
    if (await digest(recoveryPath) !== await digest(join(directory, "backup.tar.gz"))) throw new Error("Recuperação do arquivo criptografado diverge do backup.");
    await rm(recoveryPath);
    await writeFile(join(directory, "encrypted.sha256"), await digest(join(directory, "backup.mjenc")), { mode: 0o600 });
    if (!process.env.GITHUB_OUTPUT && !local) throw new Error("GITHUB_OUTPUT ausente.");
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `directory=${directory}\nartifact=${join(directory, "backup.mjenc")}\n`);
    console.log(`Backup consistente restaurado e conferido em ${actual.length} tabelas. Escopo de aplicação ${schemas.join(", ")}.`);
    return directory;
  } finally {
    await client.end({ timeout: 5 });
    await command("docker", ["rm", "--force", container]).catch(() => {});
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "prepare") { await prepareBackup(); return; }
  if (["capture-protection", "verify-protection"].includes(process.argv[2] ?? "")) {
    checkpoint(process.argv[2]!);
    const path = process.argv[3];
    if (!path) throw new Error("Protection evidence path required.");
    const { url, source } = resolveDatabaseUrl("runtime");
    const { client } = connectDatabase(url, source);
    try {
      const tables = ["application", "application_event", "job_analysis", "mail_suggestion", "recruiter_suggestion", "verify_task", "scrape_task"];
      const interactions: Record<string, number[]> = {};
      for (const table of tables) interactions[table] = (await client.unsafe(`select id from production.${identifier(table)} order by id`)).map(row => Number(row.id));
      const protectedJobs = (await client`select j.id from production.job j join production.source s on s.id=j.source_id where j.posted_by_user_id is not null or j.archived_at is not null or s.kind=any(${MANUAL_SOURCE_KINDS.slice()}) or exists(select 1 from production.application a where a.job_id=j.id) or exists(select 1 from production.job_analysis a where a.job_id=j.id) or exists(select 1 from production.mail_suggestion a where a.job_id=j.id) or exists(select 1 from production.recruiter_suggestion a where a.job_id=j.id) or exists(select 1 from production.verify_task a where a.job_id=j.id) or exists(select 1 from production.scrape_task a where a.job_id=j.id) order by j.id`).map(row => Number(row.id));
      if (process.argv[2] === "capture-protection") {
        await writeFile(path, JSON.stringify({ database: databaseIdentity(url), interactions, protectedJobs }), { mode: 0o600, flag: "wx" });
      } else {
        const before = JSON.parse(await readFile(path, "utf8")) as { database: string; interactions: Record<string, number[]>; protectedJobs: number[] };
        if (before.database !== databaseIdentity(url)) throw new Error("Protection evidence database mismatch.");
        // Existing interactions may be edited and new ones may arrive during
        // maintenance. Verify original identities survive rather than exact counts.
        for (const table of tables) {
          const present = new Set(interactions[table]);
          if (!before.interactions[table] || before.interactions[table].some(id => !present.has(id))) throw new Error("Existing interaction disappeared during maintenance.");
        }
        const jobs = new Set((await client`select id from production.job where id=any(${before.protectedJobs})`).map(row => Number(row.id)));
        if (before.protectedJobs.some(id => !jobs.has(id))) throw new Error("Protected job disappeared during maintenance.");
      }
      console.log(JSON.stringify({ stage, protectedJobs: protectedJobs.length, interactions: Object.fromEntries(tables.map(table => [table, interactions[table]!.length])) }));
    } finally { await client.end({ timeout: 5 }); }
    return;
  }
  if (process.argv[2] === "verify-upload") {
    const directory = resolve(process.argv[3] ?? "");
    const uploaded = resolve(process.argv[4] ?? "");
    if (!/^[1-9][0-9]*$/.test(process.env.RETENTION_BACKUP_ARTIFACT_ID ?? "")) throw new Error("Artifact remoto não confirmado.");
    if (await digest(uploaded) !== (await readFile(join(directory, "encrypted.sha256"), "utf8")).trim()) throw new Error("Backup baixado do artifact diverge do backup validado.");
    console.log("Backup criptografado remoto confirmado por download e SHA-256.");
    return;
  }
  if (process.argv[2] === "decrypt" && process.argv[3] && process.argv[4]) {
    return decryptArchive(resolve(process.argv[3]), resolve(process.argv[4]), encryptionKey(process.env.RETENTION_BACKUP_ENCRYPTION_KEY));
  }
  throw new Error("Use prepare, verify-upload <diretório> <backup.mjenc>, ou decrypt <backup.mjenc> <backup.tar.gz>.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  await main().catch(() => {
    // Driver errors may contain credentials and row contents. Diagnostics
    // deliberately identify the failed operation without serializing its error.
    console.error(`Backup/recovery falhou na etapa ${stage}. Limpeza não autorizada.`);
    process.exitCode = 1;
  });
}
