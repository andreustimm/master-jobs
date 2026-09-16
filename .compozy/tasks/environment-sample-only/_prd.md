## Overview

Remote development and staging environments should validate product behavior,
not mirror the production crawler. Real sync, downloads, scraping, rechecks,
and new-job searches make those environments expensive, nondeterministic, and
unsafe. This feature gives them small synthetic fixtures and fail-closed guards
while keeping local diagnostic sync explicitly opt-in.

## Goals

- Dev and staging contain only small, representative, non-production data.
- UI, scoring, lifecycle, authorization, and reports run against fixtures with
  no public-source network call.
- Scheduler and core use cases reject ingestion outside an explicitly allowed
  production context.
- Fixture reset is deterministic, idempotent, and safe to run repeatedly.
- Previews and staging never receive production database URLs or credentials.

## User Stories

The canonical stories and edge cases are in [_user_stories.md](_user_stories.md).

- US-001: predictable sample environment.
- US-002: fail-closed ingestion guard.
- US-003: QA and release safety.

## Core Features

### Sample data set

Provide a small fixture corpus covering remote, hybrid, onsite, and unknown
workplace type; open, closed, archived, and reopened jobs; application statuses;
events; and two isolated candidate/recruiter personas. Fixtures contain no real
PII or raw scrape payloads.

### Ingestion guard

Block sync, scrape, recheck, probes, downloads, Compozy sweep, and automatic
new-job search in dev/staging. The guard runs in the scheduler and in the core
use case before an adapter or queue is opened. Local remains blocked by default
and permits explicit diagnostic opt-in.

### Release and secret boundary

Cron/Actions accept ingestion only in production. Preview/staging deployments
do not receive production Turso/Supabase URLs, migration credentials, auth
tokens, or production cron secrets.

## Business Rules

1. `dev` and `staging` remote databases use fixtures/mocks only.
2. Production is the only environment allowed to run recurring ingestion.
3. Local diagnostic ingestion requires explicit opt-in and is never a source for
   dev/staging data.
4. A blocked network routine fails clearly before resolving an adapter or
   creating a scrape/recheck task.
5. Read-only commands continue to work against fixtures.
6. The fixture seed is idempotent and contains no production dump, secret, CV,
   email, phone, or raw external payload.
7. The first Supabase project uses only `production`; dev/staging use bounded
   fixtures in isolated PostgreSQL instances rather than extra remote schemas.
8. Expected blocks are observable as aggregate environment events without
   logging URLs, descriptions, or PII.

## User Experience

Developers can reset staging/dev to a known sample and immediately inspect all
product states. A mistaken attempt to run sync receives a clear environment
message and a safe next step. QA sees stable lists and personas even while all
external sources are unavailable.

## High-Level Technical Constraints

- Preserve the existing adapter, queue, auth, and scheduler boundaries.
- Use the isolated local PostgreSQL instance through `DATABASE_URL`; use
  `DATABASE_MIGRATION_URL` only for migrations. The legacy SQLite snapshot is
  outside the runtime and may be used only by a test/import harness that
  explicitly supports it.
- Use existing test harnesses and fakes at I/O boundaries only.
- Do not copy production data or secrets into tracked fixtures or previews.
- Do not create a second database solely for raw payloads.

## Non-Goals (Out of Scope)

- Simulating every public board or its current availability.
- Running a reduced real sync in staging.
- Creating `dev`/`staging` schemas in the production Supabase project.
- Blocking unrelated application HTTP such as test doubles or login flows.

## Architecture Decision Records

- [ADR-001: Fixtures and fail-closed ingestion](adrs/adr-001.md)
- [ADR-0021: Non-production environments use synthetic data](../../../docs/adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md)

## Open Questions

- Should the fixture seed be reset on every staging deploy or only on demand?
- Which production canary, if any, will be the one controlled exception for
  verifying source connectivity after the first release?
