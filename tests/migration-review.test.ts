/**
 * Suíte: o detector que decide se uma migração roda sozinha em produção.
 *
 * Fronteira DENTRO: `src/core/db/migration-review.ts` inteiro — o separador de
 * comandos, a lista de permissão por forma de comando, o lote como unidade, o
 * diff da promoção e o critério de pendência do migrador.
 * Fronteira FORA: git, banco e workflow, cobertos em
 * `promotion-provenance.test.ts`, `cov-db-client-migrate.test.ts` e
 * `postgres-deployment.test.ts`.
 *
 * O erro caro é o falso negativo — destrutiva classificada como aditiva roda
 * sozinha enquanto o código antigo ainda serve. Por isso cada risco tem caso
 * próprio, e a forma desconhecida tem caso próprio também.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeFindings, pendingEntries, reviewMigrationChanges, reviewMigrations, splitStatements,
  type MigrationRisk,
} from "../src/core/db/migration-review.ts";

const one = (sql: string) => reviewMigrations([{ name: "0099_x", sql }]);
const risks = (sql: string): MigrationRisk[] => one(sql).findings.map((f) => f.risk);

describe("splitStatements — o que é comando e o que é texto", () => {
  it("separa por ponto e vírgula e pelo marcador do drizzle, sem comentário", () => {
    const parts = splitStatements(
      'CREATE TABLE "a" (x int);--> statement-breakpoint\n-- DROP TABLE b;\n/* DROP /* aninhado */ TABLE c; */ SELECT 1',
    );
    expect(parts.map((p) => p.text)).toEqual(["CREATE TABLE @0 (x int)", "SELECT 1"]);
    expect(parts[0]!.idents).toEqual(["a"]);
  });

  it("o marcador do drizzle separa comandos mesmo sem ponto e vírgula", () => {
    // O drizzle divide pelo marcador; sem esta fronteira, o CREATE TABLE
    // permitido esconderia o DROP que vem depois dele.
    const sql = 'CREATE TABLE "production"."t" ("id" integer)\n--> statement-breakpoint\nALTER TABLE "production"."job" DROP COLUMN "title"';
    expect(splitStatements(sql).map((p) => p.text)).toEqual(["CREATE TABLE @0 . @1 ( @2 integer)", "ALTER TABLE @0 . @1 DROP COLUMN @2"]);
    expect(risks(sql)).toEqual(["drop"]);
    // O drizzle divide pelo texto literal, até no fim de um comentário.
    const afterComment = 'CREATE TABLE "production"."t" ("id" integer) -- nota --> statement-breakpoint\nALTER TABLE "production"."job" DROP COLUMN "title"';
    expect(risks(afterComment)).toEqual(["drop"]);
  });

  it("mascara literal, literal com escape e corpo com cifrão", () => {
    const [plain, escaped, dollar, tagged] = splitStatements(
      "SELECT 'DROP TABLE x; ''ok'''; SELECT E'it\\'s; DROP'; DO $$ DROP TABLE y; $$; DO $f$ DELETE FROM z; $f$",
    );
    expect(plain!.text).toBe("SELECT ''");
    expect(escaped!.text).toBe("SELECT ''");
    expect(dollar!.text).toBe("DO $$ $$");
    expect(tagged!.text).toBe("DO $$ $$");
  });

  it("não confunde parâmetro nem identificador com cifrão com corpo", () => {
    expect(splitStatements("SELECT $1, a$b$c").map((p) => p.text)).toEqual(["SELECT $1, a$b$c"]);
  });

  it("identificador entre aspas sai do texto, com aspas duplicadas resolvidas", () => {
    const [statement] = splitStatements('ALTER TABLE "drop" ADD COLUMN "a""b" text');
    expect(statement!.text).toBe("ALTER TABLE @0 ADD COLUMN @1 text");
    expect(statement!.idents).toEqual(["drop", 'a"b']);
  });

  it("literal, identificador e comentário sem fim consomem o resto sem travar", () => {
    expect(splitStatements("SELECT 'aberto").map((p) => p.text)).toEqual(["SELECT ''"]);
    expect(splitStatements('SELECT "aberto').map((p) => p.idents)).toEqual([["aberto"]]);
    expect(splitStatements("SELECT 1 /* aberto").map((p) => p.text)).toEqual(["SELECT 1"]);
    expect(splitStatements("DO $$ aberto").map((p) => p.text)).toEqual(["DO $$ $$"]);
    expect(splitStatements("SELECT 1 -- fim").map((p) => p.text)).toEqual(["SELECT 1"]);
    expect(splitStatements(" ;; ")).toEqual([]);
  });
});

