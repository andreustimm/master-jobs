---
status: completed
title: Workflow, secrets, and QA isolation
type: infra
complexity: high
---

# Task 03: Workflow, secrets, and QA isolation

## Overview

Make deployment workflows and cron configuration honor the environment policy.
This slice keeps recurring ingestion production-only, removes production
secrets from previews/staging, and records the QA evidence needed to resume
work safely.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- Recurring ingestion workflows MUST be allowlisted to production.
- Preview/staging contracts MUST omit production database URLs, tokens, migrator credentials, and cron secrets.
- Deploy cancellation MUST leave no staging ingestion schedule enabled.
- Workflow validation MUST redact secret values and be repeatable.
- QA MUST verify fixture UI/persona behavior with no source network call.
</requirements>

## Subtasks

- [ ] Audit and gate GitHub Actions, Vercel cron, and Compozy automation.
- [ ] Separate environment secret contracts and redaction checks.
- [ ] Add workflow/deploy regression coverage.
- [ ] Execute E2E/QA and write the operational handoff.

## Implementation Details

Follow `_techspec.md` “Integration Points”, “Monitoring”, and “Known Risks”.
Keep production promotion human-controlled according to repository workflow.

### Relevant Files

- `.github/workflows/varredura.yml` — recurring ingestion workflow.
- `vercel.json`, `app/api/cron/` — Vercel cron route/configuration.
- `compozy/` — sweep definition and registration notes.
- `.env.example`, deployment docs — environment contract.
- `docs/qa/` — durable QA charter/report state.

### Dependent Files

- Task 01 guard and Task 02 fixtures.
- `docs/engineering/deploy.md`, `docs/operations.md`, `docs/roadmap.md`.
- CI checks and release promotion workflow.

### Related ADRs

- [ADR-001: Fixtures and fail-closed ingestion](adrs/adr-001.md)
- [ADR-0021: Non-production environments use synthetic data](../../../docs/adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md)

## Deliverables

- Production-only scheduler/workflow configuration and secret contract.
- QA/E2E evidence and updated runbook.
- Every assigned test case implemented and passing.

## Tests

- [ ] IT-003 — workflow, secret, schedule, and redaction contract.
- [ ] E2E-003 — preview/staging blocked-ingestion journey.

## Success Criteria

- Every assigned test case implemented and passing.
- No preview/staging workflow can schedule real ingestion or receive production secrets.
- QA evidence is durable and the next operator has a precise retry path.
