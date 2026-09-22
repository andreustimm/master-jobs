/**
 * Suíte: upgrade de um banco POPULADO na versão anterior até a versão atual.
 *
 * Por que isto existe: todo teste de banco do repositório migra um banco
 * vazio. Isso prova que o DDL é válido, não que a migration sobrevive aos
 * dados que produção já tem — backfill que pula linha, constraint apertada
 * antes do backfill, `DELETE` que leva decisão junto. `drizzle-kit generate`
 * também não prova nada disso: ele compara snapshots, não linhas.
 *
 * O ponto de partida é a 0003, a última versão antes das trilhas-alvo. As
 * migrations 0004–0006 são o único par backfill → constraint do histórico
 * PostgreSQL: a 0005 cria a trilha principal e preenche `job_score.track_id`,
 * a 0006 torna a coluna obrigatória e troca a chave primária. É o formato que
 * `.claude/skills/drizzle-safe-migrations` manda seguir, exercitado com dados.
 *
 * Fronteira DENTRO: o migrator real do Drizzle sobre `drizzle/postgres/`, num
 * banco PostgreSQL descartável; SQL bruto para escrever na forma da 0003,
 * porque o `schema.ts` de hoje não descreve mais aquela forma.
 * Fronteira FORA: migração de produção, que é humana (`migrate.yml`).
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
const PREVIOUS = "0003_familiar_darwin";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };
const readJournal = () =>
  JSON.parse(readFileSync(join(FOLDER, "meta/_journal.json"), "utf8")) as Journal;

let target: Awaited<ReturnType<typeof provisionTestDatabase>>;
let db: DB;
let client: postgres.Sql;
let partial: string;

/** Uma cópia de `drizzle/postgres` cujo journal para em `lastTag`. */
function foldersUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-upgrade-"));
  cpSync(FOLDER, dir, { recursive: true });
  const journal = readJournal();
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
  await seedPreviousVersion();
});

afterEach(async () => {
  await client.end({ timeout: 5 });
  await target.drop();
  rmSync(partial, { recursive: true, force: true });
});

const SCORE_COLUMNS = `candidate_id, job_id, fit, title_score, keyword_score, seniority_score,
  geo_score, comp_score, cluster, matched_keywords, missing_keywords, reasons, blockers, scorer_version`;
const score = (candidateId: number, jobId: number, fit: number) =>
  `(${candidateId}, ${jobId}, ${fit}, 1, 1, 1, 1, 1, 'core', '[]', '[]', '[]', '[]', '1.3.0')`;

/**
 * O acervo da versão anterior: três candidatos nos três casos que a 0005
 * distingue, pontuações de todos, e o funil (candidatura + histórico) que
 * nenhuma migration pode tocar.
 */
async function seedPreviousVersion(): Promise<void> {
  await client.unsafe(`
    insert into production.source (id, kind, handle, label) values ('lever:acme', 'lever', 'acme', 'Acme');
    insert into production.job (id, fingerprint, content_hash, source_id, external_id, company_name, title, url, raw)
    values
      (1, 'fp-1', 'ch-1', 'lever:acme', 'e-1', 'Acme', 'Staff AI Engineer', 'https://exemplo.test/1', '{}'),
      (2, 'fp-2', 'ch-2', 'lever:acme', 'e-2', 'Acme', 'Principal Architect', 'https://exemplo.test/2', '{}');
    insert into production.candidate (id, slug, name, is_default) values
      (1, 'dono', 'Dono', true),
      (2, 'com-perfil', 'Com Perfil', false),
      (3, 'sem-perfil', 'Sem Perfil', false);
    insert into production.candidate_matching_profile (candidate_id, profile_json) values
      (2, '{"targets":["AI Architect"],"keywords":{"core":["rag"]},"seniority":{"min_years_expected":10,"reject_below_years":5},"compensation":{"reference_currency":"USD","ranges":[]}}');
    insert into production.job_score (${SCORE_COLUMNS}) values
      ${score(1, 1, 81)}, ${score(1, 2, 64)}, ${score(2, 1, 70)}, ${score(3, 1, 55)};
    insert into production.application (id, candidate_id, job_id, status, applied_at, notes) values
      (1, 1, 1, 'screening', '2026-09-01T10:00:00.000Z', 'indicação da Ana'),
      (2, 3, 1, 'applied', '2026-09-02T10:00:00.000Z', null);
    insert into production.application_event (application_id, kind, from_status, to_status, detail) values
      (1, 'status', 'backlog', 'applied', 'enviei'),
      (1, 'status', 'applied', 'screening', 'recrutadora respondeu'),
      (2, 'status', 'backlog', 'applied', null);
  `);
}

