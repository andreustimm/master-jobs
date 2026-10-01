/**
 * Suíte: upgrade de banco POPULADO pela migration aditiva da rede por
 * candidato (#379).
 *
 * A 0031 só acrescenta: `target_account.candidate_id` anulável, FK
 * `ON DELETE CASCADE` e índice não único. Não atribui as linhas antigas —
 * isso é reescrita de dado e fica para um lote com revisão humana. Banco vazio
 * não prova que as linhas antigas sobrevivem intactas e sem dono; aqui o banco
 * chega na forma da 0030 com uma rede gravada.
 *
 * Fronteira DENTRO: o migrator real do Drizzle sobre `drizzle/postgres/`, num
 * PostgreSQL descartável; SQL bruto na forma da 0030.
 * Fronteira FORA: migração de produção (`migrate.yml`, ADR 0028).
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
/** A última forma sem dono no contato. */
const PREVIOUS = "0030_quota_watch";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let db: DB;
let client: postgres.Sql;
let partial: string;

/** Uma cópia de `drizzle/postgres` cujo journal para em `lastTag`. */
function foldersUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-upgrade-contatos-"));
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

describe("upgrade da rede de contatos (#379)", () => {
  it("acrescenta o dono sem reescrever a rede, e passa a apagá-la junto com o candidato", async () => {
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values
        (10, 'default', 'Dono', true),
        (11, 'user-convidado', 'Convidado', true);
      insert into production.target_account (name, company, category, linkedin_url) values
        ('Marina', 'Nubank', 'ai-leader', 'https://www.linkedin.com/in/marina'),
        ('Regal Rexnord', 'Regal Rexnord', 'former', null);
    `);
    const before = await client.unsafe(
      `select id, name, company, category, linkedin_url, status, notes, created_at
       from production.target_account order by id`,
    );

    await migrate(db, { migrationsFolder: FOLDER });

    // Nenhuma coluna antiga muda, e nenhuma linha ganha dono por adivinhação:
    // sem dono, o filtro por candidato a esconde de todas as contas.
    const after = await client.unsafe(
      `select id, name, company, category, linkedin_url, status, notes, created_at, candidate_id
       from production.target_account order by id`,
    );
    expect(after.map(({ candidate_id: _dono, ...resto }) => resto)).toEqual([...before]);
    expect(after.every((r) => r.candidate_id === null)).toBe(true);

    // A URL continua única no banco inteiro: a segunda conta é recusada.
    await expect(
      client.unsafe(`
        insert into production.target_account (candidate_id, name, category, linkedin_url)
        values (11, 'Marina', 'peer', 'https://www.linkedin.com/in/marina');
      `),
    ).rejects.toMatchObject({ code: "23505" });

    // Linha nova com dono inexistente é recusada pela FK; com dono, some junto.
    await expect(
      client.unsafe(`insert into production.target_account (candidate_id, name, category) values (999, 'X', 'peer')`),
    ).rejects.toMatchObject({ code: "23503" });
    await client.unsafe(`
      insert into production.target_account (candidate_id, name, category) values (11, 'Rafael', 'peer');
    `);
    await client.unsafe(`delete from production.candidate where id = 11`);
    const left = await client.unsafe(`select name from production.target_account order by id`);
    expect(left.map((r) => r.name)).toEqual(["Marina", "Regal Rexnord"]);
  });
});
