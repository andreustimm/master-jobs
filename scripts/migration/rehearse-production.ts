import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { selectProduction } from "./select-production.ts";
import { importProduction } from "./import-production.ts";

// This command cannot take a destination URL. It only writes into the isolated
// throwaway Docker database it creates, bound exclusively to loopback.
const snapshot = process.argv[2];
if (!snapshot) throw new Error("Usage: node scripts/migration/rehearse-production.ts <snapshot.db>");
const selection = selectProduction(snapshot);
const digest = createHash("sha256");
for await (const chunk of createReadStream(snapshot)) digest.update(chunk);
const sourceSha256 = digest.digest("hex");
const password = randomBytes(32).toString("hex");
const started = spawnSync("docker", ["run", "--rm", "-d", "-p", "127.0.0.1::5432",
  "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=jho_migration_rehearsal", "postgres:17"],
{ encoding: "utf8", env: { ...process.env, POSTGRES_PASSWORD: password } });
const container = started.stdout.trim();
if (started.status !== 0 || !/^[a-f0-9]{64}$/.test(container)) throw new Error("Could not start rehearsal PostgreSQL");
let sql: postgres.Sql | undefined;
try {
  const binding = spawnSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).stdout.trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  sql = postgres({ host: "127.0.0.1", port: Number(binding.split(":")[1]), database: "jho_migration_rehearsal",
    username: "postgres", password, ssl: false, max: 1, connect_timeout: 2, onnotice: () => {} });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await sql`SELECT 1`; ready = true; break; } catch { await setTimeout(500); }
  }
  assert.ok(ready, "PostgreSQL readiness timeout");
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "drizzle/postgres" });
  const firstJournal = await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
  await migrate(db, { migrationsFolder: "drizzle/postgres" });
  assert.deepEqual(await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`, firstJournal);

  // Force a verification failure after inserting all rows: the whole load must
  // roll back. The subsequent successful load also proves the target is empty.
  const corrupt = structuredClone(selection);
  corrupt.manifest[0]!.sha256 = "intentional-rehearsal-mismatch";
  await assert.rejects(importProduction(sql, corrupt), /Target data verification failed/);
  const result = await importProduction(sql, selection);
  await assert.rejects(importProduction(sql, selection), /Target is not empty/);

  const max = await sql`SELECT max(id) AS n FROM production.candidate`;
  const rollback = new Error("identity probe rollback");
  await assert.rejects(sql.begin(async (tx) => {
    const [row] = await tx`INSERT INTO production.candidate(slug, name) VALUES ('migration-identity-probe', 'Rehearsal') RETURNING id`;
    assert.equal(row!.id, Number(max[0]!.n) + 1);
    throw rollback;
  }), (error) => error === rollback);
  console.log(JSON.stringify({ sourceSha256, ...result, migrationReplay: "unchanged",
    rollback: "verified", occupiedTarget: "rejected", identityInsert: "verified" }, null, 2));
} finally {
  await sql?.end({ timeout: 2 });
  const stopped = spawnSync("docker", ["stop", "--time", "5", container], { encoding: "utf8" });
  if (stopped.status !== 0) throw new Error(`Rehearsal container cleanup required: ${container}`);
}
