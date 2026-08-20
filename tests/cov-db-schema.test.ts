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
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import * as schema from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

type DeclaredFk = {
  table: string;
  from: string[];
  to: string;
  toColumns: string[];
  onDelete: string;
};

/** Toda tabela exportada pelo schema, na ordem em que o módulo as declara. */
function allTables(): SQLiteTable[] {
  // `unknown[]` antes de filtrar: o módulo exporta tabelas E tuplas de
  // constantes (`ROLES`, `APPLICATION_STATUSES`…), então `Object.values` produz
  // uma união em que o predicado de tipo não é atribuível ao parâmetro. O
  // estreitamento continua sendo feito por `is()`, em tempo de execução.
  const exported: unknown[] = Object.values(schema);
  return exported.filter((value): value is SQLiteTable => is(value, SQLiteTable));
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
        // SQLite grava "NO ACTION" quando nada foi declarado.
        onDelete: (fk.onDelete ?? "no action").toUpperCase(),
      });
    }
  }
  return out;
}

/**
 * Divergências já conhecidas entre a declaração e o DDL aplicado.
 *
 * Cada entrada é um bug registrado, não uma exceção permitida: a lista existe
 * para o caso acima continuar guardando as outras 27 chaves em vez de ficar
 * vermelho o tempo todo e ser desligado. Entrada nova aqui exige nota no
 * relatório.
 */
/**
 * Chaves cuja aplicação diverge do que o schema declara.
 *
 * **Vazia, e o objetivo é que continue.** Teve duas: a migração 0021 acrescentou
 * `job.posted_by_user_id` e `auth_session.impersonated_by` com
 * `ALTER TABLE ... ADD ... REFERENCES` sem cláusula `ON DELETE`, e o SQLite
 * assume `NO ACTION` em silêncio. O efeito ficou invertido nos dois casos —
 * apagar a conta de um recrutador passava a ser recusado pelo banco em vez de a
 * vaga esquecer quem a cadastrou. A 0025 reconstruiu as duas tabelas.
 *
 * Uma entrada nova aqui é dívida consciente, não conveniência: significa que o
 * banco não faz o que o código diz que ele faz.
 */
const DIVERGENCIAS_CONHECIDAS = new Set<string>([]);

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
    const declared = declaredForeignKeys();
    const aplicadas = new Set<string>();

    for (const table of new Set(declared.map((fk) => fk.table))) {
      const rows = await db.all<{
        table: string;
        from: string;
        to: string | null;
        on_delete: string;
      }>(sql.raw(`pragma foreign_key_list("${table}")`));
      for (const row of rows) {
        aplicadas.add(`${table}.${row.from}->${row.table}.${row.to ?? "id"}:${row.on_delete}`);
      }
    }

    for (const fk of declared) {
      for (const [i, coluna] of fk.from.entries()) {
        const chave = `${fk.table}.${coluna}`;
        if (DIVERGENCIAS_CONHECIDAS.has(chave)) continue;
        expect(
          aplicadas,
          `${chave} deveria referenciar ${fk.to}.${fk.toColumns[i]} com ${fk.onDelete}`,
        ).toContain(`${chave}->${fk.to}.${fk.toColumns[i]}:${fk.onDelete}`);
      }
    }
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

    await db.run(sql.raw(`delete from auth_user where id = ${user!.id}`));

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

    await db.run(sql.raw(`delete from job where id = ${vaga!.id}`));

    await expect(db.select().from(schema.application)).resolves.toHaveLength(0);
  });
});
