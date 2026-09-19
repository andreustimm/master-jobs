# Test Specification: Job Lifecycle and Application History

Canonical test contract for `job-lifecycle-retention`. Derived from
`_user_stories.md` and `_techspec.md`.

## Strategy

- Frameworks: Vitest, disposable Drizzle databases, and the existing isolated browser E2E harness.
- I/O fakes: fake HTTP only at source/probe boundaries; use real repositories and auth composition in integration tests.
- Execution: `rtk pnpm check`, targeted Vitest, then `rtk pnpm test:e2e` and QA targeted when UI changes.
- Conventions: one observable behavior per case; tag unit cases by class; use deterministic timestamps and idempotent fixtures.

## Coverage Matrix

| Source | Behavior / edge case | Unit | Integration | E2E |
|---|---|---|---|---|
| US-001 | Candidate counts and history | UT-005, UT-006 | IT-003 | E2E-001 |
| US-001.EC-1 invalid input | Unsupported status filter | UT-006 | — | — |
| US-001.EC-2 empty/missing | Empty state | — | IT-003 | E2E-001 |
| US-001.EC-3 limits | Pagination preserves total | — | IT-003 | E2E-001 |
| US-001.EC-4 permissions | Candidate isolation | UT-006 | — | E2E-001 |
| US-001.EC-5 concurrency | Consistent snapshot | UT-005 | IT-003 | — |
| US-001.EC-6 interruption | Retry after read failure | — | IT-003 | E2E-001 |
| US-001.EC-7 repetition | Refresh is idempotent | UT-005 | IT-003 | E2E-001 |
| US-001.EC-8 ordering | Closed-job deep link | — | IT-003 | E2E-001 |
| US-001.EC-9 state transitions | Archive does not alter application | UT-005 | IT-001 | E2E-001 |
| US-001.EC-10 scale | Bounded page size | — | IT-003 | — |
| US-002 | Recruiter scoped history | UT-007 | IT-004 | E2E-002 |
| US-002.EC-1 invalid input | Malformed candidate id | UT-007 | IT-004 | — |
| US-002.EC-2 empty/missing | No linked candidates | — | IT-004 | E2E-002 |
| US-002.EC-3 limits | Scoped pagination | — | IT-004 | E2E-002 |
| US-002.EC-4 permissions | URL/form cannot widen scope | UT-007 | IT-004 | E2E-002 |
| US-002.EC-5 concurrency | Relationship removal | UT-007 | IT-004 | — |
| US-002.EC-6 interruption | Partial aggregate not final | — | IT-004 | E2E-002 |
| US-002.EC-7 repetition | Read has no mutation | UT-007 | IT-004 | — |
| US-002.EC-8 ordering | Deep-link guard | UT-007 | — | E2E-002 |
| US-002.EC-9 state transitions | Closed job remains a job state | UT-005 | IT-004 | E2E-002 |
| US-002.EC-10 scale | Scope bounds query | UT-007 | IT-004 | — |
| US-003 | Archive/reopen flow | UT-001–UT-004, UT-008 | IT-001, IT-002, IT-005 | E2E-003 |
| US-003.EC-1 invalid input | Invalid cutoff | UT-008 | IT-001 | E2E-003 |
| US-003.EC-2 empty/missing | Zero-change report | UT-001 | IT-001 | E2E-003 |
| US-003.EC-3 limits | Batch limit | UT-008 | IT-001 | — |
| US-003.EC-4 permissions | Maintenance permission | UT-008 | IT-001 | E2E-003 |
| US-003.EC-5 concurrency | Competing archive workers | UT-004 | IT-005 | — |
| US-003.EC-6 interruption | Transaction rollback | — | IT-005 | — |
| US-003.EC-7 repetition | Apply twice is no-op | UT-004 | IT-005 | E2E-003 |
| US-003.EC-8 ordering | Reconcile before archive | UT-003 | IT-001 | — |
| US-003.EC-9 state transitions | Alive reopens | UT-004 | IT-005 | E2E-003 |
| US-003.EC-10 scale | Stable paged totals | — | IT-001 | — |

## Unit Tests

- **UT-001** (boundary): `decideArchive` keeps an open or below-cutoff job.
- **UT-002** (state): `decideArchive` archives an old confirmed closed job without an application.
- **UT-003** (error): inconclusive probe/source state produces `keep`, never archive.
- **UT-004** (idempotency): alive/replay clears automatic archive once and preserves identity.
- **UT-005** (concurrency): application count uses unique rows and archive never changes application state.
- **UT-006** (error): candidate history rejects unsupported filter and foreign candidate scope.
- **UT-007** (permissions): recruiter query rejects malformed/unlinked candidate scope and bounds aggregation.
- **UT-008** (error): CLI rejects invalid cutoff/permission and dry-run defaults to no mutation.

## Integration Tests

- **IT-001**: apply migration and archive batch against a disposable database; expect correct counts, field writes, and no application mutation.
- **IT-002**: run archive and existing prune together; expect jobs with applications preserved and unreferenced old jobs eligible only for prune.
- **IT-003**: candidate history query returns closed/archived jobs, events, pagination, and empty/error states for the session candidate.
- **IT-004**: recruiter history resolves relationships before aggregation and prevents cross-scope rows.
- **IT-005**: concurrent/replayed archive and alive transitions commit atomically or roll back without duplicate fingerprints/events.

## End-to-End Tests

- **E2E-001**: candidate login → open history → filter/status count → open archived-job application → refresh → row remains visible.
- **E2E-002**: recruiter login → open scoped history → inspect linked candidate → attempt unlinked deep link → denial/empty policy with no leakage.
- **E2E-003**: operator runs archive dry-run/apply against fixture → sees aggregate result → repeats command → sees no duplicate mutation.
