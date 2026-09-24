/**
 * Decidir quando uma vaga sai do quadro sem sair do banco.
 *
 * `closed_at` é fato da fonte: o anúncio sumiu de onde ele morava. `archived_at`
 * é decisão de apresentação: depois de tanto tempo fechada, a vaga deixa de
 * ocupar o quadro ativo. Misturar os dois foi rejeitado na ADR-001 desta
 * feature porque um é observação e o outro é política — e política muda sem que
 * a observação mude.
 *
 * Nada aqui apaga. `jho db prune` continua sendo a operação que remove linha, e
 * ela é mais conservadora justamente porque é irreversível; arquivar é
 * reversível, e é por isso que pode ser automático.
 *
 * A regra é pura e mora ao lado de `probe.ts` pelo mesmo motivo que ela: é
 * capaz de esconder uma vaga boa por engano, e precisa ser exercitável sem
 * banco, sem rede e sem relógio. O corte entra como parâmetro; quem lê o
 * calendário é o caso de uso.
 */

import { MANUAL_SOURCE_KINDS, type Completeness, type SourceKind } from "../sources/types.ts";
import type { ProbeVerdict } from "./probe.ts";

export type AbsenceDecision =
  | { kind: "close-missing" }
  | { kind: "keep"; reason: "partial-window" | "empty-listing" };

/**
 * Pode a sincronização fechar o que a fonte deixou de listar?
 *
 * Só quando a listagem é a fonte inteira. Uma janela parcial — as 50 mais
 * recentes, as primeiras páginas — não diz nada sobre o que ficou fora dela, e
 * fechar ali escondia vagas vivas a cada rodada; essas só fecham por 404/410
 * na reconferência. Lista vazia é ambígua até numa fonte completa: "a empresa
 * não tem vaga" e "a API mudou o formato" chegam iguais, e a segunda fecharia o
 * acervo inteiro da fonte.
 */
export function decideAbsenceClosure(input: { completeness: Completeness; seen: number }): AbsenceDecision {
  if (input.seen === 0) return { kind: "keep", reason: "empty-listing" };
  if (input.completeness !== "complete") return { kind: "keep", reason: "partial-window" };
  return { kind: "close-missing" };
}

/**
 * Por que uma vaga fechada continua no quadro.
 *
 * Cada razão existe para aparecer em contador de operação: "não arquivou nada"
 * sem motivo é indistinguível de "a rotina não rodou".
 */
export type ArchiveKeepReason =
  | "open"
  | "recent-closure"
  | "manual-source"
  | "inconclusive-probe"
  | "reopen-pending";

export type ArchiveDecision =
  | { kind: "archive"; reason: "closed-retention"; preservesApplication: boolean }
  | { kind: "keep"; reason: ArchiveKeepReason }
  | { kind: "noop"; reason: "already-archived" };

export type ArchiveInput = {
  closedAt: string | null;
  archivedAt: string | null;
  /** Só informa o resultado: candidatura nunca impede arquivar (AC-2, ADR 0020). */
  hasApplication: boolean;
  /** Instante ISO: fechamento igual ou anterior a ele é velho o bastante. */
  cutoff: string;
  sourceKind: SourceKind;
  /** Último veredito de sondagem. `null` = nunca sondada. */
  checkStatus: ProbeVerdict | null;
  /**
   * Quando esse veredito saiu. Veredito anterior ao fechamento não diz nada
   * sobre ele: o sync fecha por ausência sem sondar, e um `alive` de antes
   * seguraria a vaga para sempre. `null` (linha legada) conta, por cautela.
   */
  checkedAt: string | null;
};

const MANUAL: ReadonlySet<string> = new Set(MANUAL_SOURCE_KINDS);

/**
 * Decide o destino de UMA vaga. Ordem das perguntas importa:
 *
 * 1. já arquivada não é trabalho — e reexecutar precisa ser barato;
 * 2. fonte manual não tem varredura que prove ausência, então "fechada" ali é
 *    digitação de alguém, não observação repetida;
 * 3. aberta fica;
 * 4. sondagem inconclusiva não prova ausência (mesma disciplina de `probe.ts`),
 *    e `alive` depois de fechada é reconciliação pendente, não vaga velha —
 *    só a sondagem feita no fechamento ou depois dele conta;
 * 5. fechamento recente fica — o corte é a política inteira.
 */
export function decideArchive(input: ArchiveInput): ArchiveDecision {
  if (input.archivedAt) return { kind: "noop", reason: "already-archived" };
  if (MANUAL.has(input.sourceKind)) return { kind: "keep", reason: "manual-source" };
  if (!input.closedAt) return { kind: "keep", reason: "open" };
  const probed = input.checkedAt === null || input.checkedAt >= input.closedAt ? input.checkStatus : null;
  if (probed === "inconclusive") {
    return { kind: "keep", reason: "inconclusive-probe" };
  }
  if (probed === "alive") return { kind: "keep", reason: "reopen-pending" };
  if (input.closedAt > input.cutoff) return { kind: "keep", reason: "recent-closure" };
  return {
    kind: "archive",
    reason: "closed-retention",
    preservesApplication: input.hasApplication,
  };
}

export type ReopenDecision =
  | { kind: "reopen"; clearsArchive: boolean }
  | { kind: "noop"; reason: "not-alive" | "nothing-to-reopen" };

export type ReopenInput = {
  verdict: ProbeVerdict;
  closedAt: string | null;
  archivedAt: string | null;
};

/**
 * Um `alive` posterior desfaz o arquivamento automático.
 *
 * Sem isto, um 404 transitório sumiria com a vaga para sempre — a mesma razão
 * pela qual `alive` já reabre um fechamento. Reabrir é escrita em `job`, e só
 * em `job`: a candidatura que existia continua exatamente onde estava, com o
 * estágio que o usuário decidiu.
 */
export function decideReopen(input: ReopenInput): ReopenDecision {
  if (input.verdict !== "alive") return { kind: "noop", reason: "not-alive" };
  if (!input.closedAt && !input.archivedAt) {
    return { kind: "noop", reason: "nothing-to-reopen" };
  }
  return { kind: "reopen", clearsArchive: input.archivedAt !== null };
}

/**
 * Em que estado a vaga está, do ponto de vista de quem olha uma candidatura.
 *
 * São três, e a ordem importa: arquivada é fechada há tempo, então o rótulo
 * mais específico vence. Isto é estado da VAGA e nunca se confunde com o
 * estágio da candidatura — a vaga fecha sozinha, o estágio só muda por decisão
 * do usuário (ADR 0020).
 */
export type JobLifecycleState = "active" | "closed" | "archived";

export function jobLifecycleState(input: {
  closedAt: string | null;
  archivedAt: string | null;
}): JobLifecycleState {
  if (input.archivedAt) return "archived";
  if (input.closedAt) return "closed";
  return "active";
}

/** Instante ISO a partir do qual um fechamento é velho o bastante para arquivar. */
export function archiveCutoff(now: Date, days: number): string {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error("closedDays precisa ser um inteiro maior ou igual a zero.");
  }
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
