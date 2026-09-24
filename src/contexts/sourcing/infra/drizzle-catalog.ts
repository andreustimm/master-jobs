/**
 * O catálogo de fontes em PostgreSQL. Adapter burro: lê, grava, mapeia. As
 * regras — quem é gerido, quem é órfão, o que é válido — vêm prontas do
 * domínio (`../domain/catalog.ts`).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { source } from "../../../core/db/schema.ts";
import { FETCHABLE_SOURCE_KINDS, type SourceConfig } from "../../../core/sources/types.ts";
import { catalogId, type CatalogPlan, type CatalogRow, type CatalogWrite } from "../domain/catalog.ts";

export type CatalogSource = CatalogRow & {
  origin: string | null;
  configRevision: number | null;
  secretRef: string | null;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastJobCount: number | null;
  createdAt: string;
};

const columns = {
  id: source.id,
  kind: source.kind,
  handle: source.handle,
  label: source.label,
  rationale: source.rationale,
  enabled: source.enabled,
  retiredAt: source.retiredAt,
  managedAt: source.managedAt,
  origin: source.origin,
  configRevision: source.configRevision,
  secretRef: source.secretRef,
  lastSyncedAt: source.lastSyncedAt,
  lastStatus: source.lastStatus,
  lastError: source.lastError,
  lastJobCount: source.lastJobCount,
  createdAt: source.createdAt,
};

/** Só as linhas do catálogo de sync: com adapter e fora da captura por termo. */
const catalogOnly = and(
  inArray(source.kind, [...FETCHABLE_SOURCE_KINDS]),
  sql`left(${source.handle}, 1) <> '~'`,
);

export async function catalogSources(): Promise<CatalogSource[]> {
  return getDb().select(columns).from(source).where(catalogOnly).orderBy(asc(source.id));
}

export async function catalogSource(id: string): Promise<CatalogSource | null> {
  const [row] = await getDb().select(columns).from(source).where(and(eq(source.id, id), catalogOnly));
  return row ?? null;
}

/** Toda linha, com o mínimo que o plano de importação lê. */
export async function allCatalogRows(): Promise<CatalogRow[]> {
  return getDb()
    .select({
      id: source.id,
      kind: source.kind,
      handle: source.handle,
      label: source.label,
      rationale: source.rationale,
      enabled: source.enabled,
      retiredAt: source.retiredAt,
      managedAt: source.managedAt,
    })
    .from(source);
}

/**
 * O que o sync varre, do banco: habilitada, não aposentada, kind com adapter e
 * handle fora de `~terms`. O filtro por kind deixa de fora `manual:sample` da
 * fixture e a fonte `manual` da importação; o de handle, as fontes da captura
 * por termo, que sincronizadas fechariam por ausência o que o termo trouxe.
 * Mesma regra de `isSyncEligible`.
 */
export async function syncableSources(): Promise<SourceConfig[]> {
  const rows = await getDb()
    .select({ kind: source.kind, handle: source.handle, label: source.label, rationale: source.rationale })
    .from(source)
    .where(and(eq(source.enabled, true), isNull(source.retiredAt), catalogOnly))
    .orderBy(asc(source.id));
  return rows.map((row) => ({
    kind: row.kind as SourceConfig["kind"],
    handle: row.handle,
    label: row.label,
    ...(row.rationale === null ? {} : { rationale: row.rationale }),
  }));
}

/**
 * `jho sources import --apply`: grava o estado do YAML e passa TODA linha do
 * catálogo para o regime gerido, numa transação. Linha já gerida não é
 * regravada — importar de novo depois de uma edição na tela não desfaz a
 * edição; a divergência continua visível no `diff`.
 */
export async function applyCatalogImport(plan: CatalogPlan, now: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    for (const entry of plan.inserts) {
      await tx
        .insert(source)
        .values({
          id: catalogId(entry.kind, entry.handle),
          kind: entry.kind,
          handle: entry.handle,
          label: entry.label,
          rationale: entry.rationale ?? null,
          enabled: entry.enabled ?? true,
          origin: "yaml",
          managedAt: now,
        })
        .onConflictDoNothing({ target: source.id });
    }
    for (const entry of plan.mirrors) {
      await tx
        .update(source)
        .set({
          label: entry.label,
          rationale: entry.rationale ?? null,
          enabled: entry.enabled ?? true,
          configRevision: sql`${source.configRevision} + 1`,
        })
        .where(and(eq(source.id, catalogId(entry.kind, entry.handle)), isNull(source.managedAt)));
    }
    if (plan.orphans.length > 0) {
      await tx
        .update(source)
        .set({ enabled: false, configRevision: sql`${source.configRevision} + 1` })
        .where(and(inArray(source.id, plan.orphans), isNull(source.managedAt)));
    }
    await tx.update(source).set({ managedAt: now }).where(and(isNull(source.managedAt), catalogOnly));
  });
}

/** Cadastro pela tela. A unicidade final é do índice `source_kind_handle_idx`. */
export async function insertCatalogSource(write: CatalogWrite, now: string): Promise<{ ok: true; id: string } | { ok: false }> {
  const id = catalogId(write.kind, write.handle);
  const rows = await getDb()
    .insert(source)
    .values({
      id,
      kind: write.kind,
      handle: write.handle,
      label: write.label,
      enabled: write.enabled,
      secretRef: write.secretRef,
      origin: "admin",
      managedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: source.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false };
}

export type CatalogPatch = Partial<Pick<CatalogWrite, "label" | "enabled" | "secretRef">>;

/**
 * Toda escrita do admin carimba `managed_at` e sobe a revisão. Aposentada não
 * é editada: devolve `false`, e quem chama explica.
 */
export async function patchCatalogSource(id: string, patch: CatalogPatch, now: string): Promise<boolean> {
  const rows = await getDb()
    .update(source)
    .set({ ...patch, managedAt: now, configRevision: sql`${source.configRevision} + 1` })
    .where(and(eq(source.id, id), isNull(source.retiredAt), catalogOnly))
    .returning({ id: source.id });
  return rows.length === 1;
}

/** Aposentar desabilita junto; vagas e histórico ficam, porque a linha fica. */
export async function retireCatalogSource(id: string, now: string): Promise<boolean> {
  const rows = await getDb()
    .update(source)
    .set({ retiredAt: now, enabled: false, managedAt: now, configRevision: sql`${source.configRevision} + 1` })
    .where(and(eq(source.id, id), isNull(source.retiredAt), catalogOnly))
    .returning({ id: source.id });
  return rows.length === 1;
}
