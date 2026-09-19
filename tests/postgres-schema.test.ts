import { readFileSync } from "node:fs";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig as pgConfig } from "drizzle-orm/pg-core";
import { SQLiteTable, getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  policies,
  postSnapshotColumns,
  postSnapshotTables,
} from "../scripts/migration/select-production.ts";
import * as source from "../scripts/migration/schema.sqlite.ts";
import * as target from "../src/core/db/schema.ts";

const sqliteTables = Object.values(source).filter((v) => is(v, SQLiteTable));
const pgTables = Object.values(target).filter((v) => is(v, PgTable));

describe("PostgreSQL migration contract", () => {
  it("preserves all tables, column names, nullability and foreign-key ownership", () => {
    // Tabela posterior ao snapshot é revisada uma a uma na lista da importação.
    expect(pgTables.map((t) => pgConfig(t).name).filter((name) => !postSnapshotTables.has(name)).sort()).toEqual(
      sqliteTables.map((t) => sqliteConfig(t).name).sort(),
    );
    for (const table of sqliteTables) {
      const before = sqliteConfig(table);
      const after = pgConfig(pgTables.find((t) => pgConfig(t).name === before.name)!);
      expect(after.schema).toBe("production");
      // O contrato é "nada do snapshot se perde", não "o alvo parou no tempo".
      // Coluna que o alvo ganhou depois entra na mesma lista revisada que a
      // importação usa para declarar o valor que escreve — sem declaração, a
      // diferença continua reprovando aqui.
      const added = postSnapshotColumns[before.name] ?? {};
      expect(
        after.columns.filter((c) => !(c.name in added)).map((c) => [c.name, c.notNull, c.primary]),
      ).toEqual(before.columns.map((c) => [c.name, c.notNull, c.primary]));
      // Coluna nova é opcional quando a tabela atravessa a importação: o snapshot
      // não tem valor para ela. Tabela excluída (derivada, recalculada no alvo)
      // não leva linha nenhuma, então pode exigir a coluna — é o caso de
      // `job_score.track_id`, que faz parte da chave (ADR-008).
      const transferred = !policies[before.name]!.startsWith("exclude-");
      for (const column of after.columns.filter((c) => c.name in added)) {
        expect([column.name, column.primary]).toEqual([column.name, false]);
        if (transferred) expect(column.notNull, `${before.name}.${column.name}`).toBe(false);
      }
      expect(after.foreignKeys.filter((fk) => !fk.reference().columns.every((c) => c.name in added)).map((fk) => {
        const ref = fk.reference();
        return [ref.columns.map((c) => c.name), pgConfig(ref.foreignTable).name,
          ref.foreignColumns.map((c) => c.name), fk.onDelete ?? "no action"];
      })).toEqual(before.foreignKeys.map((fk) => {
        const ref = fk.reference();
        return [ref.columns.map((c) => c.name), sqliteConfig(ref.foreignTable).name,
          ref.foreignColumns.map((c) => c.name), fk.onDelete ?? "no action"];
      }));
    }
  });

  it("defines the document ownership key before referencing it", () => {
    const config = pgConfig(target.candidateDocument);
    expect(config.uniqueConstraints.some((key) =>
      key.columns.map((c) => c.name).join(",") === "id,candidate_id",
    )).toBe(true);
    const ddl = readFileSync("drizzle/postgres/0000_production_baseline.sql", "utf8");
    expect(ddl.indexOf('CREATE SCHEMA "production"')).toBeLessThan(ddl.indexOf("CREATE TABLE"));
    expect(ddl.indexOf('CONSTRAINT "candidate_document_identity_idx" UNIQUE')).toBeLessThan(
      ddl.indexOf('ADD CONSTRAINT "application_candidate_document_fk"'),
    );
    expect(ddl).toContain('"is_current" = true');
    expect(ddl).not.toMatch(/strftime|PRAGMA|AUTOINCREMENT/);
  });
});
