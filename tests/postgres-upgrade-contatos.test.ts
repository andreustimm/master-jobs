/**
 * Suíte: upgrade de banco POPULADO pelas migrations da rede por candidato (#379).
 *
 * Par backfill → constraint: a 0030 cria `target_account.candidate_id`
 * anulável, a 0031 atribui os contatos existentes ao candidato `default` (o da
 * CLI, que gravou todos eles) e a 0032 torna a coluna obrigatória. Banco vazio
 * não prova nada disso; aqui o banco chega na forma da 0029 com a rede do dono
 * e um convidado marcado `is_default` pelo defeito antigo de `ensureCandidate`.
 *
 * Fronteira DENTRO: o migrator real do Drizzle sobre `drizzle/postgres/`, num
 * PostgreSQL descartável; SQL bruto na forma da 0029.
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
const PREVIOUS = "0029_perfil_publico_foto_capa";

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

/** A rede como a 0029 a guarda: sem dono. */
async function seedNetwork(): Promise<void> {
  await client.unsafe(`
    insert into production.target_account (name, company, category, linkedin_url) values
      ('Marina', 'Nubank', 'ai-leader', 'https://www.linkedin.com/in/marina'),
      ('Regal Rexnord', 'Regal Rexnord', 'former', null),
      ('Rafael', 'Acme', 'peer', null);
  `);
}

async function appliedMigrations(): Promise<number> {
  const [row] = await client.unsafe(`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return row!.n as number;
}

describe("upgrade da rede de contatos (#379)", () => {
  it("atribui a rede ao candidato `default` e passa a recusar contato sem dono", async () => {
    // O convidado 11 carrega `is_default = true` do defeito antigo: o backfill
    // decide pelo slug, único, e não por essa flag.
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values
        (10, 'default', 'Dono', true),
        (11, 'user-convidado', 'Convidado', true);
    `);
    await seedNetwork();

    await migrate(db, { migrationsFolder: FOLDER });

    const rows = await client.unsafe(
      `select name, candidate_id from production.target_account order by name`,
    );
    expect(rows.map((r) => [r.name, r.candidate_id])).toEqual([
      ["Marina", 10],
      ["Rafael", 10],
      ["Regal Rexnord", 10],
    ]);

    // Contato sem dono deixa de existir.
    await expect(
      client.unsafe(`insert into production.target_account (name, category) values ('Órfão', 'peer')`),
    ).rejects.toMatchObject({ code: "23502" });

    // A URL é única dentro da rede, não no banco inteiro: o convidado pode
    // conhecer a mesma pessoa; o dono não pode cadastrá-la duas vezes.
    await client.unsafe(`
      insert into production.target_account (candidate_id, name, category, linkedin_url)
      values (11, 'Marina', 'peer', 'https://www.linkedin.com/in/marina');
    `);
    await expect(
      client.unsafe(`
        insert into production.target_account (candidate_id, name, category, linkedin_url)
        values (10, 'Marina de novo', 'peer', 'https://www.linkedin.com/in/marina');
      `),
    ).rejects.toMatchObject({ code: "23505" });

    // Apagar o convidado leva a rede dele e deixa a do dono.
    await client.unsafe(`delete from production.candidate where id = 11`);
    const left = await client.unsafe(`select candidate_id from production.target_account`);
    expect(left.every((r) => r.candidate_id === 10)).toBe(true);
    expect(left).toHaveLength(3);
  });

  it("sem candidato `default`, recusa o lote inteiro em vez de adivinhar o dono", async () => {
    // Contato órfão não é apagado nem entregue a um candidato qualquer: a
    // 0032 falha, e a transação desfaz a 0030 e a 0031 junto.
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values
        (11, 'user-convidado', 'Convidado', true);
    `);
    await seedNetwork();
    const before = await appliedMigrations();

    await expect(migrate(db, { migrationsFolder: FOLDER })).rejects.toThrow();

    expect(await appliedMigrations()).toBe(before);
    const columns = await client.unsafe(`
      select column_name from information_schema.columns
      where table_schema = 'production' and table_name = 'target_account' and column_name = 'candidate_id'
    `);
    expect(columns).toHaveLength(0);
    expect(await client.unsafe(`select id from production.target_account`)).toHaveLength(3);
  });
});
