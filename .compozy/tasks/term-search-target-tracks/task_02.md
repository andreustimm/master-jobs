---
status: pending
title: Term capture pipeline on registered platforms
type: backend
complexity: high
---

# Task 2: Term capture pipeline on registered platforms

## Overview

Deliver the sourcing side of term searches: a new `sourcing` context that
enqueues and runs term captures, a durable per-platform quota ledger that the
regular sync also obeys, term search on the registered platforms, and the
ingestion changes that keep captures non-destructive. After this task, a term
key can be captured, attributed and observed through a stable public API, which
saved terms and the Jobs screen consume next.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST create `src/contexts/sourcing/` following the `src/contexts/skills/` layout (domain, ports, app, infra, index) with `TermCaptureQueuePort` and `PlatformQuotaPort`, and add the `sourcing` row to the context map.
2. MUST add `term_capture`, `term_attribution` and `platform_quota` through a new migration, with declared `ON DELETE` actions matching the applied DDL.
3. MUST reserve quota atomically before every call to a budgeted platform, in term captures and in `syncOne`; budgeted calls MUST use `retries: 0`; a 429 MUST exhaust the platform's day window (ADR-010).
4. MUST extend `SourceAdapter` with the optional `termSearch` capability (`budget`, `validatedOn`, `search`) and `RawJob` with `tags`; Remotive MUST support term search; RemoteOK (`tag`) and Himalayas (search endpoint) MUST be implemented and stay out of term runs (`validatedOn: null`) until `jho sources probe --term` validates them against the real API.
5. MUST make `observeRawJob` accept `keepExistingSource`, clear `archivedAt` whenever it reopens a job, and ingest term captures under an `enabled: false` `<kind>:~terms` source; the sources YAML schema MUST reject handles starting with `~` (ADR-011).
6. MUST decide attribution at capture time with `matchesTerm` over title, company, description and tags, keep at most 100 jobs per platform per run (newest first), and never close, archive, delete or reassign a job.
7. MUST expose `requestTermCaptures`, `runTermCaptures`, `captureStatusFor`, `attributedJobIds` and `captureHealth`; every entry point MUST pass the ingestion guard; no log or returned health field may contain a term, query or candidate id.
8. MUST add `--term` to `jho sources probe`, guarded, writing nothing.
</requirements>

## Subtasks
- [ ] 2.1 Sourcing context skeleton, ports and migration for capture, attribution and quota tables.
- [ ] 2.2 Quota ledger with atomic reservation, day exhaustion and quota in the regular sync.
- [ ] 2.3 Term-search capability on the adapter port, Remotive search, RemoteOK and Himalayas search behind validation, platform tags.
- [ ] 2.4 Non-reassigning observation mode, archive cleared on reopen, `~terms` source and handle refinement.
- [ ] 2.5 Capture queue with lease and idempotent daily rows; capture runner with budget, failure classes and attribution.
- [ ] 2.6 Public API for requesting captures, capture state, attributed job ids and aggregate health.
- [ ] 2.7 Probe with `--term`, ingestion guard on every new entry point, fixtures captured from real probes.
- [ ] 2.8 `docs/sources.md` and the context map updated.

## Implementation Details

Follow the TechSpec sections "Core Interfaces" (term-search capability,
sourcing ports, sourcing public API), "Data Models" (`term_capture`,
`term_attribution`, `platform_quota`, `~terms` sources), "Integration Points"
and "Development Sequencing" steps 7–9. Reuse the `FOR UPDATE SKIP LOCKED`
claim pattern of the existing table queues.

### Relevant Files
- `src/core/sources/types.ts` (:8-92) — `RawJob`, `SourceConfig`, `FetchResult`, `SourceAdapter`.
- `src/core/sources/aggregators.ts` — Himalayas (:48-113, feed ignores `q`), Remotive (:117-156), RemoteOK (:198-243).
- `src/core/sources/http.ts` (:39-87) and `http-port.ts` (:21-104) — retries on 429/5xx, `fixtureHttp`.
- `src/core/sources/registry.ts` (:27-64), `src/core/sources/config.ts` (:8-37).
- `src/core/ingest/observe.ts` (:45-183) — update overwrites `sourceId` and leaves `archivedAt` (:168-171).
- `src/core/ingest/run.ts` (:54-154) — `ensureSources`, `syncOne`, closure by absence (:115-127).
- `src/core/ingest/guard.ts` (:32-46), `src/core/ingest/environment.ts` (:42-120).
- `src/core/scrape/infra/drizzle-queue.ts` (:24-92), `src/core/scrape/domain/retry-policy.ts` — claim and retry precedents.
- `src/contexts/skills/` — context layout template; `src/core/rate-limit.ts` — why an in-memory limiter is not enough.
- `src/cli.ts` (:504-516) — unguarded `sources probe`.

### Dependent Files
- `src/core/ingest/verify-queue.ts` (:221) — reopen already clears archive; keep behavior consistent.
- `tests/ingestion-guard-entrypoints.test.ts` (:44-52) — extended by task_03 with the CLI entry point.
- `config/sources.yaml` — handle refinement; `~terms` rows never appear there.
- `docs/sources.md`, `docs/engineering/context-map.md`, `docs/adr/0009-fila-de-raspagem.md` (reference only).

### Related ADRs
- [ADR-004: Candidate-Triggered Term Capture as a Bounded Exception](adrs/adr-004.md) — scope and invariants.
- [ADR-007: Term Captures Run Through a Table-Backed Queue](adrs/adr-007.md) — queue and runner.
- [ADR-010: A Durable Per-Platform Quota Ledger](adrs/adr-010.md) — reservation.
- [ADR-011: Term Captures Ingest Under a Non-Synced Source](adrs/adr-011.md) — ingestion changes.
- [ADR-012: One Whole-Word Term Pattern Builder](adrs/adr-012.md) — attribution matching.

## Deliverables
- `src/contexts/sourcing/` with ports, drizzle infra and public API.
- Migration for the three sourcing tables; context map updated.
- Quota ledger enforced in term captures and `syncOne`.
- Term search on Remotive; RemoteOK and Himalayas implemented behind `validatedOn`.
- `observeRawJob` changes and `~terms` sources.
- `jho sources probe --term` guarded; probe fixtures under `tests/fixtures/term-search/`.
- `docs/sources.md` describing term search, budgets and validation.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-050–UT-056 — sourcing domain: windows, failure classes, attribution, cap, reachability.
- [ ] UT-057–UT-062 — term-search adapters.
- [ ] UT-063 — sources YAML handle refinement.
- [ ] IT-042–IT-047 — ingestion changes.
- [ ] IT-048–IT-055 — quota ledger.
- [ ] IT-056–IT-059, IT-061–IT-070, IT-072 — capture requests and runner.
- [ ] IT-124 — aggregate health without private data.
- [ ] IT-133 — `jho sources probe --term`.

## Success Criteria
- Every assigned test case implemented and passing
- `rtk pnpm check` green with coverage thresholds met
- Ten concurrent reservations never exceed a platform's budget
- A term capture leaves every pre-existing job's source, closure and archive state untouched except reopening
