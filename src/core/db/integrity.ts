import { is, isNotNull, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { getDb, type DB } from "./client.ts";
import * as schema from "./schema.ts";

export type ForeignKeyViolation = {
  table: string;
  key: Record<string, unknown>;
  parent: string;
  constraint: string;
};

/** Check actual rows, including composite ownership, without exposing private columns. */
export async function foreignKeyViolations(db: DB = getDb()): Promise<ForeignKeyViolation[]> {
  const violations: ForeignKeyViolation[] = [];
  for (const table of Object.values(schema).filter((value) => is(value, PgTable))) {
    const config = getTableConfig(table);
    const keys = [...config.columns.filter((col) => col.primary), ...config.primaryKeys.flatMap((key) => key.columns)];
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const present = sql.join(ref.columns.map((col) => sql`child.${sql.identifier(col.name)} is not null`), sql` and `);
      const match = sql.join(ref.columns.map((col, index) => sql`child.${sql.identifier(col.name)} = parent.${sql.identifier(ref.foreignColumns[index]!.name)}`), sql` and `);
      const rows = await db.execute(sql`select ${sql.join(keys.map((col) => sql`child.${sql.identifier(col.name)}`), sql`, `)}
        from ${table} as child where ${present}
        and not exists (select 1 from ${ref.foreignTable} as parent where ${match})`);
      for (const row of rows) violations.push({
        table: config.name, key: row, parent: getTableConfig(ref.foreignTable).name, constraint: fk.getName(),
      });
    }
  }
  return violations;
}

const orphanSession = sql`not exists (select 1 from ${schema.authUser} where ${schema.authUser.id} = ${schema.authSession.userId})`;
const orphanEvent = sql`${isNotNull(schema.authEvent.userId)} and not exists (select 1 from ${schema.authUser} where ${schema.authUser.id} = ${schema.authEvent.userId})`;

export async function orphanAuthSessionCount(db: DB = getDb()): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(schema.authSession).where(orphanSession);
  return row?.count ?? 0;
}

export async function orphanAuthEventCount(db: DB = getDb()): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(schema.authEvent).where(orphanEvent);
  return row?.count ?? 0;
}

/** Idempotent maintenance; return the rows this operation actually changed. */
export async function cleanupOrphanAuthSessions(db: DB = getDb()): Promise<number> {
  return (await db.delete(schema.authSession).where(orphanSession).returning({ id: schema.authSession.id })).length;
}

/** Preserve audit history while repairing references to removed users. */
export async function detachOrphanAuthEvents(db: DB = getDb()): Promise<number> {
  return (await db.update(schema.authEvent).set({ userId: null }).where(orphanEvent).returning({ id: schema.authEvent.id })).length;
}
