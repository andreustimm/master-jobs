---
status: pending
title: Lifecycle domain, schema, and archive CLI
type: backend
complexity: high
---

# Task 01: Lifecycle domain, schema, and archive CLI

## Overview

Deliver the durable archive state and the operator workflow that previews and
applies it. This vertical slice establishes the contract consumed by the two
history views and keeps source closure, archive, and application decisions
separate.

<critical>
- ALWAYS READ [`_prd.md`](_prd.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md), and [`_tests.md`](_tests.md) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The schema MUST add nullable archive state without changing application foreign keys.
- The domain MUST reject open, recent, manual, and inconclusive jobs.
- The CLI MUST default to dry-run and MUST report aggregate counts without payload text or PII.
- Apply MUST be transactional and idempotent; it MUST NOT mutate application or application_event.
- Reopen MUST clear automatic archive without duplicating fingerprint or application.
</requirements>

## Subtasks

- [ ] Add the additive schema migration and verified indexes.
- [ ] Implement pure archive eligibility and reopen decisions.
- [ ] Wire repository selection with application-preservation predicate.
- [ ] Add `jho jobs archive` dry-run/apply and safe error output.
- [ ] Integrate alive/reopen behavior with existing verify queue.
- [ ] Add unit and integration coverage assigned below.

## Implementation Details

Follow `_techspec.md` sections [Core Interfaces](_techspec.md#core-interfaces),
[Data Models](_techspec.md#data-models), and [Integration Points](_techspec.md#integration-points).
Keep SQL in the repository/infra layer and keep timestamps
as explicit inputs to pure functions.

### Relevant Files

- `src/core/db/schema.ts` — current `job`, `application`, and indexes.
- `src/core/db/retention.ts` — existing prune/payload retention boundary.
- `src/core/ingest/probe.ts` — gone/alive/inconclusive verdict rules.
- `src/core/ingest/verify-queue.ts` — persistent recheck and reopen behavior.
- `src/cli.ts` — command composition and output conventions.
- `drizzle/` — migration ownership and journals.

### Dependent Files

- `src/core/db/repo.ts` — board queries must distinguish active and archived jobs.
- `src/contexts/pursuit/` — history read models consume the new state.
- `docs/operations.md` — command/runbook after implementation.

### Related ADRs

- [ADR-001: Separate archive state from source closure](adrs/adr-001.md)
- [ADR-0020: Archive preserves applications](../../../docs/adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md)

## Deliverables

- Additive migration, pure lifecycle functions, repository use case, and CLI.
- Dry-run/apply operational output and reopen integration.
- Every assigned test case implemented and passing.

## Tests

- [ ] UT-001, UT-002, UT-003, UT-004, UT-005, UT-008 — domain, idempotency, preservation, and CLI validation.
- [ ] IT-001, IT-002, IT-005 — migration, prune interaction, and atomic replay/reopen.
- [ ] E2E-003 — operator dry-run/apply/replay journey.

## Success Criteria

- Every assigned test case implemented and passing.
- Two archive runs produce one mutation at most per eligible job.
- No application, document, or event is removed or status-mutated.
- A later alive verdict returns the job to the active state.