describe("reviewMigrations — o que roda sozinho", () => {
  it.each([
    ["schema", 'CREATE SCHEMA "production"'],
    ["tabela", 'CREATE TABLE IF NOT EXISTS "production"."t" ("id" integer PRIMARY KEY, "n" text NOT NULL)'],
    ["índice comum em tabela existente", 'CREATE INDEX "i" ON "production"."job" USING btree ("a","b")'],
    ["índice de expressão", `CREATE INDEX "i" ON "production"."job" USING gin (replace("t", ' ', '') gin_trgm_ops)`],
    ["sequência", "CREATE SEQUENCE s"],
    ["extensão", "CREATE EXTENSION IF NOT EXISTS pg_trgm"],
    ["enum novo", "CREATE TYPE \"production\".\"k\" AS ENUM ('a', 'b')"],
    ["valor novo de enum", "ALTER TYPE \"production\".\"k\" ADD VALUE 'c'"],
    ["grant", "GRANT SELECT ON ALL TABLES IN SCHEMA production TO master_jobs_runtime"],
    ["privilégio padrão concedido", "ALTER DEFAULT PRIVILEGES IN SCHEMA production GRANT SELECT ON TABLES TO r"],
    ["comentário", "COMMENT ON TABLE job IS 'vaga'"],
    ["insert simples", "INSERT INTO t (a) VALUES (1) ON CONFLICT DO NOTHING"],
    ["coluna nula", 'ALTER TABLE "production"."job" ADD COLUMN "archived_at" text'],
    ["coluna obrigatória com default", "ALTER TABLE job ADD COLUMN n integer DEFAULT 0 NOT NULL"],
    ["coluna gerada", "ALTER TABLE job ADD COLUMN n integer NOT NULL GENERATED ALWAYS AS (1) STORED"],
    ["coluna com FK sem default", "ALTER TABLE job ADD COLUMN c integer REFERENCES candidate(id)"],
    ["afrouxar obrigatoriedade", "ALTER TABLE job ALTER COLUMN n DROP NOT NULL"],
    ["trocar default", "ALTER TABLE job ALTER COLUMN n SET DEFAULT 1"],
  ])("%s", (_, sql) => {
    expect(one(sql)).toEqual({ automatic: true, findings: [] });
  });

  it("tabela nascida no lote aceita qualquer ajuste, mesmo em outro arquivo", () => {
    const review = reviewMigrations([
      { name: "0020", sql: 'CREATE TABLE "production"."novo" ("id" integer, "c" integer)' },
      {
        name: "0021",
        sql: [
          'ALTER TABLE "production"."novo" ADD CONSTRAINT "fk" FOREIGN KEY ("c") REFERENCES "production"."candidate"("id")',
          'CREATE UNIQUE INDEX "u" ON "production"."novo" USING btree ("c")',
          'ALTER TABLE production.novo ALTER COLUMN c SET NOT NULL',
        ].join(";--> statement-breakpoint\n"),
      },
    ]);
    expect(review).toEqual({ automatic: true, findings: [] });
  });

  it("restrição sobre coluna nova e sem default de tabela existente é aditiva", () => {
    // Forma da 0004 e da 0010: o código no ar nunca escreve a coluna, e ela nasce nula.
    expect(one([
      'ALTER TABLE "production"."job_score" ADD COLUMN "track_id" integer',
      'ALTER TABLE "production"."job_score" ADD CONSTRAINT "fk" FOREIGN KEY ("track_id") REFERENCES "production"."target_track"("id")',
      'ALTER TABLE production.job_score ADD UNIQUE ("track_id")',
      'CREATE UNIQUE INDEX "u" ON "production"."job_score" USING btree ("track_id")',
    ].join(";")).automatic).toBe(true);
  });
});

