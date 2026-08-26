---
status: completed
title: Harden adapter fixtures and sync idempotence
type: test
complexity: medium
---

# Task 04: Harden adapter fixtures and sync idempotence

## Overview

Close the remaining ingestion coverage gap at the adapter registry and sync
orchestration boundaries. Stable fixtures will prove SmartRecruiters and
Recruitee normalization, repeated sync idempotence, and source-failure
isolation without contacting public APIs or guessing production handles.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- Adapter fixtures MUST use the existing HTTP port and MUST NOT perform network calls.
- SmartRecruiters and Recruitee fixtures MUST pass through the registry or the same public adapter contract used by sync.
- Repeating an identical fixture MUST produce one insert followed by unchanged, with a stable fingerprint.
- A failed source MUST be recorded without preventing a healthy source from completing.
- Production config MUST remain free of unverified SmartRecruiters/Recruitee handles.
</requirements>

## Subtasks

- [x] 4.1 Add/extend registry-level fixtures for SmartRecruiters normalization.
- [x] 4.2 Add/extend registry-level fixtures for Recruitee normalization.
- [x] 4.3 Add sync idempotence coverage using one of the fixture adapters.
- [x] 4.4 Add/extend source failure isolation coverage and assert source status.
- [x] 4.5 Add a config assertion/documentation note that real handles require `jho sources probe`.
- [x] 4.6 Run targeted adapter/sync tests and the complete verification suite.

## Implementation Details

Use `fixtureHttp`, `useTestDb`, `syncAll`, `getAdapter`, and the existing source
config parser. Prefer extending existing tests over creating parallel harnesses.
Do not add a source entry without an operator-provided, verified handle.

### Relevant Files

- `tests/cov-sources-ats.test.ts` — existing SmartRecruiters/Recruitee fixtures.
- `tests/cov-ingest-run.test.ts` — sync database and failure-isolation cases.
- `tests/adapters.test.ts` — adapter fixture style.
- `src/core/sources/registry.ts` — exhaustive adapter contract.
- `src/core/ingest/run.ts` — idempotence and source health orchestration.
- `config/sources.yaml` — active source boundary.

### Dependent Files

- `src/core/ingest/observe.ts` — fingerprint/upsert behavior under test.
- `src/core/sources/http-port.ts` — test-only network boundary.
- `docs/sources.md` — probe-before-config guidance.

### Related ADRs

- [ADR-0011: Fronteira CompozyOS e docs](../../../docs/adr/0011-fronteira-compozyos-e-docs.md)

## Deliverables

- Fixture coverage for both adapters through the supported contract.
- Sync idempotence and failure-isolation regression cases.
- Documentation/config guard against guessed handles.
- Every assigned test case implemented and passing.

## Tests

- [x] UT-009, UT-010, UT-011, UT-012 — adapter normalization and boundary cases.
- [x] IT-006, IT-007, IT-008 — sync wiring, idempotence, and isolated failure.

## Success Criteria

- Every assigned test case implemented and passing.
- The adapter suite makes zero external network requests.
- Identical fixture sync does not create duplicate jobs or change fingerprints.
- No unverified source handle is added to production configuration.
