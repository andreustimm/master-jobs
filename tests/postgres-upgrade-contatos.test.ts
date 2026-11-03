/**
 * Suíte: upgrade de banco POPULADO pelas migrations da rede por candidato
 * (#379, #405).
 *
 * A 0031 só acrescenta: `target_account.candidate_id` anulável, FK
 * `ON DELETE CASCADE` e índice não único, sem atribuir as linhas antigas. A
 * 0034 é o lote não aditivo que vem depois: apaga a órfã que tem gêmea já do
 * dono, atribui o resto ao candidato de slug `default`, troca o índice global
 * da URL por um por candidato e torna o dono obrigatório. Banco vazio não
 * prova nada disso; aqui o banco chega na forma anterior com uma rede gravada.
 *
 * Fronteira DENTRO: o migrator real do Drizzle sobre `drizzle/postgres/`, num
 * PostgreSQL descartável; SQL bruto na forma anterior a cada migration.
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

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const journal = JSON.parse(readFileSync(join(FOLDER, "meta/_journal.json"), "utf8")) as Journal;
/** A migration que dá dono à rede antiga (#405), achada pelo nome para sobreviver a renumeração. */
const backfillIndex = journal.entries.findIndex((e) => e.tag.endsWith("_contatos_candidato_obrigatorio"));
if (backfillIndex < 1) throw new Error("migration contatos_candidato_obrigatorio não está no journal");
/** A última forma em que contato pode não ter dono. */
const BEFORE_BACKFILL = journal.entries[backfillIndex - 1]!.tag;

let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let db: DB;
let client: postgres.Sql;
const partials: string[] = [];

/** Uma cópia de `drizzle/postgres` cujo journal para em `lastTag`. */
function foldersUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-upgrade-contatos-"));
  partials.push(dir);
  cpSync(FOLDER, dir, { recursive: true });
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cut < 0) throw new Error(`migration ${lastTag} não está no journal`);
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }));
  return dir;
}

beforeEach(async () => {
  target = await provisionTestDatabase();
  ({ db, client } = connectDatabase(target.url));
});

