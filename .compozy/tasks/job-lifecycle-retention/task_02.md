---
status: completed
title: Candidate application history
type: frontend
complexity: medium
---

# Task 02: Candidate application history

## Overview

Deliver the authenticated candidate history read model and UI. The slice turns
the durable application tables into counts and rows that remain useful after a
job closes or archives.

<critical>
- ALWAYS READ [`_prd.md`](_prd.md), [`_techspec.md`](_techspec.md), [`_user_stories.md`](_user_stories.md), and [`_tests.md`](_tests.md) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The read model MUST scope by the authenticated candidate before aggregation.
- Counts MUST use unique application rows; events MUST remain a separate timeline.
- Closed and archived jobs with applications MUST remain visible after refresh.
- UI copy MUST use locale dictionaries and semantic tokens and MUST remain usable at mobile width.
- Read failures MUST expose a safe localized state without raw database errors.
</requirements>

## Subtasks

- [x] Add candidate-scoped history query and typed view model.
- [x] Add status counts, pagination, job-state labels, next action, and events.
- [x] Add localized empty/error/closed/archived content.
- [x] Wire page guard and refresh-safe navigation.
- [x] Add assigned unit, integration, and E2E coverage.

## Implementation Details

Follow `_techspec.md` [Data Models](_techspec.md#data-models) and [API Endpoints](_techspec.md#api-endpoints). Use the existing
Server Component and context composition patterns; do not put SQL in JSX.

### Relevant Files

- `src/contexts/pursuit/` — application state and read-side composition.
- `src/core/db/repo.ts` — shared job/application reads.
- `app/candidate/` — authenticated candidate pages.
- `src/core/i18n/` — typed English and Portuguese dictionaries.
- `app/design-tokens.css`, `app/globals.css` — semantic/mobile styling.

### Dependent Files

- `src/core/db/schema.ts` — archive state from Task 01.
- `src/core/auth/` and policy files — candidate scope.
- `tests/e2e/` — authenticated fixture/session helpers.

### Related ADRs

- [ADR-002: Query-based scoped history before counters](adrs/adr-002.md)
- [ADR-0020: Archive preserves applications](../../../docs/adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md)

## Deliverables

- Candidate history read model and responsive localized page.
- Empty, error, pagination, and archived-job states.
- Every assigned test case implemented and passing.

## Tests

- [x] UT-006 — candidate-scope validation and invalid status input.
- [x] IT-003 — candidate query, pagination, events, and errors.
- [x] E2E-001 — candidate history through refresh.

## Success Criteria

- Every assigned test case implemented and passing.
- A candidate can find an application after its job is archived.
- A foreign candidate id cannot influence the result.
- Mobile E2E reports no horizontal overflow.
