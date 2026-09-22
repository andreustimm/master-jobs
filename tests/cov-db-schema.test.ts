/**
 * Suíte: as chaves estrangeiras declaradas em `src/core/db/schema.ts`.
 *
 * Por que isto existe: a política de exclusão de cada FK é uma decisão de
 * produto disfarçada de detalhe de schema. `cascade` significa "apagar o pai
 * apaga o filho"; `set null` significa "preserve o filho e esqueça o vínculo".
 * As regras invioláveis do projeto dependem dessa escolha — a regra 3 ("vaga
 * que some é fechada, nunca deletada") só é necessária porque
 * `application.job_id` é `cascade`, e a trilha de auditoria de
 * `auth_event` só sobrevive à remoção de uma conta porque ali é `set null`.
 *
 * Fronteira DENTRO: a declaração em TypeScript e o DDL efetivamente aplicado
 * pelas migrations, comparados um contra o outro.
 * Fronteira FORA: a lógica que decide quando apagar, que mora nos casos de uso.
 */
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import * as schema from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { foreignKeyParityDiff } from "./support/fk-intent.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

type DeclaredFk = {
  table: string;
  from: string[];
  to: string;
  toColumns: string[];
  onDelete: string;
};

/** Toda tabela exportada pelo schema, na ordem em que o módulo as declara. */
function allTables(): PgTable[] {
  // `unknown[]` antes de filtrar: o módulo exporta tabelas E tuplas de
  // constantes (`ROLES`, `APPLICATION_STATUSES`…), então `Object.values` produz
  // uma união em que o predicado de tipo não é atribuível ao parâmetro. O
  // estreitamento continua sendo feito por `is()`, em tempo de execução.
  const exported: unknown[] = Object.values(schema);
  return exported.filter((value): value is PgTable => is(value, PgTable));
}

/**
 * Resolve cada FK declarada.
 *
 * A referência é declarada como função (`() => outraTabela.coluna`) porque as
 * tabelas se referenciam em ciclo e o módulo precisa terminar de carregar antes
 * de qualquer uma poder apontar para a outra. Resolver aqui é o que prova que
 * nenhuma dessas funções aponta para uma tabela ou coluna que não existe mais.
 */
function declaredForeignKeys(): DeclaredFk[] {
  const out: DeclaredFk[] = [];
  for (const table of allTables()) {
    const config = getTableConfig(table);
    for (const fk of config.foreignKeys) {
      const reference = fk.reference();
      out.push({
        table: config.name,
        from: reference.columns.map((c) => c.name),
        to: getTableConfig(reference.foreignTable).name,
        toColumns: reference.foreignColumns.map((c) => c.name),
        // O Drizzle já entrega "no action" quando nada foi escrito, e o
        // PostgreSQL grava o mesmo. Por isso esta comparação prova PARIDADE, não
        // intenção; a intenção escrita é de `fk-delete-intent.test.ts`.
        onDelete: (fk.onDelete ?? "no action").toUpperCase(),
      });
    }
  }
  return out;
}

/*
 * Histórico: na era SQLite (migrations em `drizzle/*.sql`, hoje só legado de
 * importação), a 0021 acrescentou `job.posted_by_user_id` e
 * `auth_session.impersonated_by` com `ALTER TABLE ... ADD ... REFERENCES` sem
 * `ON DELETE`, o SQLite assumiu `NO ACTION` em silêncio e a 0025 teve de
 * reconstruir as tabelas. No PostgreSQL (`drizzle/postgres/`) não há exceção
 * nenhuma: a comparação abaixo exige igualdade total.
 */

/** As FKs do schema `production`, lidas de `pg_constraint`. */
async function appliedForeignKeys() {
  return db.execute<DeclaredFk & { validated: boolean }>(sql`
    select child.relname as "table", parent.relname as "to",
      array(select a.attname from unnest(c.conkey) with ordinality k(attnum, position)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.position) as "from",
      array(select a.attname from unnest(c.confkey) with ordinality k(attnum, position)
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.position) as "toColumns",
      case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as "onDelete",
      c.convalidated as validated
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    where c.contype = 'f' and c.connamespace = 'production'::regnamespace
  `);
}

