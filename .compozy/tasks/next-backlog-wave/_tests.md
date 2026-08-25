# Test Specification: Next Backlog Wave

Canonical test contract for the maintenance and visibility follow-up.

## Strategy

- Frameworks: Vitest with the existing libSQL test database and `fixtureHttp`;
  Playwright isolated E2E for public UI; Compozy CLI validation for operations.
- Fakes: only HTTP and environment boundaries; database integration uses the
  existing temporary test database.
- Execution: targeted tests during each task, then `pnpm check` and applicable
  E2E before the PR.

## Coverage Matrix

| Source | Behavior | Unit | Integration | E2E |
|---|---|---|---|---|
| US-001 | truthful docs and sender contract | UT-001, UT-002 | IT-001 | — |
| US-001.EC-1/EC-3 | missing values and secret hygiene | UT-003 | — | — |
| US-002 | safe loop activation | — | IT-002, IT-003 | — |
| US-002.EC-1/EC-2/EC-3/EC-4 | daemon/idempotence/failure/no mutation | — | IT-004 | — |
| US-003 | candidate queue snapshot | UT-004, UT-005, UT-006 | IT-005 | E2E-001 |
| US-003.EC-1/EC-2/EC-3/EC-4/EC-5 | idle/error/isolation/refresh | UT-007, UT-008 | — | E2E-002 |
| US-004 | adapter normalization and sync | UT-009, UT-010 | IT-006, IT-007 | — |
| US-004.EC-1/EC-2/EC-3/EC-4 | partial/error/order/no-handle | UT-011, UT-012 | IT-008 | — |

## Unit Tests

- **UT-001** (contract): parse the tracked `.env.example` and assert it names
  `RESEND_API_KEY` and `RESEND_FROM`, not `RESEND_FROM_EMAIL`.
- **UT-002** (contract): `configuredMailer({RESEND_API_KEY, RESEND_FROM})` returns
  the Resend mailer while the same key with the legacy sender name falls back to
  the console mailer.
- **UT-003** (error): blank or absent sender/key values select the console mailer
  without printing a secret.
- **UT-004** (happy): `candidateScoreQueueStatus(id)` maps a pending row to a
  snapshot with `pending: 1` and no raw error.
- **UT-005** (state): scoring, done, and failed rows map to their respective
  counts and preserve `scored`/safe error metadata.
- **UT-006** (isolation): a snapshot for candidate A never includes candidate B's
  queue row.
- **UT-007** (boundary): no row returns the explicit idle/null state.
- **UT-008** (error): raw `lastError` content is not rendered by the UI status
  mapper; it yields the localized generic failure state.
- **UT-009** (happy): SmartRecruiters fixture through `getAdapter` yields a
  normalized title, URL, location, and null body where the API omits it.
- **UT-010** (happy): Recruitee fixture through `getAdapter` joins description
  and requirements and preserves the apply URL.
- **UT-011** (boundary): partial/empty adapter payload produces nullable fields
  or an empty result without throwing.
- **UT-012** (ordering): equivalent job payloads in different order produce the
  same normalized fingerprint inputs.

## Integration Tests

- **IT-001**: documentation/config contract check finds no contradictory Resend
  variable in `.env.example` and deployment docs.
- **IT-002**: `compozy tasks validate --name next-backlog-wave` accepts the task
  graph and loop YAML validation succeeds.
- **IT-003**: the loop runbook contains the ordered daemon → workspace → loop →
  manual run → schedule sequence and the no-`jho track` invariant.
- **IT-004**: an unavailable/duplicate daemon or existing loop is reported as an
  operational prerequisite/idempotent reuse, not a second schedule.
- **IT-005**: candidate page wiring obtains the session candidate id and renders
  the candidate-scoped queue snapshot through dictionary labels.
- **IT-006**: `syncAll` with a SmartRecruiters or Recruitee fixture inserts one
  normalized job and records source health.
- **IT-007**: running the same fixture twice produces one insert then unchanged
  and keeps the fingerprint stable.
- **IT-008**: one failing source and one healthy source complete in the same
  `syncAll` run, with the failure isolated in source status.

## End-to-End Tests

- **E2E-001**: authenticated candidate saves a changed CV, revisits the candidate
  page, and sees pending/scoring or completion status in the selected locale.
- **E2E-002**: candidate page at 375px portrait and 812px landscape shows idle and
  failed queue states without horizontal overflow or untranslated literal keys.
