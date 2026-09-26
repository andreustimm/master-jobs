/**
 * The application aggregate's pure state machine.
 *
 * Persistence supplies the current state and timestamp. This module decides
 * whether the transition is legal and returns the state plus the one event
 * that must be committed with it. Replaying the current status is an explicit
 * no-op; the domain never knows about SQL or the wall clock.
 *
 * A correção é um evento novo, nunca uma edição (#316): voltar de estágio é uma
 * transição como outra, e desfazer grava um `status_change` compensatório que
 * aponta para o evento revertido. O histórico só cresce.
 */

/** Os estágios que a pessoa escolhe, na ordem do funil — não em ordem alfabética. */
export const FUNNEL_STATUSES = [
  "backlog",
  "shortlisted",
  "preparing",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
  "archived",
] as const;

/**
 * "Fora do funil": o estado de quem desfez o PRIMEIRO registro. A linha de
 * `application` fica — apagá-la levaria o histórico em cascata e tiraria a
 * vaga da proteção da retenção (G03) —, mas nenhuma contagem nem lista do funil
 * a enxerga, e a próxima movimentação recomeça como uma primeira observação.
 * Só o desfazer chega aqui; nenhuma escolha do seletor leva a ele.
 */
export const OUT_OF_FUNNEL = "untracked";

export const APPLICATION_STATUSES = [...FUNNEL_STATUSES, OUT_OF_FUNNEL] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];

/** Parse untyped CLI/FormData input at the boundary. */
export function parseApplicationStatus(value: string): ApplicationStatus {
  const status = APPLICATION_STATUSES.find((candidate) => candidate === value);
  if (!status) throw new Error(`Invalid application status: ${value}`);
  return status;
}

export type ApplicationState = {
  status: ApplicationStatus;
  appliedAt: string | null;
};

export type StatusChangeEvent = {
  kind: "status_change";
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  at: string;
};

export type ApplicationTransitionResult =
  | { ok: true; changed: false; state: ApplicationState }
  | { ok: true; changed: true; state: ApplicationState; event: StatusChangeEvent }
  | {
      ok: false;
      error: {
        code: "illegal_transition";
        from: ApplicationStatus;
        to: ApplicationStatus;
      };
    };

/** Os estágios de progresso, em ordem: "voltar" é ir para um índice menor. */
const PROGRESS: readonly ApplicationStatus[] = [
  "backlog",
  "shortlisted",
  "preparing",
  "applied",
  "screening",
  "interviewing",
  "offer",
];

const CLOSING: readonly ApplicationStatus[] = ["rejected", "withdrawn", "archived"];

/** Rejeição e desistência só existem depois de a candidatura sair. */
const FIRST_SENT = PROGRESS.indexOf("applied");

/**
 * Avançar é um passo de cada vez: pular estágio para a frente deixaria
 * `appliedAt` sem dono (quem pula de "A fazer" para "Em entrevista" aplicou
 * quando?). Por isso o grafo livre foi descartado na #316.
 */
const NEXT: Readonly<Partial<Record<ApplicationStatus, ApplicationStatus>>> = {
  backlog: "shortlisted",
  shortlisted: "preparing",
  preparing: "applied",
  applied: "screening",
  screening: "interviewing",
  interviewing: "offer",
};

export type TransitionDirection = "forward" | "back" | "close";

/**
 * Para onde uma transição vai, ou `null` quando ela não existe.
 *
 * - avançar: o próximo estágio de progresso;
 * - voltar: qualquer estágio de progresso anterior — e, de um estado de
 *   encerramento (Rejeitada, Retirada, Arquivada), qualquer estágio de
 *   progresso: é assim que eles reabrem;
 * - encerrar: arquivar de qualquer estágio de progresso; rejeitar e retirar só
 *   depois de a candidatura ter sido enviada.
 *
 * Voltar não mexe em `appliedAt`: o recuo corrige o estágio, não o fato de ter
 * aplicado. Só o desfazer da própria entrada em "Candidatura enviada" o limpa.
 */
