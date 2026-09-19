import { createHash } from "node:crypto";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type postgres from "postgres";
import * as schema from "../../src/core/db/schema.ts";
import { postSnapshotTables, type selectProduction } from "./select-production.ts";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const schemaTables = Object.values(schema).filter((value) => is(value, PgTable)).map(getTableConfig);
// Tabela posterior ao snapshot não tem seleção: nasce vazia no alvo.
const tables = schemaTables.filter((table) => !postSnapshotTables.has(table.name));
const qualified = (name: string) => `"production".${quote(name)}`;

function dependencyOrder() {
  const pending = new Map(tables.map((table) => [table.name, table]));
  const ordered: typeof tables = [];
  while (pending.size) {
    const next = [...pending.values()].find((table) => table.foreignKeys.every((fk) =>
      !pending.has(getTableConfig(fk.reference().foreignTable).name)));
    if (!next) throw new Error("Migration requires an explicit strategy for cyclic foreign keys");
    ordered.push(next);
    pending.delete(next.name);
  }
  return ordered;
}

/** Target must already have versioned migrations applied. Never merges or overwrites data. */
export async function importProduction(sql: postgres.Sql, selection: ReturnType<typeof selectProduction>) {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '10s'`;
    await tx`SET LOCAL statement_timeout = '60s'`;
    const actual = await tx<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'production' ORDER BY tablename`;
    if (JSON.stringify(actual.map((row) => row.tablename)) !== JSON.stringify(schemaTables.map((t) => t.name).sort())) {
      throw new Error("Target table drift: apply and verify migrations before importing");
    }
    // Locks cover the empty-target check and the entire load, preventing races
    // with a mistakenly connected writer. No FK or trigger is disabled.
    await tx.unsafe(`LOCK TABLE ${tables.map((t) => qualified(t.name)).sort().join(",")} IN ACCESS EXCLUSIVE MODE`);
    for (const table of tables) {
      const count = await tx.unsafe(`SELECT count(*) AS n FROM ${qualified(table.name)}`);
      if (Number(count[0]!.n) !== 0) throw new Error(`Target is not empty: ${table.name}`);
    }
    for (const table of dependencyOrder()) {
      const rows = selection.rows[table.name];
      if (!rows) throw new Error(`Missing selection: ${table.name}`);
      for (const row of rows) {
        const parameters = table.columns.map((col) => {
          const value = row[col.name];
          if (col.dataType === "json" && value !== null) return JSON.stringify(value);
          if (value === null || typeof value === "string" || typeof value === "boolean" ||
              (typeof value === "number" && Number.isFinite(value))) return value;
          throw new Error(`Unsupported import value: ${table.name}.${col.name}`);
        });
        await tx.unsafe(`INSERT INTO ${qualified(table.name)} (${table.columns.map((c) => quote(c.name)).join(",")})
          VALUES (${parameters.map((_, index) => `$${index + 1}`).join(",")})`, parameters);
      }
    }
    for (const table of tables) {
      const keys = [...table.columns.filter((c) => c.primary), ...table.primaryKeys.flatMap((key) => key.columns)];
      const actualRows = await tx.unsafe(`SELECT * FROM ${qualified(table.name)} ORDER BY ${keys.map((c) => quote(c.name)).join(",")}`);
      const normalized = actualRows.map((row) => Object.fromEntries(table.columns.map((col) => [col.name, row[col.name]])));
      const hash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
      const expected = selection.manifest.find((entry) => entry.table === table.name);
      if (expected?.sha256 !== hash || expected.selectedCount !== actualRows.length) {
        throw new Error(`Target data verification failed: ${table.name}`);
      }
      for (const col of table.columns.filter((column) => column.generatedIdentity)) {
        const maximum = await tx.unsafe(`SELECT max(${quote(col.name)}) AS n FROM ${qualified(table.name)}`);
        const nextId = Math.max(1, Number(maximum[0]!.n ?? 0) + 1);
        if (!Number.isSafeInteger(nextId)) throw new Error(`Identity out of range: ${table.name}`);
        // ALTER RESTART is transactional, unlike setval: rollback includes IDs.
        await tx.unsafe(`ALTER TABLE ${qualified(table.name)} ALTER COLUMN ${quote(col.name)} RESTART WITH ${nextId}`);
      }
    }
    const invalid = await tx`SELECT conname FROM pg_constraint WHERE connamespace = 'production'::regnamespace AND NOT convalidated`;
    if (invalid.length) throw new Error("Target has unvalidated constraints");
    const [size] = await tx`SELECT pg_database_size(current_database()) AS database_bytes,
      (SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0) FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'production' AND c.relkind = 'r') AS application_bytes`;
    if (Number(size!.database_bytes) > 400 * 1024 * 1024) throw new Error("Database exceeds migration budget (400 MiB)");
    return { verifiedTables: tables.length, importedRows: selection.manifest.reduce((sum, row) => sum + row.selectedCount, 0),
      databaseBytes: Number(size!.database_bytes), applicationBytes: Number(size!.application_bytes) };
  });
}
