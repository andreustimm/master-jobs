/**
 * Upgrade POPULADO da 0013 até a 0014 (nome de candidato que é e-mail).
 *
 * A 0014 é só dados: zera `candidate.name` quando ele é o e-mail da conta dona,
 * o e-mail do próprio candidato ou tem forma de e-mail. O teste de unidade em
 * `tests/public-name.test.ts` roda o SQL sobre um banco já na cabeça; este
 * roda o migrator real a partir da versão anterior, com as linhas que a 1.22.0
 * produziu, e confere que o funil não é tocado — o formato que
 * `.claude/skills/drizzle-safe-migrations` pede para migration de dados.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectDatabase, type DB } from "../src/core/db/client.ts";
import { provisionTestDatabase } from "./support/db.ts";

const FOLDER = "./drizzle/postgres";
const PREVIOUS = "0013_term_search_trgm";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let db: DB;
let client: postgres.Sql;
let partial: string;

function foldersUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-upgrade-0014-"));
  cpSync(FOLDER, dir, { recursive: true });
  const journal = JSON.parse(readFileSync(join(FOLDER, "meta/_journal.json"), "utf8")) as Journal;
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cut < 0) throw new Error(`migration ${lastTag} não está no journal`);
  journal.entries = journal.entries.slice(0, cut + 1);
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
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

async function funnel() {
  const applications = await client.unsafe(`select * from production.application order by id`);
  // Colunas explícitas: coluna aditiva posterior (como `reverts_event_id`, #316)
  // não é mudança do funil.
  const events = await client.unsafe(
    `select id, application_id, at, kind, from_status, to_status, detail from production.application_event order by id`,
  );
  return { applications: [...applications], events: [...events] };
}

describe("upgrade 0013 → 0014 com dados da 1.22.0", () => {
  it("zera só o nome que é e-mail e não toca o funil", async () => {
    await client.unsafe(`
      insert into production.source (id, kind, handle, label) values ('lever:acme', 'lever', 'acme', 'Acme');
      insert into production.job (id, fingerprint, content_hash, source_id, external_id, company_name, title, url, raw)
      values (1, 'fp-1', 'ch-1', 'lever:acme', 'e-1', 'Acme', 'Staff AI Engineer', 'https://exemplo.test/1', '{}');
      insert into production.candidate (id, slug, name, is_default, visibility, public_slug) values
        (1, 'default', 'Andreus Timm', true, 'public', 'default'),
        (2, 'user-pia-local-test', 'pia@local.test', false, 'public', 'pia-qa'),
        (3, 'user-nina-local-test', 'Nina Prado', false, 'private', null);
      insert into production.auth_user (email, roles, candidate_id) values
        ('dono@local.test', '["admin","candidate"]', 1),
        ('pia@local.test', '["candidate"]', 2),
        ('nina@local.test', '["candidate"]', 3);
      insert into production.application (id, candidate_id, job_id, status, applied_at, notes) values
        (1, 2, 1, 'applied', '2026-09-22T10:00:00.000Z', 'nota da Pia');
      insert into production.application_event (application_id, kind, from_status, to_status, detail) values
        (1, 'status', 'backlog', 'applied', null);
    `);
    const before = await funnel();

    await migrate(db, { migrationsFolder: FOLDER });

    const names = await client.unsafe(`select id, name from production.candidate order by id`);
    expect([...names]).toEqual([
      { id: 1, name: "Andreus Timm" },
      { id: 2, name: "" },
      { id: 3, name: "Nina Prado" },
    ]);
    expect(await funnel()).toEqual(before);
  });
});
