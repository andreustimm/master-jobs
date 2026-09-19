---
status: completed
title: Target tracks and per-track fit
type: backend
complexity: critical
---

# Task 1: Target tracks and per-track fit

## Overview

Deliver the target-track model end to end on the data and scoring side: the
term kernel, the `target_track` and `saved_term` tables, the `job_score`
primary-key change with its backfill, track lifecycle, per-track scoring with
the relevance gate, and every `job_score` reader moved to a track scope. This
is the contract every later task builds on, and it changes the identity of the
fit, so it must land whole.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST add `src/core/term.ts` with `validateTerm`, `termKey`, `termPattern`, `termRegexSql`, `matchesTerm` and the exported `TERM_BOUNDARY`, and make `score.ts`'s `containsTerm` use that constant (ADR-012).
2. MUST add `target_track` and `saved_term` (including `paused_reason`) and change `job_score` to primary key `(candidate_id, track_id, job_id)` through expand → backfill → contract migrations in `drizzle/postgres/`, following `.claude/skills/drizzle-safe-migrations` (ADR-008).
3. MUST create exactly one primary track per candidate with an own matching profile, mark inherited target fields in `unreviewed_json` for non-owners, and delete `job_score` rows of candidates without an own profile (M-06).
4. MUST implement the pure track domain: `validateTrackName`, `validateTrackTarget` (weights 1–10 / −10 to −1, ranges rules), `effectiveProfile`, `isRelevant`, `suggestTrack` (copies primary ranges and seniority), `evidenceSupport` (own evidence and confirmed skills only), `inheritedFields`, `preselectTrack` (ADR-009).
5. MUST implement track app functions: create, update with stale detection, set primary, archive (pausing terms with `paused_reason = "track_archived"`), restore (resuming only those), limits (6 active), `trackOverview`, and `ensureMatchingProfile` writing the person profile plus the primary track.
6. MUST implement `trackScope` / `scoreTrackFilter` / `primaryScoreFilter` in the matching context and route every `job_score` reader through them; cross-candidate `max(fit)` readers use primary rows only.
7. MUST score the primary track on every open job and accepted tracks only on relevant jobs, never score a candidate with a pending primary, and bump `SCORER_VERSION` to `1.4.0`.
8. MUST expose a job-detail data function that computes a missing track's fit on demand without persisting it.
9. MUST update the context map table count and ownership, add the architecture rule that files referencing `jobScore` also reference a track filter, and update the E2E fixtures to create primary tracks.
</requirements>

## Subtasks
- [x] 1.1 Term kernel and shared word boundary used by the scorer.
- [x] 1.2 Schema and migrations for tracks, saved terms and the `job_score` key, with backfill of primary tracks.
- [x] 1.3 Pure track domain: validation, merge, relevance gate, deterministic suggestion, evidence support, inherited fields, preselection.
- [x] 1.4 Track storage and lifecycle (create, update, primary, archive, restore, overview) and the profile derivation writing the primary track.
- [x] 1.5 Track scope helper and SQL filters for every `job_score` reader.
- [x] 1.6 Per-track scoring with the relevance gate, pending-primary guard and scorer version bump.
- [x] 1.7 Move every `job_score` reader (board, cockpit, pipeline, dossier, analytics, export, report, gap, referrals, target corpus, verify, scrape, sweep snapshot, CLI) to the track scope.
- [x] 1.8 On-demand fit for tracks without a row, for the job detail.
- [x] 1.9 Context map, architecture tests, E2E fixtures and scoring/data-model docs.

## Implementation Details

Follow the TechSpec sections "Core Interfaces" (term kernel, track model, track
scope), "Data Models" (`target_track`, `job_score`, `saved_term`, migrations
0004–0006) and "Development Sequencing" steps 1–6. The migration numbers may
shift with the journal; keep the expand/backfill/contract order.

