/**
 * Suíte: migração 0036 do acesso de recrutador (#465, ADR-011; `_tests.md` IT-001).
 *
 * Fronteira DENTRO: o SQL de `drizzle/postgres/` aplicado de verdade num
 * Postgres descartável — primeiro até a 0035, com dado semeado no schema
 * anterior, depois o resto.
 * Fronteira FORA: nada é dublado.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectDatabase, type DB } from "../src/core/db/client.ts";
import { reviewMigrations } from "../src/core/db/migration-review.ts";
import { provisionTestDatabase } from "./support/db.ts";

const SOURCE = "./drizzle/postgres";
const MIGRATION = "0036_recrutador_acesso";

type Journal = { entries: Array<{ tag: string }> };

let temp: string;
let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let connection: ReturnType<typeof connectDatabase>;
let db: DB;

/** Cópia da pasta de migrações com o journal cortado antes da 0036. */
function folderBefore(tag: string): string {
  const dir = mkdtempSync(join(temp, "migrations-"));
  cpSync(SOURCE, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw new Error(`${tag} fora do journal`);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

beforeEach(async () => {
  temp = mkdtempSync(join(tmpdir(), "jho-recruiter-migration-"));
  target = await provisionTestDatabase();
  connection = connectDatabase(target.url);
  db = connection.db;
  await migrate(db, { migrationsFolder: folderBefore(MIGRATION) });
});

afterEach(async () => {
  await connection.client.end();
  await target.drop();
  rmSync(temp, { recursive: true, force: true });
});

async function seedLegacyLinks(): Promise<void> {
  await db.execute(sql`
    insert into production.auth_user (id, email, full_name, roles) values
      (1, 'dono@x.com', 'Dono', '["admin"]'),
      (2, 'ana.rec@x.com', 'Ana Recrutadora', '["recruiter"]'),
      (3, 'bia.rec@x.com', null, '["recruiter"]')`);
  await db.execute(sql`
    insert into production.candidate (id, slug, name) values (7, 'sete', 'Sete'), (8, 'oito', 'Oito')`);
  await db.execute(sql`
    insert into production.recruiter_candidate (recruiter_user_id, candidate_id, created_by, created_at) values
      (2, 7, 1, '2026-01-01T00:00:00Z'),
      (3, 8, null, '2026-02-02T00:00:00.000Z')`);
}

describe("migração 0036: cópia dos vínculos", () => {
  it("IT-001 cada vínculo vira concessão ativa sem fim, com evento grant_created do sistema", async () => {
    await seedLegacyLinks();

    await migrate(db, { migrationsFolder: SOURCE });

    const grants = await db.execute<{
      id: number;
      candidate_id: number;
      recruiter_user_id: number;
      recruiter_email: string;
      status: string;
      created_by: number | null;
      created_at: string;
      expires_at: string | null;
      ended_at: string | null;
    }>(sql`select id, candidate_id, recruiter_user_id, recruiter_email, status, created_by, created_at, expires_at, ended_at
           from production.recruiter_grant order by candidate_id`);
    expect(grants.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        candidate_id: 7,
        recruiter_user_id: 2,
        recruiter_email: "ana.rec@x.com",
        status: "active",
        created_by: 1,
        created_at: "2026-01-01T00:00:00Z",
        expires_at: null,
        ended_at: null,
      },
      {
        candidate_id: 8,
        recruiter_user_id: 3,
        recruiter_email: "bia.rec@x.com",
        status: "active",
        created_by: null,
        created_at: "2026-02-02T00:00:00.000Z",
        expires_at: null,
        ended_at: null,
      },
    ]);

    const events = await db.execute<{ grant_id: number; candidate_id: number; kind: string; actor: string; recruiter_email: string; at: string }>(
      sql`select grant_id, candidate_id, kind, actor, recruiter_email, at from production.recruiter_access_event order by candidate_id`,
    );
    expect(events).toEqual([
      { grant_id: grants[0]!.id, candidate_id: 7, kind: "grant_created", actor: "system", recruiter_email: "ana.rec@x.com", at: "2026-01-01T00:00:00Z" },
      { grant_id: grants[1]!.id, candidate_id: 8, kind: "grant_created", actor: "system", recruiter_email: "bia.rec@x.com", at: "2026-02-02T00:00:00.000Z" },
    ]);

    // A tabela antiga fica como estava: congelada, não removida.
    const [legacy] = await db.execute<{ n: number }>(sql`select count(*)::int as n from production.recruiter_candidate`);
    expect(legacy!.n).toBe(2);
  });

  it("IT-001 sem vínculo antigo, a migração cria as tabelas vazias", async () => {
    await migrate(db, { migrationsFolder: SOURCE });
    const [counts] = await db.execute<{ grants: number; events: number }>(sql`
      select (select count(*) from production.recruiter_grant)::int as grants,
             (select count(*) from production.recruiter_access_event)::int as events`);
    expect(counts).toEqual({ grants: 0, events: 0 });
  });

  it("IT-001 a migração é aditiva: a promoção automática a aplica sem revisão humana", () => {
    const review = reviewMigrations([{ name: MIGRATION, sql: readFileSync(join(SOURCE, `${MIGRATION}.sql`), "utf8") }]);
    expect(review).toEqual({ automatic: true, findings: [] });
  });
});
