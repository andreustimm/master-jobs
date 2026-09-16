## Executive Summary

Add an additive `job.archived_at` state, a pure archive decision, and a batch
CLI use case. Build candidate and recruiter read models on existing tables and
enforce scope before aggregation. Keep source closure, application state,
payload retention, and physical pruning as separate boundaries.

## System Architecture

### Component Overview

- **Lifecycle domain** — pure cutoff, eligibility, and reopen decisions.
- **Job repository/CLI use case** — selects rows, performs dry-run or a
  transaction, and emits aggregate-safe output.
- **Candidate history read model** — joins applications and jobs by the session
  candidate and reads events on demand.
- **Recruiter history read model** — resolves authorized relationships first and
  applies the resulting scope in SQL.
- **UI pages/actions** — server-rendered, localized, and guarded by existing
  auth policy.
- **Probe/verify queue** — remains the owner of alive/gone evidence; archive
  consumes its durable facts and never probes directly.

## Implementation Design

### Core Interfaces

```ts
export type ArchiveDecision =
  | { kind: "archive"; reason: "closed-retention" }
  | { kind: "keep"; reason: string }
  | { kind: "noop"; reason: "already-archived" };

export function decideArchive(input: {
  closedAt: string | null;
  archivedAt: string | null;
  hasApplication: boolean;
  cutoff: string;
  sourceKind: SourceKind;
}): ArchiveDecision;
```

`SourceKind` is the existing closed union from `src/core/sources/types.ts`;
the pure rule rejects `manual` and `recruiter` before applying any cutoff.

The use case accepts `{ cutoff, dryRun, limit }`, returns aggregate counts, and
never accepts a candidate id from the client as an authorization proof.

### Data Models

Add nullable `archived_at TEXT` to `job` with an index that supports
`closed_at`/`archived_at` cutoff scans. Preserve all existing foreign keys.
Candidate history returns `{ application, jobState, events }`; recruiter history
returns the same row shape after relationship scoping. Counts use
`count(application.id)`; event counts are separate.

### API Endpoints

No new public endpoint is required for the first slice. Existing authenticated
pages/server actions call the read models. The CLI contract is:

```text
jho jobs archive --closed-days 90 --dry-run
jho jobs archive --closed-days 90 --apply
```

Invalid cutoff, missing maintenance permission, or an inconclusive source state
returns a safe error/zero-change result and does not mutate applications.

## Integration Points

- **PostgreSQL** — additive migration and transactional writes through the
  current runtime adapter. The legacy SQLite snapshot is an import/test input,
  not a second runtime dialect.
- **Auth policy** — `guard`, `requirePage`, `can`, and existing recruiter scope.
- **Probe/verify queue** — consumes existing `alive`/`gone` verdicts; network
  failures remain inconclusive.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/db/schema.ts` | modified | add archive state; migration drift risk | add field/index and migration |
| `src/core/ingest/` | modified | reopen must clear automatic archive | preserve no-application-write rule |
| `src/core/db/retention.ts` | modified | separate archive from prune | share protection predicate |
| `src/contexts/pursuit/` | modified | candidate/recruiter read models | scope before aggregate |
| `app/` history pages | new/modified | visible history and labels | i18n, tokens, mobile |
| `src/cli.ts` | modified | archive command | dry-run default, safe output |
| `tests/` | new/modified | contract coverage | assign every test ID |

## Testing Approach

Vitest unit tests cover pure decisions, status/count rules, and error paths.
Integration tests use the real disposable database and migrations. E2E tests
use authenticated candidate/recruiter personas and verify refresh, mobile
layout, and scope. Network adapters are faked only at the HTTP boundary; no
test points at Turso, Supabase, or a public board.

## Development Sequencing

### Build Order

1. Add migration, domain decision, repository predicate, and CLI dry-run/apply.
2. Add candidate read model and authenticated history UI.
3. Add recruiter relationship-scoped read model and UI.
4. Run QA, update operations docs, and prepare the PR.

### Technical Dependencies

- Existing PostgreSQL schema/migration composition; the SQLite snapshot remains
  an explicit import/test input only.
- Existing auth policy and recruiter relationship contract.
- Fixture task `environment-sample-only` for non-production testing.
- A human-approved production window before applying a migration or schedule.

## Monitoring and Observability

Emit aggregate-only archive counts: eligible, archived, already archived,
preserved by application, skipped by source kind, and errors. Track reopens and
authorization denials. Never log descriptions, URLs, notes, CVs, or secrets.

## Technical Considerations

### Key Decisions

- **Separate `archived_at` from `closed_at`:** preserves the source fact and
  makes presentation reversible.
- **Query-based history first:** avoids drift from denormalized counters at the
  current volume.
- **CLI dry-run default:** makes a destructive-looking operation reviewable even
  though the archive mutation itself is reversible.
- **No MongoDB:** a second database does not improve the durable application
  boundary and would add operations and retention cost.

### Known Risks

- A source may be partially empty; mitigation is complete-reconciliation and
  inconclusive-probe rules.
- Recruiter scope may differ across existing contexts; reuse the policy and
  stop implementation if no authoritative relationship exists.
- Large history queries may need pagination/index tuning; measure before adding
  a materialized counter.

## Architecture Decision Records

- [ADR-001: Separate archive state from source closure](adrs/adr-001.md)
- [ADR-002: Query-based scoped history before counters](adrs/adr-002.md)
- [ADR-0020: Archive preserves applications](../../../docs/adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md)
