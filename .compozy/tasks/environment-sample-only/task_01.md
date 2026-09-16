---
status: pending
title: Fail-closed ingestion policy and entrypoints
type: backend
complexity: high
---

# Task 01: Fail-closed ingestion policy and entrypoints

## Overview

Add the environment policy and enforce it before any adapter, queue, probe, or
worker is constructed. This protects dev/staging and keeps local network access
an explicit diagnostic choice.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The policy MUST fail closed for absent or unknown environments.
- Dev, staging, and preview MUST never resolve source adapters or create ingest queues.
- Local MUST require explicit diagnostic opt-in; production MUST require `productionAllowlistSatisfied: true` from the normalized configured allowlist.
- Blocked attempts MUST be side-effect free and redact diagnostics.
- Every ingestion entrypoint MUST use the same policy.
</requirements>

## Subtasks

- [ ] Define normalized environment policy and typed operational error.
- [ ] Guard sync, scrape, recheck, probe, and Compozy sweep entrypoints.
- [ ] Add no-adapter/no-queue instrumentation and redacted aggregate output.
- [ ] Add assigned unit/integration tests.

## Implementation Details

Follow `_techspec.md` “Core Interfaces” and “Ingestion guard”. Keep scheduler
checks as defense in depth; the core guard is authoritative.

### Relevant Files

- `src/core/ingest/` — sync, scrape, verify, probe entrypoints.
- `src/core/sources/` — adapter registry that must not resolve when blocked.
- `src/cli.ts` — command boundary and errors.
- `compozy/` and `.github/workflows/` — automated sweep entrypoints.

### Dependent Files

- `src/core/db/` — queues must remain untouched when blocked.
- `tests/` — environment and no-network fixtures.
- `vercel.json` — cron route environment gate.

### Related ADRs

- [ADR-001: Fixtures and fail-closed ingestion](adrs/adr-001.md)
- [ADR-0021: Non-production environments use synthetic data](../../../docs/adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md)

## Deliverables

- Pure environment policy, entrypoint guards, and safe diagnostics.
- Every assigned test case implemented and passing.

## Tests

- [ ] UT-001, UT-002 — policy branches, ordering, no-I/O and redaction.
- [ ] IT-002 — blocked entrypoints and no-I/O contract.

## Success Criteria

- Every assigned test case implemented and passing.
- Dev/staging cannot spend source quota through any supported ingestion entrypoint.
- Production path remains available only with explicit context.