async function funnel() {
  const applications = await client.unsafe(
    `select id, candidate_id, job_id, status, applied_at, notes, updated_at from production.application order by id`,
  );
  const events = await client.unsafe(`select * from production.application_event order by id`);
  return { applications: [...applications], events: [...events] };
}

async function appliedMigrations(): Promise<number> {
  const [row] = await client.unsafe(`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return row!.n as number;
}

describe("upgrade de banco populado", () => {
  it("transforma o previsto, conserva o funil e passa a recusar dado inconsistente", async () => {
    const before = await funnel();
    await migrate(db, { migrationsFolder: FOLDER });

    // Nada do funil muda: nem status, nem nota, nem `updated_at`, nem evento.
    expect(await funnel()).toEqual(before);

    // Transformação prevista pela 0005: dono e quem tem perfil ganham a
    // principal; quem tem perfil derivado tem alvo e faixa marcados como não
    // revisados; quem não tem nenhum dos dois fica sem trilha.
    const tracks = await client.unsafe(`
      select candidate_id, is_primary, target_json is null as sem_alvo, unreviewed_json
      from production.target_track order by candidate_id
    `);
    expect([...tracks]).toEqual([
      { candidate_id: 1, is_primary: true, sem_alvo: true, unreviewed_json: "[]" },
      { candidate_id: 2, is_primary: true, sem_alvo: false, unreviewed_json: '["targets","compensation"]' },
    ]);

    // Toda pontuação que sobrou aponta para a principal do próprio candidato;
    // a do candidato sem trilha (pontuado com o perfil de outra pessoa) saiu.
    const scores = await client.unsafe(`
      select s.candidate_id, s.job_id, s.fit, t.candidate_id as track_owner
      from production.job_score s join production.target_track t on t.id = s.track_id
      order by s.candidate_id, s.job_id
    `);
    expect([...scores]).toEqual([
      { candidate_id: 1, job_id: 1, fit: 81, track_owner: 1 },
      { candidate_id: 1, job_id: 2, fit: 64, track_owner: 1 },
      { candidate_id: 2, job_id: 1, fit: 70, track_owner: 2 },
    ]);

    // A constraint apertada pela 0006 vale para dado novo.
    await expect(
      client.unsafe(`insert into production.job_score (${SCORE_COLUMNS}) values ${score(1, 2, 10)}`),
    ).rejects.toMatchObject({ code: "23502" });
    await expect(
      client.unsafe(`
        insert into production.target_track (candidate_id, name, name_key, is_primary, position)
        values (1, 'Outra', 'outra', true, 2)
      `),
    ).rejects.toMatchObject({ code: "23505" });

    // Rodar de novo é inócuo: nada pendente, nada duplicado.
    const applied = await appliedMigrations();
    await migrate(db, { migrationsFolder: FOLDER });
    expect(await appliedMigrations()).toBe(applied);
    const [again] = await client.unsafe(`select count(*)::int as n from production.target_track`);
    expect(again!.n).toBe(2);
  });

  it("falha no meio sem deixar metade aplicada, e retoma depois de corrigida a causa", async () => {
    // O migrator aplica todas as pendentes numa única transação. Uma falha na
    // 0007 precisa desfazer também 0004–0006: banco meio migrado é o estado
    // que ninguém sabe reverter. O conflito é plantado, não simulado.
    await client.unsafe(`create table production.platform_quota (platform text)`);
    const before = await funnel();
    const appliedBefore = await appliedMigrations();

    await expect(migrate(db, { migrationsFolder: FOLDER })).rejects.toThrow();

    expect(await appliedMigrations()).toBe(appliedBefore);
    const [trackTable] = await client.unsafe(`select to_regclass('production.target_track') as t`);
    expect(trackTable!.t).toBeNull();
    const [scores] = await client.unsafe(`select count(*)::int as n from production.job_score`);
    expect(scores!.n).toBe(4);
    expect(await funnel()).toEqual(before);

    // Retomada: remove a causa e roda o mesmo comando. Nenhum passo manual no
    // histórico de migrations.
    await client.unsafe(`drop table production.platform_quota`);
    await migrate(db, { migrationsFolder: FOLDER });
    expect(await appliedMigrations()).toBe(readJournal().entries.length);
    expect(await funnel()).toEqual(before);
  });
});
