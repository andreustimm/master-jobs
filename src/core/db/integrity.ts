import { sql } from "drizzle-orm";
import { getDb, type DB } from "./client.ts";

export type ForeignKeyViolation = {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
};

/** Identifiable database diagnostic used by `jho db check`. */
export function foreignKeyViolations(db: DB = getDb()): Promise<ForeignKeyViolation[]> {
  return db.all<ForeignKeyViolation>(sql.raw("pragma foreign_key_check"));
}

export async function orphanAuthSessionCount(db: DB = getDb()): Promise<number> {
  const [row] = await db.all<{ count: number }>(sql.raw(`
    select count(*) as count
    from auth_session
    where not exists (
      select 1 from auth_user where auth_user.id = auth_session.user_id
    )
  `));
  return Number(row?.count ?? 0);
}

export async function orphanAuthEventCount(db: DB = getDb()): Promise<number> {
  const [row] = await db.all<{ count: number }>(sql.raw(`
    select count(*) as count
    from auth_event
    where user_id is not null
      and not exists (
        select 1 from auth_user where auth_user.id = auth_event.user_id
      )
  `));
  return Number(row?.count ?? 0);
}

/** Idempotent maintenance equivalent of migration 0014. */
export async function cleanupOrphanAuthSessions(db: DB = getDb()): Promise<number> {
  const before = await orphanAuthSessionCount(db);
  if (before === 0) return 0;
  await db.run(sql.raw(`
    delete from auth_session
    where not exists (
      select 1 from auth_user where auth_user.id = auth_session.user_id
    )
  `));
  return before - await orphanAuthSessionCount(db);
}


/** Preserve audit history while repairing references to removed users. */
export async function detachOrphanAuthEvents(db: DB = getDb()): Promise<number> {
  const before = await orphanAuthEventCount(db);
  if (before === 0) return 0;
  await db.run(sql.raw(`
    update auth_event
    set user_id = null
    where user_id is not null
      and not exists (
        select 1 from auth_user where auth_user.id = auth_event.user_id
      )
  `));
  return before - await orphanAuthEventCount(db);
}
