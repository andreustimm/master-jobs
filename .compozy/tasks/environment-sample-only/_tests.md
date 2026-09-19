# Test Specification: Sample-Only Development and Staging

Canonical test contract for `environment-sample-only`. Derived from
`_user_stories.md` and `_techspec.md`.

## Strategy

- Frameworks: Vitest, disposable database, workflow/config assertions, and the existing isolated E2E harness.
- Fakes: spy/fake HTTP at the adapter boundary only; use real policy and seed composition.
- Execution: `rtk pnpm check`, targeted tests, then E2E/QA for UI or workflow changes.

## Coverage Matrix

| Source | Behavior / edge case | Unit | Integration | E2E |
|---|---|---|---|---|
| US-001 | Fixture reset and sample states | UT-003, UT-004 | IT-001 | E2E-001 |
| US-001.EC-1 invalid input | Unknown fixture profile | UT-003 | — | — |
| US-001.EC-2 empty/missing | Missing DB initializes sample | UT-003 | IT-001 | E2E-001 |
| US-001.EC-3 limits | Bounded payload/size | UT-003 | IT-001 | — |
| US-001.EC-4 permissions | Reset boundary | UT-004 | IT-001 | — |
| US-001.EC-5 concurrency | Concurrent reset | UT-004 | IT-001 | — |
| US-001.EC-6 interruption | Seed retry/rollback | — | IT-001 | — |
| US-001.EC-7 repetition | Idempotent reseed | UT-004 | IT-001 | E2E-001 |
| US-001.EC-8 ordering | Migration before seed | — | IT-001 | E2E-001 |
| US-001.EC-9 state transitions | Reopened fixture preserves application | UT-003 | IT-001 | E2E-001 |
| US-001.EC-10 scale | Bounded repeated staging seed | UT-004 | IT-001 | — |
| US-002 | Environment guard | UT-001, UT-002 | IT-002, IT-003 | — |
| US-002.EC-1 invalid input | Unknown environment fails closed | UT-001 | — | — |
| US-002.EC-2 empty/missing | Missing allowlist fails closed | UT-001 | IT-002 | — |
| US-002.EC-3 limits | Bounded diagnostics | UT-001 | IT-002 | — |
| US-002.EC-4 permissions | Form cannot bypass guard | UT-001 | IT-002 | — |
| US-002.EC-5 concurrency | Blocked calls do not open I/O | UT-002 | IT-002 | — |
| US-002.EC-6 interruption | No partial blocked state | UT-002 | IT-002 | — |
| US-002.EC-7 repetition | Repeated block is side-effect free | UT-002 | IT-002 | — |
| US-002.EC-8 ordering | Guard precedes adapter creation | UT-002 | IT-002 | — |
| US-002.EC-9 state transitions | Staging→production is explicit | UT-001 | IT-003 | — |
| US-002.EC-10 scale | Constant block cost | UT-001 | IT-002 | — |
| US-003 | Workflow/secret safety | UT-001 | IT-003 | E2E-002, E2E-003 |
| US-003.EC-1 invalid input | Malformed workflow env | UT-001 | IT-003 | E2E-003 |
| US-003.EC-2 empty/missing | Missing staging secrets stay fixture-only | UT-001 | IT-003 | E2E-003 |
| US-003.EC-3 limits | Diagnostics redact secrets | UT-002 | IT-003 | E2E-003 |
| US-003.EC-4 permissions | Only production enables recurring run | UT-001 | IT-003 | E2E-003 |
| US-003.EC-5 concurrency | Preview cannot race production | UT-002 | IT-003 | — |
| US-003.EC-6 interruption | Canceled deploy has no staging cron | — | IT-003 | E2E-003 |
| US-003.EC-7 repetition | Redeploy does not duplicate schedule/fixtures | UT-004 | IT-003 | E2E-003 |
| US-003.EC-8 ordering | Seed/migrate precedes UI, ingestion stays off | — | IT-001, IT-003 | E2E-001 |
| US-003.EC-9 state transitions | Promotion changes context explicitly | UT-001 | IT-003 | E2E-003 |
| US-003.EC-10 scale | Preview sample independent of production size | UT-004 | IT-001 | — |

## Unit Tests

- **UT-001** (error/boundary): `canRunIngestion` denies unknown/absent input, dev, staging, preview, local-without-opt-in, and production with `productionAllowlistSatisfied: false`; allows production only when the normalized allowlist result is true.
- **UT-002** (ordering/idempotency): blocked entrypoints do not construct adapters/queues and emit redacted bounded diagnostics on repeat.
- **UT-003** (boundary): fixture seed validates profiles, missing DB
  initialization, workplace/lifecycle coverage supported by the current schema,
  and bounded payloads; archived coverage is asserted after the lifecycle
  migration.
- **UT-004** (idempotency/concurrency): repeated/concurrent seed converges to stable identities and counts.

## Integration Tests

- **IT-001**: migrations plus fixture seed produce the documented small corpus and roll back safely on interruption.
- **IT-002**: dev/staging sync, scrape, recheck, probe, and sweep exit before HTTP/queue creation with no partial state.
- **IT-003**: workflow/config composition allows recurring ingestion only for production and redacts/omits production secrets elsewhere.

## End-to-End Tests

- **E2E-001**: start fixture environment → login candidate/recruiter → browse jobs/history → refresh → no network dependency or overflow.
- **E2E-002**: candidate and recruiter personas use sample data and cannot cross-read each other.
- **E2E-003**: inspect preview/staging deployment contract → attempt blocked ingestion → see safe message and no production secret/schedule.
