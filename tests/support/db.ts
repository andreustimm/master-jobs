/**
 * Databases for tests.
 *
 * The reason the whole safety net starts here: 86% of `src/` had no test, which
 * made any refactor unfalsifiable — there was no way to tell a clean
 * architecture from a broken one. A real schema in memory changes that without
 * adding a dependency or touching the developer's actual data.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { closeDb, getDb, type DB } from "../../src/core/db/client.ts";
import * as schema from "../../src/core/db/schema.ts";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let singletonTestPath: string | undefined;

function removeTestDatabase(path: string | undefined): void {
  if (!path) return;
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

/**
 * Fresh, migrated, isolated. `file::memory:` gives each call its own database,
 * which matters because tests run in parallel.
 */
export async function createTestDb(): Promise<{ db: TestDb; close: () => void }> {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => client.close() };
}

/**
 * Points the process-wide `getDb()` at a throwaway in-memory database.
 *
 * Characterization tests must exercise the real production path, and everything
 * in `src/core/db/repo.ts` resolves its connection through `getDb()`. Injecting
 * a test double there would test the double, not the code that actually runs.
 * So we redirect the singleton instead — the only global here is the env var
 * the client already reads.
 */
export async function useTestDb(): Promise<DB> {
  closeDb();
  removeTestDatabase(singletonTestPath);
  singletonTestPath = join(tmpdir(), `jho-test-${randomUUID()}.db`);
  process.env.TURSO_DATABASE_URL = `file:${singletonTestPath}`;
  const db = getDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

export function releaseTestDb(): void {
  closeDb();
  removeTestDatabase(singletonTestPath);
  singletonTestPath = undefined;
  delete process.env.TURSO_DATABASE_URL;
}
