import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  cleanupOrphanAuthSessions,
  detachOrphanAuthEvents,
  foreignKeyViolations,
  orphanAuthEventCount,
  orphanAuthSessionCount,
} from "../src/core/db/integrity.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

describe("database integrity", () => {
  it("removes invalid sessions, preserves audit events and is idempotent", async () => {
    await db.run(sql.raw("pragma foreign_keys = off"));
    await db.run(sql.raw(`
      insert into auth_session (token_hash, user_id, expires_at)
      values ('orphan-token', 999999, '2099-01-01T00:00:00.000Z')
    `));
    await db.run(sql.raw(`
      insert into auth_event (user_id, email, kind, detail)
      values (999999, 'former@example.test', 'logout', 'preserve me')
    `));
    await db.run(sql.raw("pragma foreign_keys = on"));

    expect(await orphanAuthSessionCount(db)).toBe(1);
    expect(await orphanAuthEventCount(db)).toBe(1);
    expect(await foreignKeyViolations(db)).toHaveLength(2);
    await expect(cleanupOrphanAuthSessions(db)).resolves.toBe(1);
    await expect(cleanupOrphanAuthSessions(db)).resolves.toBe(0);
    await expect(detachOrphanAuthEvents(db)).resolves.toBe(1);
    await expect(detachOrphanAuthEvents(db)).resolves.toBe(0);
    expect(await foreignKeyViolations(db)).toEqual([]);
    const [event] = await db.all<{ userId: number | null; detail: string }>(sql.raw(`
      select user_id as userId, detail from auth_event
      where email = 'former@example.test'
    `));
    expect(event).toEqual({ userId: null, detail: "preserve me" });
  });

  it("keeps the migration limited to the orphan-session predicate", () => {
    const migration = readFileSync(
      "drizzle/0014_cleanup_orphan_auth_sessions.sql",
      "utf8",
    );
    expect(migration).toContain("DELETE FROM `auth_session`");
    expect(migration).toContain("UPDATE `auth_event`");
    expect(migration).toContain("SET `user_id` = NULL");
    expect(migration).toContain("--> statement-breakpoint");
    expect(migration).toContain("WHERE NOT EXISTS");
    expect(migration).toContain("`auth_user`.`id` = `auth_session`.`user_id`");
    expect(migration).not.toMatch(/delete\s+from\s+`?auth_user`?/i);
  });
});
