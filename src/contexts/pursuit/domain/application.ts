/**
 * The application aggregate's pure state machine.
 *
 * Persistence supplies the current state and timestamp. This module decides
 * whether the transition is legal and returns the state plus the one event
 * that must be committed with it. Replaying the current status is an explicit
 * no-op; the domain never knows about SQL or the wall clock.
 */

export const APPLICATION_STATUSES = [
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

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

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

const LEGAL_TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  backlog: ["shortlisted", "archived"],
  shortlisted: ["preparing", "archived"],
  preparing: ["applied"],
  applied: ["screening", "rejected", "withdrawn", "archived"],
  screening: ["interviewing", "rejected", "withdrawn"],
  interviewing: ["offer", "rejected", "withdrawn"],
  offer: ["withdrawn", "archived"],
  rejected: [],
  withdrawn: [],
  archived: ["backlog"],
};

/**
 * "Não me interessa" arquiva sem aplicar, e um clique errado não pode ser
 * definitivo: `archived → backlog` devolve a vaga às listas. Só para quem nunca
 * aplicou — a candidatura enviada e depois arquivada é história, e voltar com
 * ela para o começo do funil apagaria a ordem dos fatos.
 */
function isLegal(current: ApplicationState, next: ApplicationStatus): boolean {
  if (!LEGAL_TRANSITIONS[current.status]?.includes(next)) return false;
  return !(current.status === "archived" && current.appliedAt !== null);
}

/**
 * A first observation may start at any known stage: the user can register an
 * application that already exists outside this system. Once persisted, every
 * subsequent move follows the explicit funnel and terminal states stay final —
 * except an archive that never applied, which can be restored (`isLegal`).
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

  if (current && !isLegal(current, next)) {
    return {
      ok: false,
      error: { code: "illegal_transition", from: current.status, to: next },
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
      fromStatus: current?.status ?? null,
      toStatus: next,
      at,
    },
  };
}

/**
 * Os status alcançáveis a partir do atual, o próprio incluído.
 *
 * A interface oferecia os dez status sempre: de `preparing` o seletor listava
 * `interviewing`, o domínio recusava, e a pessoa descobria a regra pela
 * mensagem de erro — depois de digitar a nota. A lista sai de
 * `LEGAL_TRANSITIONS`, então oferecer só o possível é a mesma regra lida uma
 * vez, e não uma segunda cópia dela que envelhece sozinha.
 *
 * Sem candidatura, tudo é alcançável: a primeira observação pode registrar uma
 * candidatura que já existe fora deste sistema. `appliedAt` decide se um
 * arquivamento pode ser desfeito, então vem junto com o status.
 */
export function allowedTransitions(
  current: ApplicationStatus | null,
  appliedAt: string | null = null,
): readonly ApplicationStatus[] {
  if (!current) return APPLICATION_STATUSES;
  // Status gravado fora da lista não existe em teoria — o tipo diz isso — e
  // existe na prática: a coluna é `text` com enum só no Drizzle, sem CHECK no
  // banco, e o acervo veio de um snapshot legado. Esta função roda em LEITURA,
  // ao renderizar a tela; espalhar `undefined` aqui trocaria uma linha estranha
  // por uma página quebrada. O resto da interface já degrada assim.
  const legal = LEGAL_TRANSITIONS[current];
  if (!legal) return [current];
  const state = { status: current, appliedAt };
  const reachable = new Set<ApplicationStatus>([current, ...legal.filter((next) => isLegal(state, next))]);
  return APPLICATION_STATUSES.filter((status) => reachable.has(status));
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
