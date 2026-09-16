---
status: pending
title: Deterministic fixture corpus and seed
type: backend
complexity: medium
---

# Task 02: Deterministic fixture corpus and seed

## Overview

Create the small fixture corpus that makes dev/staging useful without production
data. The seed covers modality, lifecycle, applications, events, and persona
isolation and can be repeated safely.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- Fixtures MUST contain no production PII, secrets, or raw scrape payload.
- Seed MUST run after migrations and be idempotent under repetition/concurrency.
- Corpus MUST cover remote, hybrid, onsite, unknown, open, closed, and reopened
  states. Archived fixtures are added after the lifecycle migration supplies
  `archived_at`.
- Candidate/recruiter fixtures MUST exercise existing authorization boundaries.
- Size and counts MUST be bounded and observable.
</requirements>

## Subtasks

- [ ] Define fixture profile and bounded records.
- [ ] Implement reset/reseed with migration ordering and rollback.
- [ ] Add candidate/recruiter/application/event isolation fixtures.
- [ ] Add assigned seed and E2E coverage.

## Implementation Details

Follow `_techspec.md` “Data Models” and the existing disposable test database
patterns. Reuse schema composition; do not add a production-dump import path.

### Relevant Files

- `src/core/db/` — migrations, seed composition, and test database helpers.
- `tests/fixtures/` — fixture conventions to extend or create.
- `tests/e2e/` — isolated browser seed/session setup.

### Dependent Files

- Task 01 policy — seed/read path must not enable ingestion.
- `src/core/scoring/` — sample job text must exercise deterministic scoring.
- `src/core/auth/` — personas must use existing policy.

### Related ADRs

- [ADR-001: Fixtures and fail-closed ingestion](adrs/adr-001.md)
- [ADR-0021: Non-production environments use synthetic data](../../../docs/adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md)

## Deliverables

- Versioned bounded fixture profile and idempotent seed/reset.
- Counts/size assertions and persona data.
- Every assigned test case implemented and passing.

## Tests

- [ ] UT-003, UT-004 — fixture validation, bounds, idempotency, concurrency.
- [ ] IT-001 — migration/seed and rollback.
- [ ] E2E-001, E2E-002 — fixture browsing and persona isolation.

## Success Criteria

- Every assigned test case implemented and passing.
- Repeated seed produces stable identities and bounded size.
- E2E can run with external sources offline.
