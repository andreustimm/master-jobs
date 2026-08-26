---
status: completed
title: Reconcile operational documentation and environment contract
type: docs
complexity: medium
---

# Task 01: Reconcile operational documentation and environment contract

## Overview

Bring the roadmap, product backlog, deployment guide, Compozy runbook, and
environment example into agreement with the current code and workflows. Align
the Resend sender variable so a fresh operator configuration does not silently
fall back to the console mailer.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The tracked environment example MUST use `RESEND_FROM` and MUST NOT advertise `RESEND_FROM_EMAIL`.
- Documentation MUST mark implemented dashboard, Gmail, `db:seed`, rescore queue, and scheduled scan behavior accurately.
- Documentation MUST distinguish user-owned credential setup from code-complete behavior without printing or committing secret values.
- The Compozy runbook MUST preserve the no-funnel-mutation invariant and ordered activation sequence.
</requirements>

## Subtasks

- [x] 1.1 Audit roadmap/backlog/deploy/Compozy claims against current source and workflows.
- [x] 1.2 Update `.env.example` and deployment references to the canonical Resend variable.
- [x] 1.3 Remove stale `db:seed` and dashboard/Gmail debt claims while preserving genuine follow-ups.
- [x] 1.4 Document the operator-owned Resend/Gmail credential step without reading local secret files.
- [x] 1.5 Add the environment/documentation contract tests assigned below.

## Implementation Details

Update only factual statements in `docs/roadmap.md`, `docs/product/backlog.md`,
`docs/engineering/deploy.md`, `compozy/README.md`, and `.env.example`. Add a
small contract test under `tests/` that reads tracked documentation/example
files and exercises `configuredMailer` with fake values. Never edit `.env`.

### Relevant Files

- `docs/roadmap.md` — stale phase/debt claims.
- `docs/product/backlog.md` — M-06 and credential status.
- `docs/engineering/deploy.md` — production environment contract.
- `compozy/README.md` — loop activation sequence.
- `.env.example` — operator-facing variable names.
- `src/contexts/auth/infra/resend-mailer.ts` — runtime sender contract.

### Dependent Files

- `tests/resend-mailer.test.ts` — existing mailer contract to extend or complement.
- `tests/` — new tracked-file contract coverage.

### Related ADRs

- [ADR-003: One canonical Resend sender variable](adrs/adr-003.md)

## Deliverables

- Reconciled documentation and `.env.example`.
- Contract test for sender variable naming and fallback behavior.
- Every assigned test case implemented and passing.

## Tests

- [x] UT-001, UT-002, UT-003 — tracked environment and mailer contract.
- [x] IT-001 — documentation/configuration consistency.

## Success Criteria

- Every assigned test case implemented and passing.
- `rg RESEND_FROM_EMAIL .env.example docs/` returns no runtime configuration claim.
- Roadmap no longer lists implemented `db:seed`, dashboard, Gmail, or scheduled scan as missing.