describe("reviewMigrations — o que parece novo e não é", () => {
  // Falso negativo aqui é o pior erro do detector: um DROP sobre tabela viva
  // passaria por ajuste em tabela recém-criada e rodaria sozinho.
  it.each<[string, string[], MigrationRisk[]]>([
    ["CREATE TABLE IF NOT EXISTS pode ser no-op sobre tabela viva", [
      'CREATE TABLE IF NOT EXISTS "production"."job" ("id" integer)',
      'ALTER TABLE "production"."job" DROP COLUMN "title"',
    ], ["drop"]],
    ["tabela de mesmo nome em outro schema não é a de produção", [
      'CREATE TABLE "backup"."job" ("id" integer)',
      'ALTER TABLE "production"."job" ALTER COLUMN "title" SET NOT NULL',
    ], ["set-not-null"]],
    ["nome sem schema não herda a tabela criada com schema", [
      'CREATE TABLE "production"."novo" ("id" integer)',
      "ALTER TABLE novo DROP COLUMN id",
    ], ["drop"]],
    ["ADD COLUMN IF NOT EXISTS não torna a coluna nova", [
      'ALTER TABLE "production"."job" ADD COLUMN IF NOT EXISTS "company_id" integer',
      'ALTER TABLE "production"."job" ADD CONSTRAINT "f" FOREIGN KEY ("company_id") REFERENCES "production"."company"("id")',
    ], ["constraint-on-existing"]],
    ["UNIQUE NULLS NOT DISTINCT em coluna nova", [
      'ALTER TABLE "production"."job" ADD COLUMN "k" integer',
      'ALTER TABLE "production"."job" ADD CONSTRAINT "u" UNIQUE NULLS NOT DISTINCT ("k")',
    ], ["constraint-on-existing"]],
    ["índice único NULLS NOT DISTINCT em coluna nova", [
      'ALTER TABLE "production"."job" ADD COLUMN "k" integer',
      'CREATE UNIQUE INDEX "u" ON "production"."job" USING btree ("k") NULLS NOT DISTINCT',
    ], ["constraint-on-existing"]],
    ["coluna nova declarada UNIQUE NULLS NOT DISTINCT", [
      'ALTER TABLE "production"."job" ADD COLUMN "k" integer UNIQUE NULLS NOT DISTINCT',
    ], ["constraint-on-existing"]],
  ])("%s", (_, statements, expected) => {
    expect(risks(statements.join(";\n"))).toEqual(expected);
  });

  it("SET NOT NULL em coluna nova com default é aditivo; sem default, não", () => {
    expect(risks("ALTER TABLE job ADD COLUMN n int DEFAULT 0; ALTER TABLE job ALTER COLUMN n SET NOT NULL")).toEqual([]);
    expect(risks("ALTER TABLE job ADD COLUMN n int; ALTER TABLE job ALTER COLUMN n SET NOT NULL")).toEqual(["set-not-null"]);
  });
});

