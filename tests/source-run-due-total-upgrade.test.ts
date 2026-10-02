/**
 * Upgrade da 0033 (`source_run.due_total`, #447) sobre um banco POPULADO.
 *
 * A coluna é aditiva e anulável: a execução gravada antes dela não sabe quantas
 * vagas estavam vencidas, e o certo é continuar sem saber — nulo, nunca zero
 * (US-009.EC-2). Um zero faria o detalhe dizer "3 de 0". O resto da linha não
 * muda, e a coluna passa a aceitar o total da execução nova.
 *
 * Fronteira DENTRO: o migrator real do Drizzle sobre `drizzle/postgres/`, num
 * banco PostgreSQL descartável; SQL bruto para escrever na forma da 0032.
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
const PREVIOUS = "0032_job_analysis_provider_status";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let db: DB;
let client: postgres.Sql;
let partial: string;

/** Uma cópia de `drizzle/postgres` cujo journal para em `lastTag`. */
function foldersUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-upgrade-due-"));
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

const RUN_COLUMNS = `id, scope_kind, source_id, idempotency_key, config_snapshot, status, queued_at, finished_at,
  fetched, alive, closed, inconclusive, completeness`;

async function runs() {
  return [...(await client.unsafe(`select ${RUN_COLUMNS} from production.source_run order by id`))];
}

describe("upgrade da 0033: source_run.due_total", () => {
  it("execução gravada antes da coluna fica com o total nulo, e a nova grava o número", async () => {
    await client.unsafe(`
      insert into production.source (id, kind, handle, label) values ('lever:acme', 'lever', 'acme', 'Acme');
      insert into production.source_run (${RUN_COLUMNS}) values
        (1, 'verify', 'lever:acme', 'verify:lever:acme@1', '{"sources":[]}', 'succeeded',
         '2026-09-30T10:00:00.000Z', '2026-09-30T10:01:00.000Z', 3, 3, 0, 0, 'partial'),
        (2, 'verify', null, 'verify:*@abc', '{"sources":[]}', 'succeeded',
         '2026-09-30T11:00:00.000Z', '2026-09-30T11:01:00.000Z', 5, 4, 1, 0, 'complete');
    `);
    const before = await runs();

    await migrate(db, { migrationsFolder: FOLDER });

    const after = await client.unsafe(`select id, due_total from production.source_run order by id`);
    expect([...after]).toEqual([
      { id: 1, due_total: null },
      { id: 2, due_total: null },
    ]);
    // O resto da linha não muda.
    expect(await runs()).toEqual(before);

    await client.unsafe(`
      insert into production.source_run (${RUN_COLUMNS}, due_total) values
        (3, 'verify', 'lever:acme', 'verify:lever:acme@2', '{"sources":[]}', 'succeeded',
         '2026-10-01T10:00:00.000Z', '2026-10-01T10:01:00.000Z', 3, 3, 0, 0, 'partial', 9);
    `);
    const [nova] = await client.unsafe(`select due_total from production.source_run where id = 3`);
    expect(nova!.due_total).toBe(9);
  });
});