### Relevant Files
- `src/core/scoring/score.ts` — `SCORER_VERSION` (:36), `containsTerm` (:113-116), `scoreTitle`/`scoreKeywords`/`scoreSeniority`/`scoreComp` read the merged profile.
- `src/core/profile/schema.ts` — `ProfileSchema` (:21-134) and its `superRefine`; target vs person keys.
- `src/core/db/schema.ts` — `job_score` (:159-206), `candidate_matching_profile` (:477-486), `candidate_skill` (:537-565).
- `drizzle/postgres/` — baseline 0000 and 0003; legacy SQLite 0011→0013 show the same PK-change sequence.
- `src/contexts/matching/index.ts`, `infra/drizzle-profile.ts` (:8-46), `domain/derive.ts` (:85-111), `app/ensure-profile.ts` (:45-76) — profile per candidate and derivation.
- `src/core/scoring/apply.ts` — `loadScoringContext` (:38-53), `upsertScore` (:59-98), `scoreAll` (:143-186), M-06 gate (:283-286).
- `src/core/scoring/queue.ts` — `runScoreQueue` (:131-191), status helpers (:219-257).
- `src/core/db/repo.ts` — `boardConditions`/`scopedTo` (:120-176), `listBoard`/`countBoard`/`boardFacets` (:178-363), detail and cockpit readers (:636-807).
- `src/contexts/skills/domain/matcher.ts` (:18-51) and `index.ts` — skill aliases for suggestions.
- `tests/support/db.ts`, `tests/scoring.test.ts`, `tests/board-read-model.test.ts`, `tests/cov-db-repo.test.ts`, `tests/matching-derive.test.ts`.

### Dependent Files
- `src/core/apply/dossier.ts` (:101-128), `src/core/analytics/index.ts` (:35-90), `src/core/report/markdown.ts` (:94-127), `src/core/contacts.ts` (:151-152), `src/core/candidate.ts` (gap analysis ~:479-490), `src/contexts/skills/infra/drizzle-adapters.ts` (:173-193) — single-fit readers.
- `src/core/ingest/verify.ts` (:73, 83), `src/core/ingest/verify-queue.ts` (:135, 143), `src/core/scrape/infra/drizzle-queue.ts` (~:106-116), `src/core/scrape/parser.ts` (:115-116) — cross-candidate `max(fit)` and counts.
- `src/core/triage/job-sweep.ts` (:97-119), `app/api/export/route.ts` (:49), `src/cli.ts` (:719, 787-789, 1058-1076) — readers through `listBoard` or direct joins.
- `tests/e2e/setup.mjs` (:136-169) — `job_score` fixtures conflict target.
- `tests/architecture.test.ts` (:222-240), `docs/engineering/context-map.md` — table count and ownership.
- `docs/scoring.md`, `docs/data-model.md`, `docs/adr/0007-arquitetura-hexagonal-monolito-modular.md` — fit identity note.

### Related ADRs
- [ADR-002: Target Tracks as the Unit of Fit](adrs/adr-002.md) — model and primary default.
- [ADR-008: Per-Track Fit Lives in `job_score`, Keyed by Track](adrs/adr-008.md) — PK and reader filter.
- [ADR-009: A Track Is a Target Fragment Merged With the Person Profile](adrs/adr-009.md) — merge, relevance gate, M-06.
- [ADR-012: One Whole-Word Term Pattern Builder](adrs/adr-012.md) — term kernel.

## Deliverables
- `src/core/term.ts` and the scorer using `TERM_BOUNDARY`.
- Migrations creating `target_track`, `saved_term` and the new `job_score` key, with a rehearsed backfill.
- Track domain, storage, lifecycle and scope in the matching context.
- Per-track scoring at `SCORER_VERSION = "1.4.0"`.
- Every `job_score` reader filtered by track; architecture rule enforcing it.
- Updated E2E fixtures, context map, `docs/scoring.md` and `docs/data-model.md`.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-001–UT-012 — term kernel: validation, key, pattern, SQL string.
- [x] UT-020–UT-044 — track domain: validation, merge, relevance, suggestion, evidence, inherited fields, preselection.
- [x] UT-071–UT-076 — per-track scoring and scorer version.
- [x] IT-001–IT-005 — migrations 0004–0006.
- [x] IT-006–IT-022 — track lifecycle, profile derivation, scope.
- [x] IT-023–IT-031 — per-track scoring and the relevance gate.
- [x] IT-032–IT-041 — `job_score` readers and on-demand fit.
- [x] IT-116 — TypeScript/PostgreSQL pattern parity.
- [x] IT-125 — CSV export without track data for recruiters.

## Success Criteria
- Every assigned test case implemented and passing
- `rtk pnpm check` green with coverage thresholds met
- `rtk pnpm test:e2e` green with the updated fixtures
- No source file references `jobScore` without a track filter (architecture test)
- A candidate without an own profile has no `job_score` row after migration and after any scoring path