afterEach(async () => {
  await client.end({ timeout: 5 });
  await target.drop();
  for (const dir of partials.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const rede = () =>
  client.unsafe(
    `select id, candidate_id, name, company, category, linkedin_url, notes
     from production.target_account order by id`,
  );

const indices = async () =>
  (await client.unsafe(
    `select indexname from pg_indexes where schemaname = 'production' and tablename = 'target_account' order by indexname`,
  )).map((r) => r.indexname as string);

const aplicadas = async () =>
  Number((await client.unsafe(`select count(*)::int as n from drizzle.__drizzle_migrations`))[0]!.n);

describe("0031: o dono entra sem reescrever a rede (#379)", () => {
  it("acrescenta o dono sem reescrever a rede, e passa a apagá-la junto com o candidato", async () => {
    await migrate(db, { migrationsFolder: foldersUpTo("0030_quota_watch") });
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

    await migrate(db, { migrationsFolder: foldersUpTo("0031_contatos_por_candidato") });

    // Nenhuma coluna antiga muda, e nenhuma linha ganha dono por adivinhação.
    const after = await client.unsafe(
      `select id, name, company, category, linkedin_url, status, notes, created_at, candidate_id
       from production.target_account order by id`,
    );
    expect(after.map(({ candidate_id: _dono, ...resto }) => resto)).toEqual([...before]);
    expect(after.every((r) => r.candidate_id === null)).toBe(true);

    // Na 0031 a URL ainda é única no banco inteiro: a segunda conta é recusada.
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

describe(`${journal.entries[backfillIndex]!.tag}: a rede antiga volta para o dono (#405)`, () => {
  beforeEach(async () => {
    await migrate(db, { migrationsFolder: foldersUpTo(BEFORE_BACKFILL) });
  });

  it("atribui a rede ao candidato de slug default, nunca ao convidado com is_default", async () => {
    // O convidado 11 tem `is_default = true` por um defeito antigo; só o slug
    // decide. O 11 aparece ANTES na tabela para que um casamento por
    // `is_default` tivesse chance de pegá-lo.
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values
        (11, 'user-convidado', 'Convidado', true),
        (10, 'default', 'Dono', true);
      insert into production.target_account (name, company, category, linkedin_url, notes) values
        ('Marina', 'Nubank', 'ai-leader', 'https://www.linkedin.com/in/marina', 'nota antiga'),
        ('Regal Rexnord', 'Regal Rexnord', 'former', null, null);
      insert into production.target_account (candidate_id, name, category) values (11, 'Rafael', 'peer');
    `);
    const before = await rede();

    await migrate(db, { migrationsFolder: FOLDER });

    const after = await rede();
    expect(after.map((r) => [r.name, r.candidate_id])).toEqual([
      ["Marina", 10],
      ["Regal Rexnord", 10],
      ["Rafael", 11],
    ]);
    // Só o dono muda; nome, empresa, URL e nota ficam como estavam.
    expect(after.map(({ candidate_id: _dono, ...resto }) => resto)).toEqual(
      before.map(({ candidate_id: _dono, ...resto }) => resto),
    );
    expect(await indices()).toEqual([
      "target_account_candidate_idx",
      "target_account_candidate_url_idx",
      "target_account_pkey",
    ]);
  });

  it("recusa contato sem dono, aceita a mesma URL em outra conta e a recusa na mesma", async () => {
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values
        (10, 'default', 'Dono', true),
        (11, 'user-convidado', 'Convidado', false);
      insert into production.target_account (name, category, linkedin_url) values
        ('Marina', 'ai-leader', 'https://www.linkedin.com/in/marina');
    `);

    await migrate(db, { migrationsFolder: FOLDER });

    await expect(
      client.unsafe(`insert into production.target_account (name, category) values ('Sem dono', 'peer')`),
    ).rejects.toMatchObject({ code: "23502" });
    // Outra conta conhece a mesma pessoa: linha própria, sem tocar na do dono.
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
    // Sem URL não há chave: dois contatos sem URL na mesma conta convivem.
    await client.unsafe(`
      insert into production.target_account (candidate_id, name, category) values (10, 'A', 'peer'), (10, 'B', 'peer');
    `);
    expect((await rede()).map((r) => [r.candidate_id, r.name])).toEqual([
      [10, "Marina"],
      [11, "Marina"],
      [10, "A"],
      [10, "B"],
    ]);
  });

  it("apaga a órfã que tem gêmea já do dono e mantém a gêmea, sem casar o que não é gêmeo", async () => {
    // Cenário da #405: `jho contacts seed` rodou entre a 0031 e a 0034, e o
    // dono já tem a linha `former` de cada empresa. A órfã é a cópia antiga.
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values
        (10, 'default', 'Dono', true),
        (11, 'user-convidado', 'Convidado', true);
      insert into production.target_account (candidate_id, name, company, category, notes) values
        (null, 'Regal Rexnord', 'Regal Rexnord', 'former', 'nota antiga'),
        (10,   'Regal Rexnord', 'Regal Rexnord', 'former', 'nota do seed'),
        -- empresa nula dos dois lados: ainda é gêmea
        (null, 'Ana', null, 'peer', null),
        (10,   'Ana', null, 'peer', null),
        -- empresa nula só de um lado: não é gêmea, a órfã fica
        (null, 'Bruno', null, 'peer', null),
        (10,   'Bruno', 'Acme', 'peer', null),
        -- categoria diferente: não é gêmea
        (null, 'Carla', 'Acme', 'peer', null),
        (10,   'Carla', 'Acme', 'recruiter', null),
        -- gêmea do CONVIDADO, não do dono: a órfã fica e vai para o dono
        (null, 'Davi', 'Acme', 'peer', null),
        (11,   'Davi', 'Acme', 'peer', null);
      insert into production.target_account (candidate_id, name, company, category, linkedin_url) values
        -- órfã com URL nunca é apagada: a URL é a identidade da pessoa
        (null, 'Eva', 'Acme', 'peer', 'https://www.linkedin.com/in/eva'),
        (10,   'Eva', 'Acme', 'peer', null);
    `);

    await migrate(db, { migrationsFolder: FOLDER });

    const after = await rede();
    expect(after.map((r) => [r.candidate_id, r.name, r.company, r.category, r.notes])).toEqual([
      [10, "Regal Rexnord", "Regal Rexnord", "former", "nota do seed"],
      [10, "Ana", null, "peer", null],
      [10, "Bruno", null, "peer", null],
      [10, "Bruno", "Acme", "peer", null],
      [10, "Carla", "Acme", "peer", null],
      [10, "Carla", "Acme", "recruiter", null],
      [10, "Davi", "Acme", "peer", null],
      [11, "Davi", "Acme", "peer", null],
      [10, "Eva", "Acme", "peer", null],
      [10, "Eva", "Acme", "peer", null],
    ]);
    expect(after.filter((r) => r.name === "Eva").map((r) => r.linkedin_url).sort()).toEqual([
      "https://www.linkedin.com/in/eva",
      null,
    ]);
  });

  it("sem candidato default, desfaz o lote inteiro e não apaga nem reatribui contato", async () => {
    await client.unsafe(`
      insert into production.candidate (id, slug, name, is_default) values
        (11, 'user-convidado', 'Convidado', true);
      insert into production.target_account (candidate_id, name, company, category) values
        (null, 'Regal Rexnord', 'Regal Rexnord', 'former'),
        (11,   'Regal Rexnord', 'Regal Rexnord', 'former');
    `);
    const before = await rede();
    const antes = await aplicadas();

    await expect(migrate(db, { migrationsFolder: FOLDER })).rejects.toMatchObject({
      cause: { code: "23502" },
    });

    expect(await aplicadas()).toBe(antes);
    expect(await rede()).toEqual(before);
    expect(await indices()).toContain("target_account_url_idx");
    expect(await indices()).not.toContain("target_account_candidate_url_idx");
  });
});
