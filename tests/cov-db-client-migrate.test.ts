import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, connectDatabase, getDb } from "../src/core/db/client.ts";
import { runMigrations, withDatabaseCause } from "../src/core/db/migrate.ts";

describe("withDatabaseCause", () => {
  it("surfaces the server code and message hidden behind drizzle's 'Failed query'", () => {
    const cause = Object.assign(new Error('password authentication failed for user "postgres.ref"'), { code: "28P01" });
    const wrapped = Object.assign(new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: '), { cause });
    const surfaced = withDatabaseCause(wrapped) as Error;
    expect(surfaced.message).toBe('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" — causa: 28P01 password authentication failed for user "postgres.ref"');
    expect(surfaced.cause).toBe(cause);
  });

  it("keeps a socket error without code and leaves causeless errors untouched", () => {
    const socket = withDatabaseCause(Object.assign(new Error("Failed query: X"), { cause: new Error("connect ETIMEDOUT") })) as Error;
    expect(socket.message).toBe("Failed query: X — causa: connect ETIMEDOUT");
    const plain = new Error("plain");
    expect(withDatabaseCause(plain)).toBe(plain);
    expect(withDatabaseCause("text")).toBe("text");
  });
});
import { provisionTestDatabase } from "./support/db.ts";

let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let previous: { url?: string; migration?: string };
beforeEach(async () => {
  await closeDb();
  previous = { url: process.env.DATABASE_URL, migration: process.env.DATABASE_MIGRATION_URL };
  target = await provisionTestDatabase();
  process.env.DATABASE_URL = target.url;
  process.env.DATABASE_MIGRATION_URL = target.url;
});
afterEach(async () => {
  await closeDb();
  await target.drop();
  if (previous.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous.url;
  if (previous.migration === undefined) delete process.env.DATABASE_MIGRATION_URL;
  else process.env.DATABASE_MIGRATION_URL = previous.migration;
});

describe("PostgreSQL client and migrations", () => {
  it("requires an explicit runtime destination instead of opening SQLite", () => {
    // Os nomes aceitos são três, e nenhum deles é um arquivo local. A mensagem
    // mudou quando `POSTGRES_URL` passou a valer; o que não mudou é a recusa.
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_URL_NON_POOLING;
    expect(() => getDb()).toThrow(/Nenhuma URL de banco configurada/);
    process.env.DATABASE_URL = " ";
    expect(() => getDb()).toThrow(/Nenhuma URL de banco configurada/);
  });
  it("rejects malformed, legacy or TLS-weakening connection strings without leaking them", () => {
    for (const url of ["not-a-url", "file:./private.db", "libsql://legacy.test", target.url + "?sslmode=disable"]) {
      expect(() => connectDatabase(url)).toThrow();
    }
  });
  it("reuses the pool and reopens after awaited shutdown", async () => {
    const first = getDb();
    expect(getDb()).toBe(first);
    await first.execute(sql`select 1`);
    await closeDb();
    expect(getDb()).not.toBe(first);
    await expect(getDb().execute(sql`select 1`)).resolves.toBeDefined();
  });
  it("does not use runtime credentials for DDL when migration configuration is absent", async () => {
    // A credencial de runtime não vira credencial de DDL por omissão: com
    // `DATABASE_URL` configurada e nenhuma das de migration, a migration recusa.
    delete process.env.DATABASE_MIGRATION_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_URL_NON_POOLING;
    await expect(runMigrations()).rejects.toThrow(/Nenhuma URL de banco configurada para migration/);
  });
  it("applies versioned migrations idempotently through a separate connection", async () => {
    await runMigrations();
    const first = await getDb().execute(sql`select * from drizzle.__drizzle_migrations order by id`);
    expect(first.length).toBeGreaterThan(0);
    await runMigrations("./drizzle/postgres");
    expect(await getDb().execute(sql`select * from drizzle.__drizzle_migrations order by id`)).toEqual(first);
    const tables = await getDb().execute(sql`select tablename from pg_tables where schemaname = 'production'`);
    expect(tables).toHaveLength(41);
    expect(tables.map((t) => t.tablename)).toEqual(expect.arrayContaining(["job", "application", "job_score", "score_cursor"]));
  });
});
