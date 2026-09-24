/**
 * A saúde de cada fonte configurada, numa leitura só.
 *
 * Mora aqui porque quem escreve `source.lastStatus` é o sync, neste diretório.
 * A CLI (`jho sources list`) e a tela de operações do administrador leem disto,
 * e não cada uma da sua consulta: duplicar essa query é como as duas
 * superfícies começam a discordar sobre o que é "fonte quebrada".
 */
import { isSyncEligible } from "../../contexts/sourcing/domain/catalog.ts";
import { getDb } from "../db/client.ts";
import { source } from "../db/schema.ts";
import { loadSources } from "../sources/config.ts";

export type SourceStatus = "ok" | "error" | "never";

export type SourceHealth = {
  id: string;
  kind: string;
  handle: string;
  label: string;
  status: SourceStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastJobCount: number | null;
};

export type SourceHealthSummary = {
  total: number;
  ok: number;
  error: number;
  never: number;
  /** A varredura mais recente entre todas as fontes, que é a idade do acervo. */
  lastSyncedAt: string | null;
  /** Só as quebradas, para a tela não precisar filtrar de novo. */
  broken: SourceHealth[];
};

type SourceRow = typeof source.$inferSelect;

function statusOf(row: SourceRow | undefined): SourceStatus {
  return row?.lastStatus === "ok" ? "ok" : row?.lastStatus === "error" ? "error" : "never";
}

function health(id: string, kind: string, handle: string, label: string, row: SourceRow | undefined): SourceHealth {
  return {
    id,
    kind,
    handle,
    label,
    status: statusOf(row),
    lastSyncedAt: row?.lastSyncedAt ?? null,
    lastError: row?.lastError ?? null,
    lastJobCount: row?.lastJobCount ?? null,
  };
}

/**
 * Saúde é do que o sync varre, no mesmo regime por linha que ele usa (#223):
 *
 * - linha NÃO gerida (ou ainda inexistente) segue o arquivo: entrada habilitada
 *   no YAML aparece, e a que nunca sincronizou aparece como `never`;
 * - linha GERIDA segue o banco: aparece se o sync a seleciona
 *   (`isSyncEligible`), com o rótulo do banco, esteja ou não no arquivo.
 *
 * Sem isso, depois de `jho sources import --apply` a lista mostraria fonte que
 * ninguém sincroniza e esconderia a que o sync ainda varre e está quebrada.
 */
export async function sourceHealth(): Promise<SourceHealth[]> {
  const configs = await loadSources();
  const rows = await getDb().select().from(source);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const listed = new Set<string>();
  const result: SourceHealth[] = [];

  for (const config of configs) {
    const id = `${config.kind}:${config.handle}`;
    const row = byId.get(id);
    if (row?.managedAt != null || !config.enabled || listed.has(id)) continue;
    listed.add(id);
    result.push(health(id, config.kind, config.handle, config.label, row));
  }
  for (const row of rows) {
    if (row.managedAt == null || listed.has(row.id) || !isSyncEligible(row)) continue;
    listed.add(row.id);
    result.push(health(row.id, row.kind, row.handle, row.label, row));
  }
  return result;
}

export async function sourceHealthSummary(): Promise<SourceHealthSummary> {
  const sources = await sourceHealth();
  const counted = { ok: 0, error: 0, never: 0 };
  let lastSyncedAt: string | null = null;
  for (const entry of sources) {
    counted[entry.status] += 1;
    // Comparação de texto ISO é comparação de instante, e evita construir Date
    // por linha só para achar o máximo.
    if (entry.lastSyncedAt && (lastSyncedAt === null || entry.lastSyncedAt > lastSyncedAt)) {
      lastSyncedAt = entry.lastSyncedAt;
    }
  }
  return {
    total: sources.length,
    ...counted,
    lastSyncedAt,
    broken: sources.filter((entry) => entry.status === "error"),
  };
}