describe("reviewMigrations — o que exige revisão", () => {
  it.each<[string, string, MigrationRisk]>([
    ["drop table", 'DROP TABLE "production"."job"', "drop"],
    ["drop index", "DROP INDEX IF EXISTS i", "drop"],
    ["drop column", 'ALTER TABLE "production"."job" DROP COLUMN "x"', "drop"],
    ["drop constraint", 'ALTER TABLE "production"."job_score" DROP CONSTRAINT "pk"', "drop"],
    ["drop default", "ALTER TABLE job ALTER COLUMN n DROP DEFAULT", "drop"],
    ["rename column", 'ALTER TABLE "production"."job" RENAME COLUMN "a" TO "b"', "rename"],
    ["rename table", "ALTER TABLE job RENAME TO vaga", "rename"],
    ["rename index", "ALTER INDEX i RENAME TO j", "rename"],
    ["rename de valor de enum", "ALTER TYPE k RENAME VALUE 'a' TO 'b'", "rename"],
    ["set data type", 'ALTER TABLE "production"."job" ALTER COLUMN "comp_min" SET DATA TYPE double precision', "type-change"],
    ["type", "ALTER TABLE job ALTER n TYPE bigint USING n::bigint", "type-change"],
    ["set not null", 'ALTER TABLE "production"."job_score" ALTER COLUMN "track_id" SET NOT NULL', "set-not-null"],
    ["coluna obrigatória sem default", "ALTER TABLE job ADD COLUMN n integer NOT NULL", "not-null-without-default"],
    ["coluna nova como chave primária", "ALTER TABLE job ADD COLUMN n serial PRIMARY KEY", "constraint-on-existing"],
    ["coluna única com default", "ALTER TABLE job ADD COLUMN n int DEFAULT 1 UNIQUE", "constraint-on-existing"],
    ["chave primária", 'ALTER TABLE "production"."job_score" ADD CONSTRAINT "pk" PRIMARY KEY("a","b")', "constraint-on-existing"],
    ["check", "ALTER TABLE job ADD CONSTRAINT c CHECK (n > 0)", "constraint-on-existing"],
    ["FK em coluna existente", "ALTER TABLE job ADD CONSTRAINT f FOREIGN KEY (company_id) REFERENCES company(id)", "constraint-on-existing"],
    ["FK composta sem lista simples", "ALTER TABLE job ADD FOREIGN KEY (lower(a)) REFERENCES x(a)", "constraint-on-existing"],
    ["único em coluna existente", 'CREATE UNIQUE INDEX "u" ON "production"."auth_user" USING btree ("candidate_id")', "constraint-on-existing"],
    ["único por expressão", "CREATE UNIQUE INDEX u ON job (lower(title))", "constraint-on-existing"],
    ["restrição de forma nova", "ALTER TABLE job ADD CONSTRAINT c NOT NULL n", "unknown"],
    ["update", "UPDATE job SET x = 1", "data-rewrite"],
    ["delete", 'DELETE FROM "production"."job_score" WHERE "track_id" IS NULL', "data-rewrite"],
    ["truncate", "TRUNCATE job", "data-rewrite"],
    ["merge", "MERGE INTO job USING x ON true WHEN MATCHED THEN DELETE", "data-rewrite"],
    ["upsert que sobrescreve", "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2", "data-rewrite"],
    ["revoke", "REVOKE ALL ON SCHEMA production FROM PUBLIC", "revoke"],
    ["privilégio padrão retirado", "ALTER DEFAULT PRIVILEGES IN SCHEMA production REVOKE ALL ON TABLES FROM r", "revoke"],
    ["bloco DO", "DO $$ BEGIN DROP TABLE job; END $$", "procedural"],
    ["função", "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql", "procedural"],
    ["trigger", "CREATE TRIGGER t BEFORE INSERT ON job FOR EACH ROW EXECUTE FUNCTION f()", "procedural"],
    ["view", "CREATE VIEW v AS SELECT 1", "unknown"],
    ["CTE que escreve", "WITH x AS (DELETE FROM job RETURNING id) SELECT 1", "unknown"],
    ["alter table sem forma conhecida", "ALTER TABLE job ENABLE ROW LEVEL SECURITY", "unknown"],
    ["alter column sem forma conhecida", "ALTER TABLE job ALTER COLUMN n SET STATISTICS 100", "unknown"],
    ["alter type sem forma conhecida", "ALTER TYPE k OWNER TO r", "unknown"],
    ["set", "SET search_path TO production", "unknown"],
  ])("%s", (_, sql, risk) => {
    const review = one(sql);
    expect(review.automatic).toBe(false);
    expect(review.findings.map((f) => f.risk)).toEqual([risk]);
    expect(review.findings[0]!.migration).toBe("0099_x");
  });

  it("uma palavra perigosa em literal, comentário ou nome não conta", () => {
    expect(one([
      "-- DROP TABLE job",
      "ALTER TABLE job ADD COLUMN note text DEFAULT 'DROP TABLE job; DELETE'",
      'CREATE TABLE "drop" ("rename" text)',
      'ALTER TABLE "production"."drop" ADD COLUMN "delete" text',
    ].join(";\n")).automatic).toBe(true);
  });

  it("uma ação ruim entre várias do mesmo ALTER TABLE basta", () => {
    expect(risks("ALTER TABLE job ADD COLUMN a text, DROP COLUMN b")).toEqual(["drop"]);
  });

  it("o achado mostra o comando com os nomes de volta e cortado", () => {
    const [finding] = one(`ALTER TABLE "production"."job" DROP COLUMN "${"x".repeat(200)}"`).findings;
    expect(finding!.statement.startsWith('ALTER TABLE "production"."job" DROP COLUMN "xxx')).toBe(true);
    expect(finding!.statement).toHaveLength(160);
    expect(finding!.statement.endsWith("...")).toBe(true);
    expect(describeFindings([finding!])).toBe(`0099_x: remove objeto, coluna, restrição ou default — ${finding!.statement}`);
  });

  it("lote vazio roda sozinho", () => {
    expect(reviewMigrations([])).toEqual({ automatic: true, findings: [] });
  });
});