export function transitionDirection(from: ApplicationStatus, to: ApplicationStatus): TransitionDirection | null {
  if (from === to || to === OUT_OF_FUNNEL || from === OUT_OF_FUNNEL) return null;
  const fromIndex = PROGRESS.indexOf(from);
  const toIndex = PROGRESS.indexOf(to);
  if (fromIndex === -1) {
    // De um encerramento só se sai reabrindo; trocar um encerramento por outro
    // não é correção de estágio, e a nota explica melhor do que a troca.
    return CLOSING.includes(from) && toIndex !== -1 ? "back" : null;
  }
  if (toIndex !== -1) {
    if (toIndex < fromIndex) return "back";
    return NEXT[from] === to ? "forward" : null;
  }
  if (to === "archived") return "close";
  if (CLOSING.includes(to) && fromIndex >= FIRST_SENT) return "close";
  return null;
}

/**
 * A first observation may start at any funnel stage: the user can register an
 * application that already exists outside this system. "Fora do funil" is a
 * first observation again — the row exists, the funnel does not see it, and
 * the event records no `from`, exactly like the original entry.
 */
export function transitionApplication(
  current: ApplicationState | null,
  next: ApplicationStatus,
  at: string,
): ApplicationTransitionResult {
  // Replayed commands are observations of the state already committed, not a
  // second transition. Keeping this a no-op prevents duplicate audit events.
  if (current?.status === next) {
    return { ok: true, changed: false, state: current };
  }

  const fresh = current === null || current.status === OUT_OF_FUNNEL;
  const legal = next !== OUT_OF_FUNNEL && (fresh || transitionDirection(current.status, next) !== null);
  if (!legal) {
    return {
      ok: false,
      error: { code: "illegal_transition", from: current?.status ?? OUT_OF_FUNNEL, to: next },
    };
  }

  const appliedAt = next === "applied" && current?.appliedAt == null
    ? at
    : current?.appliedAt ?? null;

  return {
    ok: true,
    changed: true,
    state: { status: next, appliedAt },
    event: {
      kind: "status_change",
      fromStatus: fresh ? null : current.status,
      toStatus: next,
      at,
    },
  };
}

export type TransitionGroups = {
  forward: readonly ApplicationStatus[];
  back: readonly ApplicationStatus[];
  close: readonly ApplicationStatus[];
};

/**
 * As opções do seletor, agrupadas como a pessoa pensa nelas: avançar, voltar,
 * encerrar — cada grupo na ordem do funil. Sem candidatura (ou fora do funil)
 * tudo é alcançável: o progresso fica em "avançar" e o encerramento em
 * "encerrar".
 *
 * Status gravado fora da lista não existe em teoria e existe na prática — a
 * coluna é `text` sem CHECK e o acervo veio de um snapshot legado. Esta função
 * roda ao renderizar a tela; ela devolve grupos vazios em vez de quebrar.
 */
export function transitionGroups(current: ApplicationStatus | null): TransitionGroups {
  if (current === null || current === OUT_OF_FUNNEL) {
    return { forward: PROGRESS, back: [], close: CLOSING };
  }
  const pick = (direction: TransitionDirection) =>
    FUNNEL_STATUSES.filter((to) => transitionDirection(current, to) === direction);
  return { forward: pick("forward"), back: pick("back"), close: pick("close") };
}

/**
 * Os status alcançáveis a partir do atual, o próprio incluído, na ordem do
 * funil. Derivado de `transitionDirection`: oferecer só o possível é a mesma
 * regra lida uma vez, e não uma segunda cópia dela que envelhece sozinha.
 */
export function allowedTransitions(current: ApplicationStatus | null): readonly ApplicationStatus[] {
  if (current === null || current === OUT_OF_FUNNEL) return FUNNEL_STATUSES;
  if (!(APPLICATION_STATUSES as readonly string[]).includes(current)) return [current];
  const groups = transitionGroups(current);
  const reachable = new Set<ApplicationStatus>([current, ...groups.forward, ...groups.back, ...groups.close]);
  return FUNNEL_STATUSES.filter((status) => reachable.has(status));
}

