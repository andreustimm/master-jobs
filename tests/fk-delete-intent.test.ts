/**
 * Suíte: toda FK do schema declara, por escrito, o que acontece no delete.
 *
 * Por que isto existe: a regra do projeto é "toda alteração em REFERENCES
 * declara a ação ON DELETE no schema e no DDL". `cov-db-schema.test.ts` prova
 * a segunda metade (paridade com `pg_constraint`), mas não a primeira: o
 * Drizzle completa com `no action` o que ninguém escreveu, e o banco grava o
 * mesmo. `job.company_id` ficou assim, sem política declarada, e nenhum teste
 * percebia — paridade perfeita entre dois padrões implícitos.
 *
 * Fronteira DENTRO: a declaração em `src/core/db/schema.ts`, observada durante
 * a construção das tabelas.
 * Fronteira FORA: o DDL aplicado, que é de `cov-db-schema.test.ts`.
 */
import { is } from "drizzle-orm";
import { foreignKey, getTableConfig, integer, pgSchema, PgTable } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import { hasExplicitDeleteIntent, installDeleteIntentProbe } from "./support/fk-intent.ts";

// A sonda precisa existir antes de o schema ser avaliado: FKs inline são
// construídas junto com a tabela. Nenhum import estático deste arquivo pode
// alcançar `schema.ts`.
const restore = installDeleteIntentProbe();
const schema = await import("../src/core/db/schema.ts");

afterAll(() => restore());

function undeclared(tables: unknown[]): string[] {
  const out: string[] = [];
  for (const table of tables) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    for (const fk of config.foreignKeys) {
      if (hasExplicitDeleteIntent(fk)) continue;
      const reference = fk.reference();
      out.push(`${config.name}.${reference.columns.map((c) => c.name).join(",")}`);
    }
  }
  return out.sort();
}

describe("intenção de delete nas chaves estrangeiras", () => {
  it("toda FK do schema escreve onDelete, inclusive quando a escolha é no action", () => {
    const tables = Object.values(schema as Record<string, unknown>);
    const total = tables
      .filter((t): t is PgTable => is(t, PgTable))
      .reduce((n, t) => n + getTableConfig(t).foreignKeys.length, 0);

    // Sem este piso, uma sonda quebrada por atualização do Drizzle (nenhuma FK
    // construída, ou nenhuma tabela reconhecida) passaria com lista vazia.
    expect(total).toBeGreaterThan(30);
    expect(undeclared(tables)).toEqual([]);
  });

  it("reprova a FK inline e a FK composta que não declaram política", () => {
    // O caso adverso: as duas formas de declarar, sem `onDelete`, ao lado das
    // mesmas formas com a política escrita. `no action` explícito conta como
    // intenção — é a escolha, e não a ausência dela, que a regra exige.
    const probe = pgSchema("fk_probe");
    const parent = probe.table("parent", { id: integer("id").primaryKey(), other: integer("other") });
    const child = probe.table(
      "child",
      {
        silent: integer("silent").references(() => parent.id),
        emptyOptions: integer("empty_options").references(() => parent.id, {}),
        declared: integer("declared").references(() => parent.id, { onDelete: "no action" }),
        a: integer("a"),
        b: integer("b"),
      },
      (t) => [
        foreignKey({ columns: [t.a, t.b], foreignColumns: [parent.id, parent.other], name: "composite_silent" }),
        foreignKey({ columns: [t.b, t.a], foreignColumns: [parent.id, parent.other], name: "composite_declared" })
          .onDelete("cascade"),
      ],
    );

    expect(undeclared([parent, child])).toEqual(["child.a,b", "child.empty_options", "child.silent"]);
  });
});
