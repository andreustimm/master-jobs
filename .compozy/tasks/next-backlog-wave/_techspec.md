# Technical Specification: Next Backlog Wave

## Executive Summary

This workflow combines a documentation/configuration contract fix, an
operator-run Compozy activation, a candidate-scoped queue read model, and
fixture-driven ingestion regression coverage. It preserves the existing
hexagonal boundaries: queue state is read through `src/core/scoring/queue.ts`,
the page remains a Server Component, and adapter tests fake only the HTTP port.

The only external state change is the explicitly ordered Compozy registration.
It is guarded by a manual run and must be idempotent. Credentials are never
read into tracked artifacts; the code and example agree on variable names only.

## System Architecture

### Component Overview

- **Operations documentation** — `docs/roadmap.md`,
  `docs/product/backlog.md`, `docs/engineering/deploy.md`, and `.env.example`
  describe current state and environment contracts.
- **Compozy loop** — `compozy/loops/job-sweep.yaml` remains the source loop;
  its fixed operator/reviewer agents form a trust boundary around public job
  descriptions. `compozy/README.md` records registration, manual validation,
  scheduling, and no-funnel-mutation evidence.
- **Score queue read model** — `src/core/scoring/queue.ts` queries
  `score_task` by candidate id and returns an explicit status map.
- **Candidate page** — `app/candidate/page.tsx` obtains the authenticated
  candidate, calls the read model, and renders translated status content.
- **Ingestion fixtures** — `tests/adapters.test.ts` and
  `tests/cov-ingest-run.test.ts` use `fixtureHttp` and the test database to
  exercise registry and sync boundaries without network access.

## Implementation Design

### Core Interfaces

```ts
export type ScoreQueueSnapshot = {
  pending: number;
  scoring: number;
  done: number;
  failed: number;
  scored: number | null;
  lastError: string | null;
};

export async function scoreQueueStatus(
  candidateId?: number,
): Promise<Record<string, number>>;

export async function candidateScoreQueueStatus(
  candidateId: number,
): Promise<ScoreQueueSnapshot | null>;
```

`candidateScoreQueueStatus` returns `null` when the candidate has no queue row.
The UI maps `lastError` to a safe localized failure label and never renders raw
database error text.

### Data Models

No migration is required. `score_task.candidate_id` is already unique, and its
`status`, `scored`, and `last_error` fields are sufficient for the snapshot.
The query must include `where score_task.candidate_id = ?` and preserve the
existing `pending | scoring | done | failed` state vocabulary.

### API Endpoints

No new HTTP endpoint is required. The Server Component calls the core read model
after `requireOwnCandidatePage("candidate:read")`.

### CLI/Operational Interfaces

The existing Compozy commands remain canonical:

```text
~/bin/cy03 daemon start
~/bin/cy03 workspace add <repo>
~/bin/cy03 loop validate --file compozy/loops/job-sweep.yaml
~/bin/cy03 loop create --file compozy/loops/job-sweep.yaml
~/bin/cy03 loop run --name job-sweep
~/bin/cy03 automation jobs create --loop job-sweep --schedule "0 9 * * 1-5"
```

The Loop invokes the fixed `pnpm jho jobs sweep` preparation command and the
workspace-local `job-sweep-operator`/`job-sweep-reviewer` agents. The former
writes `.compozy/runtime/job-sweep-snapshot.json` with aggregate-only stdout;
the snapshot carries the failed source ids from the same sync, so the reviewer
can report degraded coverage without relying on the operator's shell output;
the latter is `deny-all` and receives the JSON through a `file-import` node, so
it has no filesystem, shell, network, Compozy, or MCP tools. It is not valid to
replace either agent with `general`.

The runbook must record the manual run id/state before the final scheduling
command. Existing `workflow_dispatch` on `.github/workflows/varredura.yml`
remains independent and is not replaced.

## Integration Points

- **CompozyOS 0.3 daemon** — local operator-owned automation; registration is
  idempotent and observed manually before scheduling.
- **Resend** — runtime mailer reads `RESEND_API_KEY` and `RESEND_FROM`; no API
  call is added in this workflow.
- **HTTP source adapters** — tests use `fixtureHttp`; no public source is
  contacted by automated tests.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `docs/roadmap.md` | modified | stale claims can misdirect future work | reconcile states and references |
| `docs/product/backlog.md` | modified | M-06 and credential gaps need current status | update only factual statuses |
| `.env.example` | modified | sender variable mismatch silently disables Resend | use `RESEND_FROM` |
| `src/core/scoring/queue.ts` | modified | add candidate-scoped read without leakage | unit test isolation and empty state |
| `app/candidate/page.tsx` | modified | render status card | use i18n/tokens/responsive layout |
| `src/core/i18n/{en,pt-BR}.ts` | modified | add status labels | keep key parity |
| `tests/*` | modified | protect env, queue, adapters, sync | assign all IDs in `_tests.md` |
| `compozy/README.md` | modified | operational sequence/evidence | keep no-funnel-mutation guard |

## Testing Approach

Vitest unit tests cover the queue read model, environment contract parser, and
normalization helpers. Integration tests use the real test database and HTTP
fixture port for sync/idempotence and adapter registry boundaries. The isolated
Playwright E2E suite verifies candidate-visible statuses and mobile overflow;
the Compozy run is validated by its CLI and recorded as operational evidence.

## Development Sequencing

### Build Order

1. Documentation and environment contract (no code dependencies).
2. Candidate-scoped queue read model and UI (depends only on existing queue).
3. Adapter/sync fixture hardening (independent, can run in parallel with step 2).
4. Compozy registration and schedule after the runbook and loop validate cleanly.

### Technical Dependencies

- Node 24, pnpm dependencies, and the existing isolated test database.
- CompozyOS 0.3 wrapper/daemon available for task 04; user-owned local daemon
  state is not committed.
- A real Resend key/from value is optional for runtime; tests must use fake env.
- Verified source handles are not required to complete fixture coverage.

## Monitoring and Observability

- Candidate page shows queue state and scored count without raw errors.
- `jho jobs rescore status` and Compozy run terminal state remain the operator
  diagnostics.
- `compozy/README.md` records loop run id, terminal state, and schedule creation
  time; it must not record credentials.
- Existing `varredura.yml` source health summary remains the production alert.

## Technical Considerations

### Key Decisions

- Candidate scope is enforced in the core query, not by filtering after a global
  read.
- The first UI release uses refresh/navigation rather than polling.
- Existing tables and ports are reused; no migration or broker is introduced.
- Documentation updates remove stale debt rather than creating replacement
  feature claims.
- Public posting text never reaches a shell-capable reviewer: the deterministic
  `jho jobs sweep` command writes an ignored snapshot, then a separate
  `deny-all` agent evaluates the imported JSON without filesystem, shell,
  network, Compozy, or MCP tools (ADR 0018).

### Known Risks

- A stopped Compozy daemon blocks operational activation; the task must leave a
  precise retry path instead of claiming completion.
- A stale browser page can show a previous state until refresh; this is explicit
  in the first-release UX and avoids client-side synchronization complexity.
- Real source handles may remain unknown; tests prove adapter behavior without
  adding unverified production sources.

## Architecture Decision Records

- [ADR-001: Candidate-scoped rescore status read model](adrs/adr-001.md)
- [ADR-002: Register Compozy automation only after a manual run](adrs/adr-002.md)
- [ADR-003: One canonical Resend sender variable](adrs/adr-003.md)
- [ADR-0018: Fronteira de confiança da varredura Compozy](../../../docs/adr/0018-fronteira-de-confianca-da-varredura-compozy.md)
