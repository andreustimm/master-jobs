/**
 * Tirar do quadro ativo o que a fonte já fechou faz tempo — sem apagar nada.
 *
 * O caso de uso é burro de propósito: ele seleciona, pergunta a `lifecycle.ts`
 * o que fazer com cada linha, e escreve. Toda regra que decide mora lá, pura.
 *
 * Duas coisas que esta rotina NÃO faz, e que a distinguem do `db cleanup`:
 *
 *   - não apaga linha. `archived_at` é reversível; `prune` não é, e por isso
 *     continua exigindo que a vaga não tenha candidatura nenhuma;
 *   - não toca em `application` nem em `application_event`. Arquivar é sobre a
 *     vaga; o estágio do funil é decisão do usuário e é o único dado
 *     irrecuperável do sistema (ADR 0020).
 *
 * Também não é ingestão: não abre rede, não gasta cota, não resolve adapter.
 * Por isso não chama o guarda da ADR 0021 — ela roda onde a ingestão nega.
 */

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { application, job, source } from "../db/schema.ts";
import type { SourceKind } from "../sources/types.ts";
import {
  archiveCutoff,
  decideArchive,
  type ArchiveKeepReason,
} from "./lifecycle.ts";
import type { ProbeVerdict } from "./probe.ts";

/**
 * Mesmo número do `prune` hoje, e ainda assim outra política: prune apaga e
 * exige ausência de candidatura; arquivar esconde e é desfeito por um `alive`.
 * Amarrar as duas constantes faria uma mudar quando só a outra foi decidida.
 */
export const DEFAULT_ARCHIVE_CLOSED_DAYS = 90;

/** Teto por execução: a varredura é paginada para não carregar o acervo todo. */
export const DEFAULT_ARCHIVE_LIMIT = 500;

export type ArchiveOptions = {
  /** Falso é inventário. Mutação exige `true` explícito. */
  apply?: boolean;
  closedDays?: number;
  limit?: number;
  /** Injetado nos testes para que o corte não dependa do dia. */
  now?: Date;
};

export type ArchiveReport = {
  policy: { closedDays: number; limit: number; cutoff: string };
  scanned: number;
  eligible: number;
  /** Quantas das elegíveis carregam candidatura — preservadas, nunca podadas. */
  preservedByApplication: number;
  kept: Record<ArchiveKeepReason, number>;
  /** Escrita só acontece com `apply`. `archived` conta linhas realmente mudadas. */
  applied: null | { archived: number; claimedByAnotherRun: number };
  /** Há mais elegíveis além do teto desta execução. */
  hasMore: boolean;
};

function wholeNonNegative(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} precisa ser um inteiro maior ou igual a zero.`);
  }
  return value;
}

function emptyKept(): Record<ArchiveKeepReason, number> {
  return {
    open: 0,
    "recent-closure": 0,
    "manual-source": 0,
    "inconclusive-probe": 0,
    "reopen-pending": 0,
  };
}

/**
 * Inventaria e, só com `apply`, arquiva.
 *
 * A seleção já exclui o que nunca seria elegível — vaga aberta e vaga
 * arquivada —, mas a DECISÃO continua vindo da função pura linha a linha: é
 * ela que sabe que fonte manual fica fora e que sondagem inconclusiva não
 * prova ausência. Filtro de SQL é otimização; regra é domínio.
 */
export async function archiveClosedJobs(options: ArchiveOptions = {}): Promise<ArchiveReport> {
  const closedDays = options.closedDays ?? DEFAULT_ARCHIVE_CLOSED_DAYS;
  const limit = wholeNonNegative(options.limit ?? DEFAULT_ARCHIVE_LIMIT, "limit");
  const now = options.now ?? new Date();
  // Valida o corte: recusa antes de abrir conexão, nunca a meio caminho.
  const cutoff = archiveCutoff(now, closedDays);
  const db = getDb();

  // Uma linha a mais que o teto: é como a execução sabe que sobrou trabalho
  // sem uma segunda contagem sobre o acervo inteiro.
  const rows = await db
    .select({
      id: job.id,
      closedAt: job.closedAt,
      archivedAt: job.archivedAt,
      checkStatus: job.checkStatus,
      sourceKind: source.kind,
      hasApplication: sql<boolean>`exists (
        select 1 from ${application} a where a.job_id = ${job.id}
      )`,
    })
    .from(job)
    .innerJoin(source, eq(source.id, job.sourceId))
    .where(and(isNotNull(job.closedAt), isNull(job.archivedAt)))
    // Ordem estável: paginar duas vezes o mesmo acervo devolve os mesmos totais.
    .orderBy(asc(job.closedAt), asc(job.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const kept = emptyKept();
  const eligibleIds: number[] = [];
  let preservedByApplication = 0;

  for (const row of page) {
    const decision = decideArchive({
      closedAt: row.closedAt,
      archivedAt: row.archivedAt,
      hasApplication: row.hasApplication,
      cutoff,
      // `source.kind` e `check_status` são texto no banco: valor fora do union
      // cai nas regras de "não sei", que é o comportamento seguro.
      sourceKind: row.sourceKind as SourceKind,
      checkStatus: row.checkStatus as ProbeVerdict | null,
    });
    if (decision.kind === "keep") {
      kept[decision.reason] += 1;
      continue;
    }
    // `noop` só aparece em corrida: o filtro já excluiu o que está arquivado.
    if (decision.kind === "noop") continue;
    eligibleIds.push(row.id);
    if (decision.preservesApplication) preservedByApplication += 1;
  }

  const inventory = {
    policy: { closedDays, limit, cutoff },
    scanned: page.length,
    eligible: eligibleIds.length,
    preservedByApplication,
    kept,
    hasMore,
  };

  if (!options.apply) return { ...inventory, applied: null };
  if (eligibleIds.length === 0) {
    return { ...inventory, applied: { archived: 0, claimedByAnotherRun: 0 } };
  }

  const archivedAt = now.toISOString();
  const updated = await db.transaction(async (tx) =>
    tx
      .update(job)
      .set({ archivedAt })
      // `archived_at is null` de novo, e não por descuido: entre a leitura e a
      // escrita cabe outra execução, e quem garante que a linha só é reclamada
      // uma vez é o predicado, não a janela de tempo.
      .where(and(inArray(job.id, eligibleIds), isNull(job.archivedAt)))
      .returning({ id: job.id }),
  );

  return {
    ...inventory,
    applied: {
      archived: updated.length,
      claimedByAnotherRun: eligibleIds.length - updated.length,
    },
  };
}
