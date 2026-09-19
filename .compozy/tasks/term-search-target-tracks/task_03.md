---
status: completed
title: Saved terms, daily repeat and CLI
type: backend
complexity: high
---

# Task 3: Saved terms, daily repeat and CLI

## Overview

Deliver the candidate's saved terms: the domain rules (cooldown, new-job
counts, status aggregation), the matching app functions and Server Actions that
save, re-run, pause, resume, move and delete terms and trigger the immediate
drain with `after()`, and the CLI and sweep step that repeat every active term
daily. This connects the candidate's intent (task 1) to the capture pipeline
(task 2) without any screen, which task 5 adds.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST implement the saved-term domain: `cooldownState` (24 hours, first run included), `isNew`, `termStatus` aggregation, `zeroStreak` (14 days) and `dailyRepeatPaused` (36 hours without a sweep capture).
2. MUST implement `saveTerm`, `rerunTerm`, `setTermStatus`, `moveTerm`, `deleteTerm`, `newCount`, `termOverview` and `activeTermKeys` in the matching context with the result codes of the TechSpec; saving a term and enqueueing its captures MUST be atomic.
3. MUST enforce 20 active terms per candidate, one term per normalized key per candidate, a track for every term, and refusal of archived tracks and of pending primaries.
4. MUST implement the term Server Actions in `app/searches/actions.ts`, each awaiting `guardOwnCandidate("candidate:write")` first; save and re-run MUST schedule `after(() => runTermCaptures({ budgetMs: 25_000, worker: "web" }))` only when ingestion is permitted and the session is not impersonated (ADR-007).
5. MUST return `waiting_sweep` under impersonation and `captures_off` where ingestion is not permitted, without enqueueing.
6. MUST add `jho terms run [--max N]`, `jho terms status` and `jho tracks list [--candidate id]`; `terms run` MUST enqueue each active key once for today, drain with the shared runner, print per-platform aggregates only, and exit 1 when the ingestion guard blocks.
7. MUST add the `jho terms run` step to `.github/workflows/varredura.yml` after `jobs sync` and before `rescore run`.
8. MUST never send e-mail or push for new jobs, and no log or command output may contain a term or query.
</requirements>

## Subtasks
- [x] 3.1 Saved-term domain rules.
- [x] 3.2 Saved-term storage and app functions with limits, uniqueness and atomic save-and-enqueue.
- [x] 3.3 New-job counts, overview with per-platform states and the paused/no-results labels.
- [x] 3.4 Term Server Actions with guards, impersonation and environment handling, and the `after()` drain.
- [x] 3.5 CLI commands `terms run`, `terms status`, `tracks list`.
- [x] 3.6 Sweep step and ingestion-guard coverage of the new entry point.
- [x] 3.7 `docs/cli.md` and `docs/operations.md` updated.

## Implementation Details

Follow the TechSpec sections "Core Interfaces" (saved terms), "Data Models"
(`saved_term`), "API Endpoints" (term Server Actions, CLI, sweep) and
"Development Sequencing" step 10. Screens that render these results come in
task 5; the actions here return codes, and task 5 maps them to dictionary keys.

### Relevant Files
- `src/contexts/matching/` — tracks from task_01; saved terms live beside them.
- `src/contexts/sourcing/index.ts` — `requestTermCaptures`, `runTermCaptures`, `captureStatusFor` from task_02.
- `app/actions.ts` (:87-101) — `recheckAction`, the enqueue-only "run now" precedent.
- `app/auth.ts` (:59-121) — `guard`, `guardOwnCandidate`, `requireOwnCandidatePage`, session with `impersonatedBy`.
- `src/contexts/auth/domain/policy.ts` (:55-132) — impersonation only blocks admin actions today.
- `src/cli.ts` (:521-697) — `jobs sync`, `jobs sweep`, `score`, `rescore` command structure.
- `.github/workflows/varredura.yml` (:92-128) — sweep steps and gate.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` — `after()` duration semantics.
- `tests/cov-cli-harness.ts`, `tests/ingestion-guard-entrypoints.test.ts`.

### Dependent Files
- `tests/architecture.test.ts` (:466-490) — every exported action awaits a guard.
- `src/core/triage/job-sweep.ts`, ADR 0018 — the sweep output stays aggregate-only.
- `docs/cli.md`, `docs/operations.md`.

### Related ADRs
- [ADR-001: Saved Term Searches With an Immediate First Run](adrs/adr-001.md) — product behavior.
- [ADR-003: Every Saved Term Belongs to Exactly One Track](adrs/adr-003.md) — track requirement.
- [ADR-006: Tracks and Terms Are Private](adrs/adr-006.md) — visibility and no e-mail.
- [ADR-007: Term Captures Run Through a Table-Backed Queue](adrs/adr-007.md) — `after()` and sweep drains.

## Deliverables
- Saved-term domain and app functions in the matching context.
- `app/searches/actions.ts` with the term actions.
- `jho terms run`, `jho terms status`, `jho tracks list`; sweep step.
- Updated `docs/cli.md` and `docs/operations.md`.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-045–UT-049 — saved-term domain rules.
- [x] IT-074–IT-083 — save term, including actions, impersonation, environment and `after()`.
- [x] IT-084–IT-089 — manual re-run.
- [x] IT-090–IT-093 — pause, resume, move, delete.
- [x] IT-094, IT-096–IT-102, IT-104 — counts, shared terms, active keys, daily repeat, overview labels, no e-mail.
- [x] IT-060, IT-071, IT-073 — runner behaviors observed through `jho terms run`.
- [x] IT-127 — ingestion guard on every term-capture entry point.
- [x] IT-131, IT-132 — CLI commands.

## Success Criteria
- Every assigned test case implemented and passing
- `rtk pnpm check` green with coverage thresholds met
- A saved term with ingestion permitted has capture rows claimed by the `after()` drain in the same invocation
- `jho terms run` output contains no term text (asserted by test)
