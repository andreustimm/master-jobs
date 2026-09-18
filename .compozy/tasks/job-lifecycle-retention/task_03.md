---
status: pending
title: Recruiter-scoped application history
type: backend
complexity: high
---

# Task 03: Recruiter-scoped application history

## Overview

Deliver the recruiter read model and view that aggregate only authorized
candidate applications. This slice makes the permission boundary observable and
keeps closed/archived jobs useful without exposing unrelated candidate data.

<critical>
- ALWAYS READ [`_prd.md`](_prd.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md), and [`_tests.md`](_tests.md) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- Authorization MUST resolve recruiter scope before aggregation or row loading.
- Client-supplied candidate ids MUST NOT widen that scope.
- No response MUST disclose existence of an unrelated candidate or application.
- Aggregates MUST remain bounded by authorized relationships and paginate rows.
- Closed/archived job state MUST remain distinct from application status.
- The recruiter view MUST NOT show a candidate's target tracks, saved terms,
  per-track fits or compensation ranges, even for linked candidates
  ([`term-search-target-tracks`](../term-search-target-tracks/_prd.md), rule 45).
</requirements>

## Subtasks

- [ ] Map the existing recruiter relationship and policy to a read-side scope.
- [ ] Add scoped counts, pagination, and row/event loading.
- [ ] Add page/action guards and safe not-found/empty behavior.
- [ ] Add localized recruiter labels and closed/archived state.
- [ ] Add assigned unit, integration, and E2E coverage.

## Implementation Details

Follow `_techspec.md` [Data Models](_techspec.md#data-models), [API Endpoints](_techspec.md#api-endpoints),
and [Integration Points](_techspec.md#integration-points). The query must
apply scope in SQL/repository boundaries, not filter a global result in memory.

### Relevant Files

- `src/contexts/auth/domain/policy.ts` — pure permission decisions.
- `src/contexts/pursuit/` — application and relationship domain.
- `app/` recruiter/admin pages — existing role-scoped UI patterns.
- `proxy.ts` and page guards — session boundary.
- `tests/` auth/policy coverage — isolation conventions.

### Dependent Files

- `src/core/db/schema.ts` — application/job relations and archive state.
- `src/core/db/repo.ts` — scoped query composition.
- `src/core/i18n/` — localized labels and denial/empty states.

### Related ADRs

- [ADR-002: Query-based scoped history before counters](adrs/adr-002.md)
- [ADR-0020: Archive preserves applications](../../../docs/adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md)

## Deliverables

- Recruiter-scoped history read model and UI/action integration.
- Permission isolation for direct links, malformed ids, and relationship changes.
- Every assigned test case implemented and passing.

## Tests

- [ ] UT-007 — recruiter input, permission, and scope bounds.
- [ ] IT-004 — relationship-first aggregation and isolation.
- [ ] E2E-002 — recruiter journey and unlinked deep-link denial.

## Success Criteria

- Every assigned test case implemented and passing.
- Recruiter A cannot observe candidate B without an authorized relationship.
- Closed/archived job state is visible without mutating application status.
- Global corpus size does not determine the query scope.
