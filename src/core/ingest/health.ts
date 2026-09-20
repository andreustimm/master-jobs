/**
 * A saúde de cada fonte configurada, numa leitura só.
 *
 * Mora aqui porque quem escreve `source.lastStatus` é o sync, neste diretório.
 * A CLI (`jho sources list`) e a tela de operações do administrador leem disto,
 * e não cada uma da sua consulta: duplicar essa query é como as duas
 * superfícies começam a discordar sobre o que é "fonte quebrada".
 */
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

/** A configuração é a fonte da verdade; o banco é o que aconteceu com ela. */
export async function sourceHealth(): Promise<SourceHealth[]> {
  const configs = await loadSources();
  const rows = await getDb().select().from(source);
  const byId = new Map(rows.map((row) => [row.id, row]));

  return configs.map((config) => {
    const id = `${config.kind}:${config.handle}`;
    const row = byId.get(id);
    const status: SourceStatus = row?.lastStatus === "ok" ? "ok" : row?.lastStatus === "error" ? "error" : "never";
    return {
      id,
      kind: config.kind,
      handle: config.handle,
      label: config.label,
      status,
      lastSyncedAt: row?.lastSyncedAt ?? null,
      lastError: row?.lastError ?? null,
      lastJobCount: row?.lastJobCount ?? null,
    };
  });
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
