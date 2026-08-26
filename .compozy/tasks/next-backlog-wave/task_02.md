---
status: completed
title: Register and schedule the Compozy job sweep safely
type: infra
complexity: high
---

# Task 02: Register and schedule the Compozy job sweep safely

## Overview

Activate the already validated `job-sweep` loop in CompozyOS using an ordered,
observable sequence. The task records enough evidence to distinguish a manual
run from a scheduled job and keeps the user’s application funnel untouched.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The daemon, workspace, and loop MUST be validated before an automation job is created.
- A manual run MUST reach a documented terminal state and expose `status`, `summary`, and `candidates`.
- Registration and scheduling MUST be idempotent; existing resources must be reused or reported.
- The loop MUST NOT call `jho track` or write to `application`.
- Public posting descriptions MUST NOT be printed to a shell-capable agent;
  the scheduled flow MUST use the fixed operator/reviewer trust boundary in
  ADR 0018, with the reviewer session set to `deny-all`.
- If the daemon or credentials are unavailable, the task MUST leave a precise blocked note and MUST NOT claim activation.
</requirements>

## Subtasks

- [x] 2.1 Verify the CompozyOS 0.3 wrapper and daemon status.
- [x] 2.2 Register the repository workspace and validate the loop definition.
- [x] 2.3 Create/reuse `job-sweep` and run it manually once.
- [x] 2.4 Record run id, terminal state, output shape, and any source failures.
- [x] 2.5 Create/reuse the weekday automation only after the manual evidence is clean.
- [x] 2.6 Update the runbook with the observed result without adding credentials.

## Implementation Details

Use the commands and ordering in `_techspec.md` and `compozy/README.md`. This
task changes operational daemon state and the runbook only; it does not add a
new application API or alter the production GitHub Actions scan.

### Relevant Files

- `compozy/loops/job-sweep.yaml` — validated loop definition.
- `compozy/README.md` — activation runbook and evidence location.
- `.github/workflows/varredura.yml` — independent production scan to preserve.

### Dependent Files

- `.compozy/tasks/next-backlog-wave/task_01.md` — documentation contract must be valid first.

### Related ADRs

- [ADR-002: Register Compozy automation only after a manual run](adrs/adr-002.md)

## Deliverables

- Registered/reused workspace and loop, or a precise blocked report if the local daemon is unavailable.
- Manual run evidence and schedule evidence in `compozy/README.md` when successful.
- Every assigned test case implemented and passing.

## Tests

- [x] IT-002 — task graph and loop definition validation.
- [x] IT-003, IT-004 — ordered runbook and idempotent operational behavior.
- [x] IT-009 — fixed operator/reviewer trust boundary for untrusted postings.

## Success Criteria

- Every assigned test case implemented and passing.
- No duplicate loop or automation job exists.
- No `application` mutation occurs during the run.
