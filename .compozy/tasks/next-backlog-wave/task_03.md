---
status: completed
title: Show candidate-scoped rescore queue status
type: frontend
complexity: high
---

# Task 03: Show candidate-scoped rescore queue status

## Overview

Expose the existing rescore queue state on the candidate page so a CV save no
longer appears to disappear into the background. The read model and UI must be
candidate-scoped, localized, token-based, and usable on mobile and desktop.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The queue read model MUST filter by the authenticated candidate id before returning any count.
- The UI MUST support idle, pending, scoring, done, and failed states without exposing raw errors.
- All visible labels MUST come from both i18n dictionaries; no literal UI copy may be added to JSX.
- The component MUST use existing DESIGN.md tokens and pass 375px portrait, 812px landscape, tablet, and desktop layout checks.
- The implementation MUST remain server-rendered and MUST NOT add polling or a new client dependency.
</requirements>

## Subtasks

- [x] 3.1 Add a candidate-scoped queue snapshot API in `src/core/scoring/queue.ts`.
- [x] 3.2 Add unit coverage for all statuses, idle state, errors, and candidate isolation.
- [x] 3.3 Add locale keys to `src/core/i18n/en.ts` and `pt-BR.ts` with parity.
- [x] 3.4 Render the status card in `app/candidate/page.tsx` using existing tokens and session guards.
- [x] 3.5 Add isolated E2E coverage for state visibility, translation, and mobile overflow.
- [x] 3.6 Run the Impeccable UI context/audit flow and fix any spacing, accessibility, or responsive findings.

## Implementation Details

Follow [ADR-001](adrs/adr-001.md) and the TechSpec. Keep the database query in
the queue/core layer; the page calls it after `requireOwnCandidatePage`. Use the
existing `MutationFeedbackForm`/Card patterns and dictionary key typing.

### Relevant Files

- `src/core/scoring/queue.ts` — queue write and existing global status query.
- `src/core/db/schema.ts` — candidate-scoped `score_task` fields/index.
- `app/candidate/page.tsx` — candidate page Server Component.
- `src/core/i18n/en.ts` and `src/core/i18n/pt-BR.ts` — typed labels.
- `tests/scoring-queue.test.ts` — queue test database patterns.
- `tests/e2e/` — public UI/mobile harness.
- `DESIGN.md`, `app/design-tokens.css` — visual truth and semantic tokens.

### Dependent Files

- `app/i18n.ts` — translator acquisition and locale selection.
- `app/layout.tsx` — responsive viewport and shell constraints.

### Related ADRs

- [ADR-001: Candidate-scoped rescore status read model](adrs/adr-001.md)

## Deliverables

- Candidate-scoped queue snapshot API and tests.
- Localized, responsive candidate status card.
- E2E evidence for desktop and mobile state rendering.
- Every assigned test case implemented and passing.

## Tests

- [x] UT-004, UT-005, UT-006, UT-007, UT-008 — queue snapshot and safe state mapping.
- [x] IT-005 — page wiring through the authenticated candidate scope.
- [x] E2E-001, E2E-002 — user-visible state, locale, and responsive behavior.

## Success Criteria

- Every assigned test case implemented and passing.
- Candidate A cannot observe candidate B's queue counts.
- The page has no horizontal overflow at the required mobile widths.
- A failed queue item displays a generic localized failure state only.
