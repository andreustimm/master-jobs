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
  archived: [],
};

/**
 * A first observation may start at any known stage: the user can register an
 * application that already exists outside this system. Once persisted, every
 * subsequent move follows the explicit funnel and terminal states stay final.
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

  if (current && !LEGAL_TRANSITIONS[current.status].includes(next)) {
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
