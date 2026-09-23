import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, connectDatabase, getDb, type DB } from "../../src/core/db/client.ts";
import { invalidateBoardFacets } from "../../src/contexts/matching/app/board-facets.ts";

export type TestDb = DB;

export async function provisionTestDatabase() {
  const base = process.env.JHO_TEST_POSTGRES_URL;
  if (!base) throw new Error("Test PostgreSQL global setup did not run");
  const url = new URL(base);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/postgres") throw new Error("Unsafe test database target");
  const name = "jho_test_" + randomUUID().replaceAll("-", "");
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try { await admin.unsafe(`CREATE DATABASE "${name}"`); }
  finally { await admin.end(); }
  url.pathname = "/" + name;
  return {
    url: url.toString(),
    async drop() {
      const connection = postgres(base, { max: 1, onnotice: () => {} });
      try { await connection.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await connection.end(); }
    },
  };
}

export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const target = await provisionTestDatabase();
  const { db, client } = connectDatabase(target.url);
  try { await migrate(db, { migrationsFolder: "./drizzle/postgres" }); }
  catch (error) { await client.end(); await target.drop(); throw error; }
  return { db, async close() { await client.end(); await target.drop(); } };
}

let singleton: Awaited<ReturnType<typeof provisionTestDatabase>> | undefined;
let cleanup: Promise<void> = Promise.resolve();
let previousUrl: string | undefined;
let previousMigrationUrl: string | undefined;

export async function useTestDb(): Promise<DB> {
  await releaseTestDb();
  // Banco novo, ids reaproveitados: facetas guardadas do teste anterior
  // pertenceriam a outro acervo com o mesmo candidato 1.
  invalidateBoardFacets();
  previousUrl = process.env.DATABASE_URL;
  previousMigrationUrl = process.env.DATABASE_MIGRATION_URL;
  singleton = await provisionTestDatabase();
  process.env.DATABASE_URL = singleton.url;
  process.env.DATABASE_MIGRATION_URL = singleton.url;
  const db = getDb();
  await migrate(db, { migrationsFolder: "./drizzle/postgres" });
  return db;
}

/** Capture the target synchronously so legacy unawaited teardown cannot drop the next test's DB. */
export function releaseTestDb(): Promise<void> {
  const target = singleton;
  singleton = undefined;
  const closed = closeDb();
  if (target) {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousMigrationUrl === undefined) delete process.env.DATABASE_MIGRATION_URL;
    else process.env.DATABASE_MIGRATION_URL = previousMigrationUrl;
  }
  cleanup = cleanup.then(async () => { await closed; await target?.drop(); });
  return cleanup;
}
