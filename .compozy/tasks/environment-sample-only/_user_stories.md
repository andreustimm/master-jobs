# User Stories: Sample-Only Development and Staging

Canonical behavior catalog for `environment-sample-only`. Companion to
`_prd.md`; consumed by `_techspec.md` and `_tests.md`.

## Personas

- **Developer** — needs deterministic data and a clear error when a network job is not allowed.
- **QA/release operator** — needs fixtures that cover product states and secrets that cannot leak into previews.
- **Production operator** — needs the recurring ingestion path to remain explicit and available only in production.

## Story Index

| ID | Feature Area | Persona | Story |
|---|---|---|---|
| US-001 | Sample corpus | Developer | Reset dev/staging to a small, representative fixture set. |
| US-002 | Ingestion guard | Developer | Get a fail-closed response when network ingestion is attempted outside production. |
| US-003 | Release safety | QA/release operator | Verify workflows and secrets keep production ingestion isolated. |

## Sample corpus

### US-001: Predictable fixture environment

**As a** developer, **I want** a small deterministic corpus,
**so that** product behavior is testable without copying production.

Acceptance criteria:

- AC-1: Given a reset request, when the fixture seed runs, then the four workplace types and lifecycle states exist.
- AC-2: Given a second reset, when the seed runs again, then counts and identities remain stable.
- AC-3: Given a fixture database, when UI/read commands run, then no public-source request is needed.

Edge cases:

- EC-1 invalid input: an unknown fixture profile is rejected with a safe error.
- EC-2 empty/missing: a missing database is initialized with the documented sample, not production data.
- EC-3 limits: oversized fixture payloads are rejected or truncated to the documented small corpus.
- EC-4 permissions: fixture reset requires the existing maintenance boundary.
- EC-5 concurrency: two resets converge without duplicate identities.
- EC-6 interruption: an interrupted seed leaves a retryable transaction state.
- EC-7 repetition: reseed is idempotent.
- EC-8 ordering: migrations run before fixture insertion.
- EC-9 state transitions: a re-opened fixture retains its application.
- EC-10 scale: fixture size remains bounded as a staging deploy repeats.

## Ingestion guard

### US-002: Fail-closed network routines

**As a** developer, **I want** sync/scrape/recheck to be rejected in dev and
staging, **so that** a forgotten scheduler cannot spend quota or import data.

Acceptance criteria:

- AC-1: Given dev or staging, when sync/scrape/recheck/sweep starts, then it fails before adapter resolution or queue creation.
- AC-2: Given local default, when ingestion starts, then it is blocked unless diagnostic opt-in is explicit.
- AC-3: Given production with the required allowlist, when ingestion starts, then the existing source pipeline remains available.

Edge cases:

- EC-1 invalid input: an unknown environment value fails closed.
- EC-2 empty/missing: absent allowlist does not imply production.
- EC-3 limits: a blocked run emits bounded aggregate diagnostics only.
- EC-4 permissions: a user cannot bypass the guard by changing a form value.
- EC-5 concurrency: concurrent blocked invocations do not open adapters or queues.
- EC-6 interruption: a blocked run exits safely without partial ingestion state.
- EC-7 repetition: repeated blocked attempts remain side-effect free.
- EC-8 ordering: guard executes before network client creation.
- EC-9 state transitions: moving from staging to production requires a new deployment context.
- EC-10 scale: block cost stays constant regardless of production corpus size.

## Release safety

### US-003: Safe workflows and secrets

**As a** QA/release operator, **I want** workflow and environment checks,
**so that** staging tests cannot accidentally reach production.

Acceptance criteria:

- AC-1: Given a staging/preview deployment, when environment variables are inspected, then production URLs/tokens are absent.
- AC-2: Given ingestion workflows, when they are triggered for staging, then no source job is scheduled.
- AC-3: Given fixture E2E, when candidate and recruiter personas run, then both use sample data and remain isolated.

Edge cases:

- EC-1 invalid input: malformed workflow environment is rejected by validation.
- EC-2 empty/missing: missing staging secrets result in a safe fixture mode, not fallback to production.
- EC-3 limits: workflow diagnostics do not print secret values.
- EC-4 permissions: only production context can enable recurring ingestion.
- EC-5 concurrency: a preview deploy cannot race a production scheduler for the same database.
- EC-6 interruption: canceled deploy leaves no enabled staging cron.
- EC-7 repetition: redeploy does not duplicate schedules or fixtures.
- EC-8 ordering: migration/seed precedes UI E2E; ingestion remains disabled.
- EC-9 state transitions: promoting a branch changes environment explicitly, not by stale env values.
- EC-10 scale: every preview receives the bounded sample, independent of production size.
