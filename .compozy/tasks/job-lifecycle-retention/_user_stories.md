# User Stories: Job Lifecycle and Application History

Canonical behavior catalog for `job-lifecycle-retention`. Companion to
`_prd.md`; consumed by `_techspec.md` and `_tests.md`.

## Personas

- **Candidate** — owns application decisions and needs durable, private funnel history.
- **Authorized recruiter** — follows only candidates and applications allowed by the existing relationship and session.
- **Operator** — maintains ingestion, retention, and archive routines without losing evidence.

## Story Index

| ID | Feature Area | Persona | Story |
|---|---|---|---|
| US-001 | Candidate history | Candidate | See unique applications and their current/closed job context. |
| US-002 | Recruiter history | Authorized recruiter | See scoped application counts and details without cross-candidate access. |
| US-003 | Archive/reopen | Operator | Preview/apply archive and recover a job when a later probe says alive. |

## Candidate history

### US-001: Candidate application history

**As a** candidate, **I want** to see every application and its funnel status,
**so that** a dead job link does not erase what I sent or what I must do next.

Acceptance criteria:

- AC-1: Given applications in multiple statuses, when the candidate opens history, then unique application counts appear by status.
- AC-2: Given a closed or archived job with an application, when the candidate refreshes history, then the row remains visible with its job state.
- AC-3: Given an application with events, when the candidate opens its detail, then the event timeline and next action are readable.

Edge cases:

- EC-1 invalid input: an unsupported status filter is rejected with a localized validation message.
- EC-2 empty/missing: no applications shows an explicit empty state, not a global count.
- EC-3 limits: a long history paginates without changing the total count.
- EC-4 permissions: candidate A cannot read candidate B's history through a deep link.
- EC-5 concurrency: a new status transition during refresh produces either the old or new consistent snapshot, never a mixed row.
- EC-6 interruption: a failed history request preserves the last safe page and offers retry.
- EC-7 repetition: refreshing does not duplicate applications or events.
- EC-8 ordering: opening a closed job from history does not route to the active board only.
- EC-9 state transitions: archiving the job does not change the application status.
- EC-10 scale: zero, normal, and 100x normal history remain usable with bounded page size.

## Recruiter history

### US-002: Recruiter-scoped application history

**As an** authorized recruiter, **I want** counts and rows for linked candidates,
**so that** I can follow my pipeline without seeing unrelated private data.

Acceptance criteria:

- AC-1: Given a valid recruiter relationship, when the recruiter opens the view, then only linked candidate applications are counted.
- AC-2: Given a closed/archived job in scope, when the recruiter opens the row, then its application history remains available.
- AC-3: Given no relationship, when a recruiter requests another candidate, then the response follows the existing deny/not-found policy and leaks no existence.

Edge cases:

- EC-1 invalid input: malformed candidate identifiers are rejected before a query.
- EC-2 empty/missing: no linked candidates shows an empty state with no global total.
- EC-3 limits: a large linked portfolio paginates and aggregates consistently.
- EC-4 permissions: a recruiter cannot widen scope by changing a URL or form value.
- EC-5 concurrency: relationship removal during a read revokes subsequent pages.
- EC-6 interruption: a failed aggregate does not show partial counts as final.
- EC-7 repetition: repeated reads do not create events or mutate applications.
- EC-8 ordering: a deep link cannot bypass page authorization.
- EC-9 state transitions: a job archive is visible as job state, not as an application status change.
- EC-10 scale: aggregation remains bounded by the authorized scope, not the global corpus.

## Archive and reopen

### US-003: Safe archive and reopen

**As an** operator, **I want** a dry-run and idempotent archive routine,
**so that** old closed jobs leave the active board while application evidence
remains intact.

Acceptance criteria:

- AC-1: Given a confirmed closed job older than the cutoff and no application, when the operator runs dry-run, then the candidate count is reported and no row changes.
- AC-2: Given a confirmed closed job with an application, when archive is applied, then `archived_at` may be set but the job, application, document, and events remain.
- AC-3: Given an `alive` observation after archive, when verification completes, then the job is reopened without a duplicate fingerprint or application.
- AC-4: Given an inconclusive probe or partial source failure, when archive runs, then the job is not newly closed or archived.

Edge cases:

- EC-1 invalid input: negative/invalid cutoff is rejected before mutation.
- EC-2 empty/missing: no eligible rows produces a zero-change report.
- EC-3 limits: batch limits prevent unbounded memory use and report continuation.
- EC-4 permissions: only an operator with the existing maintenance permission can apply archive.
- EC-5 concurrency: two archive workers cannot claim the same row for conflicting writes.
- EC-6 interruption: a process restart leaves a transaction either committed or rolled back.
- EC-7 repetition: applying the same archive twice is a no-op on the second run.
- EC-8 ordering: a source reconciliation must finish before its closure can be archived.
- EC-9 state transitions: re-opening clears automatic archive without changing application status.
- EC-10 scale: a large corpus is processed in pages with stable totals.
