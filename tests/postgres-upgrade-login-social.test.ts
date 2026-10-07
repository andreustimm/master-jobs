/**
 * Upgrade da migração do login social (#464, ADR-009) sobre um banco POPULADO.
 *
 * A migração só acrescenta: duas tabelas novas (`auth_identity`,
 * `auth_signup`) e seis colunas anuláveis em `auth_user`. Conta que já existe
 * não pode mudar em nada — nem ganhar e-mail "confirmado" ou termo "aceito" que
 * ninguém confirmou ou aceitou. E ela precisa ser classificada como aditiva,
 * porque a promoção automática só deixa passar o que é (ADR 0028).
 *
 * Fronteira DENTRO: o migrator real do Drizzle sobre `drizzle/postgres/`, num
 * PostgreSQL descartável; SQL bruto na forma anterior à migração;
 * `reviewMigrations` sobre o arquivo gerado.
 * Fronteira FORA: migração de produção (`migrate.yml`).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectDatabase, type DB } from "../src/core/db/client.ts";
import { reviewMigrations } from "../src/core/db/migration-review.ts";
import { provisionTestDatabase } from "./support/db.ts";

const FOLDER = "./drizzle/postgres";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const journal = JSON.parse(readFileSync(join(FOLDER, "meta/_journal.json"), "utf8")) as Journal;
/** Achada pelo nome para sobreviver a renumeração. */
const loginIndex = journal.entries.findIndex((e) => e.tag.endsWith("_login_social"));
if (loginIndex < 1) throw new Error("migration login_social não está no journal");
const LOGIN_TAG = journal.entries[loginIndex]!.tag;
const PREVIOUS = journal.entries[loginIndex - 1]!.tag;

let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let db: DB;
let client: postgres.Sql;
let partial: string;

function foldersUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-upgrade-login-"));
  cpSync(FOLDER, dir, { recursive: true });
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }));
  return dir;
}

beforeEach(async () => {
  target = await provisionTestDatabase();
  ({ db, client } = connectDatabase(target.url));
  partial = foldersUpTo(PREVIOUS);
  await migrate(db, { migrationsFolder: partial });
});

afterEach(async () => {
  await client.end({ timeout: 5 });
  await target.drop();
  rmSync(partial, { recursive: true, force: true });
});

const USER_COLUMNS = "id, email, full_name, roles, password_hash, candidate_id, disabled_at, created_at";
const users = async () => [...(await client.unsafe(`select ${USER_COLUMNS} from production.auth_user order by id`))];

describe(`upgrade da ${LOGIN_TAG}`, () => {
  it("IT-101 contas existentes passam intactas, com as colunas novas nulas, e as tabelas novas funcionam", async () => {
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values (10, 'default', 'Dono', true);
      insert into production.auth_user (id, email, full_name, roles, password_hash, candidate_id, created_at) values
        (1, 'dono@example.test', 'Dono', '["admin","candidate"]', 'scrypt$hash', 10, '2026-01-01T00:00:00.000Z'),
        (2, 'recrutadora@example.test', null, '["recruiter"]', null, null, '2026-02-01T00:00:00.000Z');
      insert into production.auth_session (token_hash, user_id, expires_at) values ('h1', 1, '2099-01-01T00:00:00.000Z');
    `);
    const before = await users();

    await migrate(db, { migrationsFolder: FOLDER });

    expect(await users()).toEqual(before);
    const added = await client.unsafe(`
      select email_verified_at, terms_version, privacy_version, terms_accepted_at, signup_origin, locale
      from production.auth_user order by id`);
    expect([...added].every((row) => Object.values(row).every((v) => v === null))).toBe(true);
    const [sessions] = await client.unsafe(`select count(*)::int as n from production.auth_session`);
    expect(sessions!.n).toBe(1);

    await client.unsafe(`
      insert into production.auth_identity (user_id, provider, subject, email_at_link, origin)
      values (1, 'google', 'sub-1', 'dono@example.test', 'automatic');
      insert into production.auth_signup (kind, token_hash, email, locale, role, ip_hmac, expires_at)
      values ('manual', 't1', 'nova@example.test', 'pt-BR', 'candidate', 'hmac', '2099-01-01T00:00:00.000Z');
    `);
    const [identity] = await client.unsafe(`select linked_at, last_used_at from production.auth_identity`);
    expect(identity!.linked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(identity!.last_used_at).toBeNull();
    const [signup] = await client.unsafe(`select code_attempts, completed_at, user_id from production.auth_signup`);
    expect(signup).toEqual({ code_attempts: 0, completed_at: null, user_id: null });
  });

  it("IT-101 as restrições recusam identidade duplicada, provedor desconhecido e papel admin", async () => {
    await migrate(db, { migrationsFolder: FOLDER });
    await client.unsafe(`
      insert into production.auth_user (id, email, roles) values (1, 'a@example.test', '["candidate"]'), (2, 'b@example.test', '["candidate"]');
      insert into production.auth_identity (user_id, provider, subject, origin) values (1, 'google', 'sub-1', 'manual');
    `);
    // A mesma identidade do provedor em outra conta.
    await expect(
      client.unsafe(`insert into production.auth_identity (user_id, provider, subject, origin) values (2, 'google', 'sub-1', 'manual')`),
    ).rejects.toMatchObject({ code: "23505" });
    // Duas identidades do mesmo provedor na mesma conta.
    await expect(
      client.unsafe(`insert into production.auth_identity (user_id, provider, subject, origin) values (1, 'google', 'sub-2', 'manual')`),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      client.unsafe(`insert into production.auth_identity (user_id, provider, subject, origin) values (2, 'github', 'x', 'manual')`),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.unsafe(`insert into production.auth_signup (kind, token_hash, email, locale, role, ip_hmac, expires_at)
        values ('manual', 't9', 'x@example.test', 'en', 'admin', 'h', '2099-01-01T00:00:00.000Z')`),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.unsafe(`insert into production.auth_signup (kind, token_hash, email, locale, ip_hmac, expires_at)
        values ('invite', 't8', 'x@example.test', 'en', 'h', '2099-01-01T00:00:00.000Z')`),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("IT-101 a migração é classificada como aditiva e segue pela promoção automática", () => {
    const sql = readFileSync(join(FOLDER, `${LOGIN_TAG}.sql`), "utf8");
    expect(reviewMigrations([{ name: `${LOGIN_TAG}.sql`, sql }])).toEqual({ automatic: true, findings: [] });
  });
});
