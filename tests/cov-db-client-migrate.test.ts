import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, connectDatabase, getDb } from "../src/core/db/client.ts";
import { MigrationNeedsReview, runMigrations, withDatabaseCause } from "../src/core/db/migrate.ts";

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
    expect(tables).toHaveLength(42);
    expect(tables.map((t) => t.tablename)).toEqual(
      expect.arrayContaining(["job", "application", "job_score", "score_cursor", "request_budget"]),
    );
  });
});

describe("runMigrations({ additiveOnly }) — o modo do push em main", () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "master-jobs-migrations-"));
    cpSync("./drizzle/postgres", folder, { recursive: true });
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  /** Acrescenta uma migração ao journal da cópia, como `db:generate` faria. */
  function append(tag: string, body: string): void {
    const path = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(path, "utf8")) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const last = journal.entries.at(-1)!;
    journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag });
    writeFileSync(path, JSON.stringify(journal));
    writeFileSync(join(folder, `${tag}.sql`), body);
  }
  const applied = async () =>
    (await getDb().execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`))[0]!.n;

  it("on an empty database the baseline is not additive, and nothing is applied", async () => {
    // 0001 revoga privilégio e 0002 muda tipo: banco novo se cria à mão, nunca pelo push.
    const refusal = await runMigrations(folder, { additiveOnly: true }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(MigrationNeedsReview);
    expect((refusal as MigrationNeedsReview).message).toContain("0001_production_access: retira privilégio");
    const schema = await getDb().execute(sql`select to_regclass('production.job') as t`);
    expect(schema[0]!.t).toBeNull();
    // Tabela de controle criada e vazia (transação que falhou depois dela): ainda nada aplicado.
    await getDb().execute(sql`create schema drizzle`);
    await getDb().execute(sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
    await expect(runMigrations(folder, { additiveOnly: true })).rejects.toThrow(/0001_production_access/);
  });

  it("applies an additive batch and reports its tags", async () => {
    const published = (JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: unknown[] }).entries;
    expect(await runMigrations(folder)).toHaveLength(published.length);
    append("9001_aditiva", 'CREATE TABLE "production"."nova" ("id" integer);');
    expect(await runMigrations(folder, { additiveOnly: true })).toEqual(["9001_aditiva"]);
    expect((await getDb().execute(sql`select to_regclass('production.nova') as t`))[0]!.t).toBe("production.nova");
    expect(await runMigrations(folder, { additiveOnly: true })).toEqual([]);
  });

  it("refuses a destructive batch before any DDL, and keeps refusing when an additive one lands after it", async () => {
    await runMigrations(folder);
    const before = await applied();
    append("9001_destrutiva", 'ALTER TABLE "production"."job" DROP COLUMN "archived_at";');
    await expect(runMigrations(folder, { additiveOnly: true })).rejects.toThrow(/9001_destrutiva: remove objeto/);
    // O push seguinte traz só uma aditiva; a destrutiva continua no lote pendente.
    append("9002_aditiva", 'CREATE TABLE "production"."nova" ("id" integer);');
    await expect(runMigrations(folder, { additiveOnly: true })).rejects.toThrow(/9001_destrutiva/);
    expect(await applied()).toBe(before);
    expect((await getDb().execute(sql`select to_regclass('production.nova') as t`))[0]!.t).toBeNull();
    // O disparo humano, depois de revisão, aplica o lote inteiro.
    expect(await runMigrations(folder)).toEqual(["9001_destrutiva", "9002_aditiva"]);
  });

  it("an unreadable journal fails before any DDL", async () => {
    await runMigrations(folder);
    writeFileSync(join(folder, "meta", "_journal.json"), "{");
    await expect(runMigrations(folder, { additiveOnly: true })).rejects.toThrow(SyntaxError);
  });
});
