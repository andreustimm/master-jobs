import { ForeignKeyBuilder, type ForeignKey } from "drizzle-orm/pg-core";

/**
 * Sonda que registra se a política de exclusão de uma FK foi ESCRITA.
 *
 * O Drizzle preenche `onDelete` com `"no action"` quando nada é declarado, e o
 * PostgreSQL grava o mesmo `NO ACTION`. Comparar o objeto construído com
 * `pg_constraint` prova paridade, nunca intenção: uma FK esquecida e uma FK
 * deliberadamente `no action` são indistinguíveis depois de construídas.
 *
 * As duas formas de declarar passam pelo mesmo método: `.references(ref,
 * { onDelete })` só chama `ForeignKeyBuilder.onDelete` quando a opção veio, e
 * `foreignKey({...}).onDelete(...)` chama diretamente. A sonda marca o builder
 * nesse método e copia a marca para a FK em `build`. Ela precisa estar
 * instalada ANTES de o módulo do schema ser avaliado — as FKs inline são
 * construídas junto com a tabela —, por isso o schema é importado
 * dinamicamente depois de `installDeleteIntentProbe()`.
 *
 * Depende de dois métodos internos do Drizzle. Se uma atualização os renomear,
 * `hasExplicitDeleteIntent` passa a devolver `false` para tudo e a suíte
 * reprova em vez de aprovar em silêncio.
 */
const EXPLICIT = Symbol("explicitOnDelete");

type Marked = { [EXPLICIT]?: boolean };
type BuilderProto = {
  onDelete(this: Marked, action: unknown): unknown;
  build(this: Marked, table: unknown): ForeignKey & Marked;
};

export function installDeleteIntentProbe(): () => void {
  const proto = ForeignKeyBuilder.prototype as unknown as BuilderProto;
  const originalOnDelete = proto.onDelete;
  const originalBuild = proto.build;
  proto.onDelete = function (this: Marked, action: unknown) {
    if (action !== undefined) this[EXPLICIT] = true;
    return originalOnDelete.call(this, action);
  };
  proto.build = function (this: Marked, table: unknown) {
    const built = originalBuild.call(this, table);
    built[EXPLICIT] = this[EXPLICIT] === true;
    return built;
  };
  return () => {
    proto.onDelete = originalOnDelete;
    proto.build = originalBuild;
  };
}

export function hasExplicitDeleteIntent(fk: ForeignKey): boolean {
  return (fk as ForeignKey & Marked)[EXPLICIT] === true;
}

export type ForeignKeyShape = {
  table: string;
  from: string[];
  to: string;
  toColumns: string[];
  onDelete: string;
};

/**
 * Diferença entre o que o schema declara e o que o banco aplica, nos dois
 * sentidos. Vazia quando concordam em tabela, colunas, alvo e ação de delete.
 */
export function foreignKeyParityDiff(
  declared: ForeignKeyShape[],
  applied: ForeignKeyShape[],
): { missingInDatabase: string[]; notDeclared: string[] } {
  const key = (fk: ForeignKeyShape) =>
    `${fk.table}(${fk.from.join(",")}) -> ${fk.to}(${fk.toColumns.join(",")}) ON DELETE ${fk.onDelete.toUpperCase()}`;
  const inDatabase = new Set(applied.map(key));
  const inSchema = new Set(declared.map(key));
  return {
    missingInDatabase: [...inSchema].filter((k) => !inDatabase.has(k)).sort(),
    notDeclared: [...inDatabase].filter((k) => !inSchema.has(k)).sort(),
  };
}