describe("o histórico real de drizzle/postgres calibra o detector", () => {
  // Cada migração publicada, com o veredito que um revisor humano daria. Uma
  // mudança no detector que troque um destes precisa ser decisão, não acidente.
  const journal = JSON.parse(readFileSync("drizzle/postgres/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  const expected: Record<string, MigrationRisk[]> = {
    "0000_production_baseline": [],
    "0001_production_access": ["procedural", "revoke", "revoke", "revoke", "revoke", "procedural"],
    "0002_steep_korath": ["type-change", "type-change"],
    "0003_familiar_darwin": [],
    "0004_tidy_forge": [],
    "0005_backfill_primary_tracks": ["data-rewrite", "data-rewrite"],
    "0006_bent_gorgon": ["drop", "set-not-null", "constraint-on-existing"],
    "0007_term_captures": [],
    "0008_term_requests": [],
    "0009_auth_user_candidate_unique": ["constraint-on-existing"],
    "0010_candidate_public_slug": [],
    "0011_backfill_candidate_public_slug": ["data-rewrite"],
    "0012_enable_pg_trgm": [],
    "0013_term_search_trgm": [],
    "0014_clear_contact_candidate_names": ["data-rewrite"],
    "0015_job_score_job_idx": [],
    "0016_sweep_lease_and_runs": [],
    "0017_job_title_trgm": [],
    "0018_job_analysis": [],
    "0019_score_cursor": [],
    "0020_ingest_identity_and_request_budget": [],
  };

  it.each(journal.entries.map((entry) => entry.tag))("%s", (tag) => {
    // Migração nova sem veredito aqui reprova: calibrar é olhar para ela.
    expect(Object.keys(expected), `acrescente ${tag} a esta tabela`).toContain(tag);
    const review = reviewMigrations([{ name: tag, sql: readFileSync(`drizzle/postgres/${tag}.sql`, "utf8") }]);
    expect(review.findings.map((f) => f.risk)).toEqual(expected[tag]);
  });
});

describe("reviewMigrationChanges — o diff staging..alvo da promoção", () => {
  const read = (files: Record<string, string>) => (path: string) => files[path]!;

  it("migração nova aditiva, com snapshot e journal, dispensa confirmação", () => {
    const review = reviewMigrationChanges([
      { status: "M", path: "drizzle/postgres/meta/_journal.json" },
      { status: "A", path: "drizzle/postgres/meta/0017_snapshot.json" },
      { status: "A", path: "drizzle/postgres/0017_x.sql" },
    ], read({ "drizzle/postgres/0017_x.sql": "CREATE TABLE t (id int)" }));
    expect(review).toEqual({ automatic: true, findings: [] });
  });

  it("classifica as novas como um lote, em ordem de nome", () => {
    const review = reviewMigrationChanges([
      { status: "A", path: "drizzle/postgres/0018_b.sql" },
      { status: "A", path: "drizzle/postgres/0017_a.sql" },
    ], read({
      "drizzle/postgres/0017_a.sql": "CREATE TABLE t (id int)",
      "drizzle/postgres/0018_b.sql": "ALTER TABLE t DROP COLUMN id",
    }));
    expect(review.automatic).toBe(true);
  });

  it("migração nova destrutiva pede confirmação", () => {
    const review = reviewMigrationChanges(
      [{ status: "A", path: "drizzle/postgres/0017_x.sql" }],
      read({ "drizzle/postgres/0017_x.sql": "ALTER TABLE job DROP COLUMN x" }),
    );
    expect(review.findings).toEqual([{ migration: "drizzle/postgres/0017_x.sql", statement: "ALTER TABLE job DROP COLUMN x", risk: "drop" }]);
  });

  it.each(["M", "D", "T"])("migração publicada com status %s reescreve histórico", (status) => {
    const review = reviewMigrationChanges([{ status, path: "drizzle/postgres/0003_x.sql" }], () => {
      throw new Error("não deveria ler");
    });
    expect(review.findings).toEqual([{ migration: "drizzle/postgres/0003_x.sql", statement: `status ${status}`, risk: "history-rewritten" }]);
  });

  it("arquivo fora de drizzle/postgres pede revisão", () => {
    for (const path of ["drizzle/0029_legacy.sql", "drizzle/postgres/sub/x.sql", "drizzle/postgres/notes.md"]) {
      expect(reviewMigrationChanges([{ status: "A", path }], () => "").findings.map((f) => f.risk)).toEqual(["outside-postgres"]);
    }
  });

  it("nenhuma mudança roda sozinha", () => {
    expect(reviewMigrationChanges([], () => "")).toEqual({ automatic: true, findings: [] });
  });
});

describe("pendingEntries — o mesmo critério do migrador do drizzle", () => {
  const journal = [{ tag: "a", when: 10 }, { tag: "b", when: 20 }, { tag: "c", when: 30 }];

  it("banco sem tabela de controle recebe tudo", () => {
    expect(pendingEntries(journal, null)).toEqual(journal);
  });

  it("aplica o que é estritamente mais novo que a última aplicada", () => {
    expect(pendingEntries(journal, 20).map((e) => e.tag)).toEqual(["c"]);
    expect(pendingEntries(journal, 19).map((e) => e.tag)).toEqual(["b", "c"]);
    expect(pendingEntries(journal, 30)).toEqual([]);
  });
});