/**
 * Sugestão de e-mail só empurra para a frente ou encerra. Uma resposta velha
 * ("recebemos sua candidatura") aceita depois de a pessoa já estar em
 * entrevista regrediria o funil — e com as arestas de volta, o domínio
 * aceitaria. Fora do funil também recusa: a pessoa tirou a vaga dali.
 */
export function mailMayMove(current: ApplicationStatus, next: ApplicationStatus): boolean {
  if (current === OUT_OF_FUNNEL) return false;
  return transitionDirection(current, next) !== "back";
}

/* -------------------------------------------------------------------------- */
/* Desfazer                                                                    */
/* -------------------------------------------------------------------------- */

/** Um `status_change` já gravado, como o histórico o devolve. */
export type RecordedStatusChange = {
  id: number;
  at: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  /** Preenchido quando o próprio evento é um desfazer. */
  revertsEventId: number | null;
};

/**
 * A movimentação que "desfazer" reverteria agora, ou `null`.
 *
 * `events` vem do mais recente para o mais antigo. Desfazeres e eventos já
 * revertidos são pulados, então desfazer de novo recua mais um passo — uma
 * pilha, sem nunca editar o que foi gravado. O candidato só vale se levou ao
 * estado atual: se o `toStatus` dele não é o status gravado, a trilha tem um
 * buraco (dado legado, escrita fora do domínio) e desfazer ficaria adivinhando.
 */
export function undoableEvent(
  current: ApplicationState,
  events: readonly RecordedStatusChange[],
): RecordedStatusChange | null {
  const reverted = new Set(events.flatMap((event) => event.revertsEventId === null ? [] : [event.revertsEventId]));
  for (const event of events) {
    if (event.revertsEventId !== null || reverted.has(event.id)) continue;
    return event.toStatus === current.status ? event : null;
  }
  return null;
}

export type UndoEvent = StatusChangeEvent & { revertsEventId: number };

export type UndoResult =
  | { ok: true; state: ApplicationState; event: UndoEvent }
  | { ok: false; error: { code: "nothing_to_undo" } | { code: "stale" } };

/**
 * O desfazer como transição compensatória.
 *
 * `expectedEventId` é o que a tela mostrou como "última movimentação". Se outra
 * aba moveu a candidatura desde então, o alvo mudou e a resposta é `stale` —
 * desfazer outra coisa que não a que a pessoa viu seria pior que não desfazer.
 *
 * `appliedAt` só é limpo quando o evento revertido é a própria entrada em
 * "Candidatura enviada" — o carimbo nasce com o `at` desse evento. Recuos e
 * reentradas posteriores preservam a data real da candidatura.
 */
export function undoTransition(
  current: ApplicationState,
  events: readonly RecordedStatusChange[],
  expectedEventId: number,
  at: string,
): UndoResult {
  const target = undoableEvent(current, events);
  if (!target) return { ok: false, error: { code: "nothing_to_undo" } };
  if (target.id !== expectedEventId) return { ok: false, error: { code: "stale" } };

  const toStatus = target.fromStatus ?? OUT_OF_FUNNEL;
  const clearsApplied = target.toStatus === "applied" && current.appliedAt === target.at;
  return {
    ok: true,
    state: { status: toStatus, appliedAt: clearsApplied ? null : current.appliedAt },
    event: {
      kind: "status_change",
      fromStatus: current.status,
      toStatus,
      at,
      revertsEventId: target.id,
    },
  };
}

export class IllegalApplicationTransitionError extends Error {
  readonly code = "illegal_transition";
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;

  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`Illegal application transition: ${from} -> ${to}`);
    this.name = "IllegalApplicationTransitionError";
    this.from = from;
    this.to = to;
  }
}