describe("chaves estrangeiras declaradas", () => {
  it("aponta toda referência para uma tabela e uma coluna que existem", async () => {
    // Uma referência quebrada não falha no import: a função só é chamada quando
    // alguém resolve a FK. Sem este caso, o erro apareceria na próxima migration
    // gerada — depois do commit, e possivelmente depois do deploy.
    const declared = declaredForeignKeys();
    const existentes = new Set(allTables().map((t) => getTableConfig(t).name));

    expect(declared.length).toBeGreaterThan(20);
    for (const fk of declared) {
      expect(existentes, `${fk.table}.${fk.from.join(",")}`).toContain(fk.to);
      expect(fk.toColumns.length, `${fk.table}.${fk.from.join(",")}`).toBe(fk.from.length);
      expect(fk.from.every((c) => c.length > 0)).toBe(true);
    }
  });

  it("mantém o banco migrado idêntico ao que o schema declara", async () => {
    // Este é o caso que pega "editou schema.ts e esqueceu de rodar
    // `pnpm db:generate`". As duas fontes divergindo é o pior modo de falha do
    // ORM: o TypeScript continua compilando, as queries continuam passando, e a
    // política de exclusão em produção é a antiga.
    const rows = await appliedForeignKeys();
    expect(rows.every((row) => row.validated)).toBe(true);
    expect(foreignKeyParityDiff(declaredForeignKeys(), rows)).toEqual({
      missingInDatabase: [],
      notDeclared: [],
    });
  });

  it("acusa a FK cuja ação aplicada difere da declarada, sem acusar as demais", async () => {
    // O caso adverso da paridade: alguém "corrige" uma FK direto no banco (ou
    // uma migration escrita à mão troca a ação). O schema continua dizendo
    // SET NULL e o banco passa a apagar em cascata — o pior modo de falha,
    // porque nada no TypeScript muda.
    await db.execute(sql.raw(`
      alter table production.job drop constraint job_posted_by_user_id_auth_user_id_fk;
      alter table production.job add constraint job_posted_by_user_id_auth_user_id_fk
        foreign key (posted_by_user_id) references production.auth_user(id) on delete cascade;
    `));

    const diff = foreignKeyParityDiff(declaredForeignKeys(), await appliedForeignKeys());
    expect(diff).toEqual({
      missingInDatabase: ["job(posted_by_user_id) -> auth_user(id) ON DELETE SET NULL"],
      notDeclared: ["job(posted_by_user_id) -> auth_user(id) ON DELETE CASCADE"],
    });
  });

  // O caso que afirmava as duas divergências da migration 0021 saiu daqui: a
  // 0025 reconstruiu as tabelas e o banco passou a aplicar `SET NULL` e
  // `CASCADE` como o schema declara. O comportamento — apagar a conta e ver a
  // vaga sobreviver sem atribuição, a sessão emprestada cair e a própria ficar
  // — está em `tests/fk-on-delete.test.ts`, que apaga linha de verdade em vez
  // de ler a definição da chave.

  it("preserva a auditoria e derruba a sessão quando uma conta é removida", async () => {
    // As duas metades da mesma decisão. Sessão é credencial: sobreviver ao dono
    // seria acesso órfão. Evento é história: apagar junto destruiria o registro
    // de que a conta existiu e do que ela fez — que é justamente o que uma
    // auditoria vai querer ler depois da remoção.
    const declared = declaredForeignKeys();
    const politica = (tabela: string, coluna: string) =>
      declared.find((fk) => fk.table === tabela && fk.from.includes(coluna))?.onDelete;

    expect(politica("auth_session", "user_id")).toBe("CASCADE");
    expect(politica("auth_event", "user_id")).toBe("SET NULL");
    expect(politica("job", "posted_by_user_id")).toBe("SET NULL");

    const [user] = await db
      .insert(schema.authUser)
      .values({ email: "sai@exemplo.test", roles: ["owner"] })
      .returning({ id: schema.authUser.id });
    await db.insert(schema.authSession).values({
      tokenHash: "hash-sessao",
      userId: user!.id,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await db.insert(schema.authEvent).values({
      userId: user!.id,
      email: "sai@exemplo.test",
      kind: "login",
      detail: "precisa sobreviver",
    });

    await db.execute(sql.raw(`delete from production.auth_user where id = ${user!.id}`));

    const sessoes = await db.select().from(schema.authSession);
    const eventos = await db.select().from(schema.authEvent);
    expect(sessoes).toHaveLength(0);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.userId).toBeNull();
    expect(eventos[0]!.detail).toBe("precisa sobreviver");
  });

  it("apaga candidatura junto com a vaga — o motivo de a regra 3 existir", async () => {
    // Não é o comportamento desejado: é o comportamento que torna a regra
    // necessária. Deletar uma vaga leva embora a candidatura, que é o único
    // dado irrecuperável do sistema. Documentar isso em teste é o que impede
    // alguém de "limpar o acervo" achando que só mexe em ingestão.
    const declared = declaredForeignKeys();
    expect(
      declared.find((fk) => fk.table === "application" && fk.from.includes("job_id"))!.onDelete,
    ).toBe("CASCADE");

    const [dono] = await db
      .insert(schema.candidate)
      .values({ slug: "dono", name: "Dono", isDefault: true })
      .returning({ id: schema.candidate.id });
    await db
      .insert(schema.source)
      .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });
    const [vaga] = await db
      .insert(schema.job)
      .values({
        sourceId: "lever:acme",
        companyName: "Acme",
        externalId: "ext-1",
        title: "Arquiteto",
        url: "https://exemplo.test/1",
        fingerprint: "fp-1",
        contentHash: "ch-1",
        raw: "{}",
      })
      .returning({ id: schema.job.id });
    await db
      .insert(schema.application)
      .values({ candidateId: dono!.id, jobId: vaga!.id, status: "applied" });

    await db.execute(sql.raw(`delete from production.job where id = ${vaga!.id}`));

    await expect(db.select().from(schema.application)).resolves.toHaveLength(0);
  });
});
