# User Stories: Administered Job Platforms, Hybrid Search, Verification, and Analysis

Canonical behavior catalog for the platform catalog and hybrid-search feature.
Companion to `_prd.md`; consumed by `_techspec.md` and `_tests.md`.

## Personas

- **Administrator** — maintains supported sources and operates captures and
  verification runs.
- **Candidate** — searches and evaluates jobs before deciding whether to apply.
- **Recruiter** — reads and searches jobs within existing authorization.

## Story Index

| ID | Feature Area | Persona | Story |
|---|---|---|---|
| US-001 | Catalog | Administrator | View source definitions and health |
| US-002 | Catalog | Administrator | Add a supported platform handle |
| US-003 | Catalog | Administrator | Edit, enable, disable, and retire a source |
| US-004 | Catalog | Administrator | Probe a source before saving or enabling |
| US-005 | Catalog | Administrator | See capability and configuration validation |
| US-006 | Permissions | Candidate/Recruiter | Be prevented from operating the catalog |
| US-007 | Capture | Administrator | Capture one platform |
| US-008 | Capture | Administrator | Capture all enabled platforms |
| US-009 | Capture | Administrator | Observe progress and affected counts |
| US-010 | Capture | Administrator | Retry a failed or partial source |
| US-011 | Capture | Administrator | Repeat a capture safely |
| US-012 | Verification | Administrator | Refresh one or all source statuses |
| US-013 | Verification | Administrator | Distinguish closed from inconclusive |
| US-014 | Verification | Candidate/Recruiter | See current availability and reason |
| US-015 | Lifecycle | Administrator | Reopen a job proved alive later |
| US-016 | Lifecycle | Candidate | Keep application history after closure |
| US-017 | Search | Candidate/Recruiter | Search title, company, and description |
| US-018 | Search | Candidate/Recruiter | Find close wording and spelling variants |
| US-019 | Search | Candidate/Recruiter | Combine search with exact filters |
| US-020 | Search | Candidate/Recruiter | Use semantic ordering when available |
| US-021 | Search | Candidate/Recruiter | Understand why a result matched |
| US-022 | Analysis | Candidate | Request analysis for a visible job |
| US-023 | Analysis | Candidate | Read structured analysis and evidence |
| US-024 | Analysis | Administrator | Inspect analysis versions and failures |
| US-025 | Analysis | Administrator | Retry an analysis without duplicate output |
| US-026 | Analysis | Candidate/Admin | Handle missing or ambiguous fields safely |
| US-027 | Resilience | Administrator | Operate safely after interruption |
| US-028 | Resilience | Administrator | Respect concurrency and idempotency |
| US-029 | Permissions | Administrator | Keep impersonation from mutating operations |
| US-030 | Scale | Administrator | Operate the catalog at source/job scale |
| US-031 | Audit | Administrator | Review an immutable operational history |

## Catalog and Permissions

### US-001: View source definitions and health

**As an** administrator, **I want** to see supported platforms, handles,
capabilities, enabled state, last run, and health, **so that** I know what the
portal can currently ingest.

Acceptance criteria:

- AC-1: Given an authenticated admin, when the catalog opens, then each
  registered source is shown with its adapter kind, handle, enabled state,
  last status, and last-run timestamp.
- AC-2: Given a source with a failed or inconclusive run, when the admin opens
  its details, then the error classification and retry action are visible.

Edge cases:

- EC-1 (empty): no sources configured → the page explains how to register a
  supported adapter and shows no fake health data.
- EC-2 (permissions): candidate or recruiter opens the route → access is
  denied without exposing source configuration.
- EC-3 (interruption): health fetch fails → the page reports stale data and
  offers retry rather than clearing the last known status.

### US-002: Add a supported platform handle

**As an** administrator, **I want** to register a supported adapter and handle,
**so that** its public jobs can be captured without a code change per handle.

Acceptance criteria:

- AC-1: Given a registered adapter kind and valid handle, when the admin saves,
  then a disabled or enabled source row is created according to the form choice.
- AC-2: Given a duplicate kind/handle, when the admin saves, then the form is
  rejected with a clear duplicate message and no second source is created.

Edge cases:

- EC-1 (invalid): malformed handle or unsupported kind → reject before any
  network request or database write.
- EC-2 (secrets): an admin enters a secret value instead of a secret reference
  → reject and do not log or persist the value.
- EC-3 (limits): an overlong label or handle → reject with the configured
  maximum and preserve the form for correction.

### US-003: Edit, enable, disable, and retire a source

**As an** administrator, **I want** to change a source's settings or disable
it, **so that** bad or temporary platforms do not run globally.

Acceptance criteria:

- AC-1: Given an enabled source, when the admin disables it, then future
  all-platform runs skip it while its jobs and history remain readable.
- AC-2: Given a retired source, when the admin views history, then prior runs
  and jobs remain available and the row is marked retired rather than deleted.

Edge cases:

- EC-1 (concurrency): disable races with a queued run → the run records that
  the source was skipped or cancelled; it does not start new work afterward.
- EC-2 (state): editing while a run is active → changes apply to the next run
  and the active run keeps its captured configuration snapshot.

### US-004: Probe a source before saving or enabling

**As an** administrator, **I want** to probe a handle, **so that** I can find
out whether the adapter can reach and parse it before spending a full run.

Acceptance criteria:

- AC-1: Given a supported handle, when the admin probes it, then the UI reports
  reachable, parseable, empty, blocked, or failed with a bounded diagnostic.
- AC-2: A probe does not create jobs, close jobs, or change an application.

Edge cases:

- EC-1 (blocked): 401/403/429 → report blocked/inconclusive, never “empty”.
- EC-2 (network): timeout or 5xx → report retryable failure and leave catalog
  health unchanged.

### US-005: See capability and configuration validation

**As an** administrator, **I want** to see what an adapter supports, **so that**
I know whether a handle can search, snapshot, verify, or report status reasons.

Acceptance criteria:

- AC-1: The source form lists adapter capabilities and required configuration.
- AC-2: An unsupported operation is disabled with an explanation, not sent as
  a best-effort request.

Edge cases:

- EC-1 (missing): adapter capability metadata is unavailable → the operation
  is conservatively unavailable and the source remains usable for supported
  operations.

### US-006: Be prevented from operating the catalog

**As a** candidate or recruiter, **I want** the admin controls hidden and
protected, **so that** I cannot alter the ingestion system.

Acceptance criteria:

- AC-1: Given a non-admin session, when the user deep-links to an admin action,
  then authorization denies before any source read/write side effect.
- AC-2: The regular job board remains searchable for the permitted user.

Edge cases:

- EC-1 (expired): an expired session → redirect to login without revealing
  whether the source exists.
- EC-2 (impersonation): an impersonated admin session → all catalog mutations
  are denied.

## Capture Operations

### US-007: Capture one platform

**As an** administrator, **I want** to start a capture for one platform, **so
that** I can refresh it without waiting for every source.

Acceptance criteria:

- AC-1: Clicking **Buscar agora** creates a queued run and returns a run detail
  view without waiting for network completion.
- AC-2: On success, normalized jobs are upserted and the run reports counts.

Edge cases:

- EC-1 (disabled): disabled source → action is rejected with no run.
- EC-2 (empty): valid source returns zero records → run succeeds with zero
  fetched and does not close existing jobs unless it was a complete snapshot.

### US-008: Capture all enabled platforms

**As an** administrator, **I want** to start one run for all enabled platforms,
**so that** I can refresh the corpus from one control.

Acceptance criteria:

- AC-1: The aggregate run enumerates the enabled source snapshot and exposes
  per-source child results.
- AC-2: One source failure does not hide successful results from other sources;
  the aggregate state is partial or failed with clear counts.

Edge cases:

- EC-1 (ordering): a source is disabled after the run starts → the captured
  source snapshot determines whether it runs; the next run reflects the change.
- EC-2 (scale): many enabled sources → bounded concurrency prevents request
  storms and reports queued work.

### US-009: Observe progress and affected counts

**As an** administrator, **I want** progress and counts, **so that** I can tell
whether a run is still working and what changed.

Acceptance criteria:

- AC-1: The run shows queued/running/succeeded/partial/failed/cancelled and
  fetched/new/updated/unchanged/closed/inconclusive counts.
- AC-2: Refreshing the page preserves the same run and current progress.

Edge cases:

- EC-1 (interruption): browser closes → the run continues or is marked
  interrupted by the worker; the next view explains the state.
- EC-2 (missing): a source does not return counts → the UI shows unknown, not
  zero.

### US-010: Retry a failed or partial source

**As an** administrator, **I want** to retry only the failed or inconclusive
source, **so that** a transient outage does not require a global run.

Acceptance criteria:

- AC-1: Retry creates a linked attempt with the captured source configuration.
- AC-2: A successful retry updates health and leaves the original failure in
  history.

Edge cases:

- EC-1 (repetition): retry while an equivalent attempt is active → return that
  attempt rather than enqueueing a duplicate.
- EC-2 (permissions): non-admin retry → denied with no queue message.

### US-011: Repeat a capture safely

**As an** administrator, **I want** repeated clicks or webhook replays to be
safe, **so that** the same jobs are not duplicated.

Acceptance criteria:

- AC-1: Equivalent queued/running requests resolve to one run by idempotency
  key.
- AC-2: Replayed adapter records upsert by the existing fingerprint/source key.

Edge cases:

- EC-1 (replay): the same completion message arrives twice → counts and job
  rows remain unchanged after the first application.
- EC-2 (stale): a late run result cannot overwrite a newer source health state
  without recording its timestamp/order.

## Verification and Lifecycle

### US-012: Refresh one or all source statuses

**As an** administrator, **I want** to refresh availability for one source or
all due jobs, **so that** stale listings are identified before I apply.

Acceptance criteria:

- AC-1: The admin can choose a source, selection, or all due jobs and start a
  queued verification run.
- AC-2: The run shows checked/alive/closed/inconclusive/error counts.

Edge cases:

- EC-1 (empty): no due jobs → run succeeds with zero checked and explains why.
- EC-2 (scale): large corpus → checks are bounded and resumable.

### US-013: Distinguish closed from inconclusive

**As an** administrator, **I want** the result to explain why a job was or was
not closed, **so that** a block is not mistaken for a vacancy disappearing.

Acceptance criteria:

- AC-1: 404/410 or explicit adapter evidence marks a job closed with evidence.
- AC-2: 401/403/429/5xx/timeout/network marks the check inconclusive and keeps
  the job open.

Edge cases:

- EC-1 (ambiguous): a page loads but contains no status signal → keep open and
  mark unknown/inconclusive.
- EC-2 (interruption): verification stops mid-run → unchecked jobs keep their
  previous state.

### US-014: See current availability and reason

**As a** candidate or recruiter, **I want** job availability and its last check
shown clearly, **so that** I can decide whether to investigate or apply.

Acceptance criteria:

- AC-1: A job card shows open/closed/paused/filled/cancelled/unknown only when
  supported by persisted evidence, with the last checked time.
- AC-2: A closed job remains visible in history and clearly cannot be confused
  with a currently open result.

Edge cases:

- EC-1 (stale): old check beyond the freshness window → show stale and avoid
  claiming current availability.
- EC-2 (missing): no check has run → show unknown, not open or closed.

### US-015: Reopen a job proved alive later

**As an** administrator, **I want** an alive result to reopen a previously
closed job, **so that** a transient 404 or restored posting does not erase it.

Acceptance criteria:

- AC-1: A confirmed alive result changes the current state to open and records
  the prior closure event.
- AC-2: Existing applications remain linked and their history is unchanged.

Edge cases:

- EC-1 (race): close and alive results arrive out of order → event ordering and
  check timestamps decide the current state deterministically.

### US-016: Keep application history after closure

**As a** candidate, **I want** a job I applied to to remain in my history even
after it closes, **so that** I know where and how often I applied.

Acceptance criteria:

- AC-1: Closing or archiving a job never deletes its application relationship.
- AC-2: The candidate funnel can distinguish applied-to-closed from never
  applied.

Edge cases:

- EC-1 (retention): pruning a closed job with an application → retain it and
  retain the application.

## Search

### US-017: Search title, company, and description

**As a** candidate or recruiter, **I want** my query to search the description
as well as title and company, **so that** useful responsibilities and skills are
discoverable.

Acceptance criteria:

- AC-1: A query matches normalized description text and identifies the matching
  field in the result explanation.
- AC-2: Existing source, work-mode, location, status, and fit filters still
  restrict results exactly.

Edge cases:

- EC-1 (empty): blank or whitespace query → the board uses its normal default
  ordering and filters without a full-text error.
- EC-2 (invalid): malformed query syntax → treat it as safe plain text and
  show results or an actionable validation message.

### US-018: Find close wording and spelling variants

**As a** candidate, **I want** close terms such as `Techlead` and `Tech Lead`
to be discoverable, **so that** wording differences do not hide a relevant job.

Acceptance criteria:

- AC-1: A proximity-capable query returns close variants when they pass the
  exact filters.
- AC-2: A result explains that proximity contributed to its ordering.

Edge cases:

- EC-1 (false positive): a low-similarity token → it does not outrank a strong
  exact match solely because of proximity.
- EC-2 (scale): the proximity index is unavailable → lexical search continues
  and the UI does not claim proximity was used.

### US-019: Combine search with exact filters

**As a** candidate, **I want** to combine a description query with remote,
hybrid, or onsite and other filters, **so that** relevance never violates my
constraints.

Acceptance criteria:

- AC-1: A remote filter excludes a job whose persisted work mode is onsite,
  regardless of semantic similarity.
- AC-2: Filter state survives refresh and is represented in the shareable URL.

Edge cases:

- EC-1 (missing): work mode unknown → it does not satisfy an exact remote-only
  filter and is labeled unknown according to existing filter semantics.

### US-020: Use semantic ordering when available

**As a** candidate, **I want** semantically related descriptions to appear near
my query, **so that** I can discover roles that use different vocabulary.

Acceptance criteria:

- AC-1: With a current embedding, semantically related jobs can improve the
  relevance order after exact filters are applied.
- AC-2: Without a vector or provider, the same query returns lexical/proximity
  results with no semantic claim.

Edge cases:

- EC-1 (failure): embedding generation fails → search remains available and
  reports the missing semantic signal operationally.
- EC-2 (stale): model version changes → old vectors are not silently compared
  as if they were the new model.

### US-021: Understand why a result matched

**As a** candidate or recruiter, **I want** a concise match explanation, **so
that** I can trust and evaluate the result.

Acceptance criteria:

- AC-1: The result identifies title/company/description, proximity, or semantic
  signals that actually contributed.
- AC-2: Explanation never exposes hidden prompts, API keys, or unsupported
  claims.

Edge cases:

- EC-1 (missing): only a weak or unknown signal exists → label it honestly and
  do not fabricate an explanation.

## Analysis

### US-022: Request analysis for a visible job

**As a** candidate, **I want** to request an analysis for a job I can read, **so
that** I can understand its structure before deciding to apply.

Acceptance criteria:

- AC-1: An authenticated user with job-read permission can enqueue one analysis
  and sees a pending state.
- AC-2: The action does not change application, profile, or fit-score state.

Edge cases:

- EC-1 (permissions): inaccessible job or unauthenticated request → denied
  without revealing analysis existence.
- EC-2 (repetition): duplicate click while pending → one pending analysis.

### US-023: Read structured analysis and evidence

**As a** candidate, **I want** structured fields, unknowns, confidence, and
evidence, **so that** I can judge the result rather than trust a summary blindly.

Acceptance criteria:

- AC-1: Completed analysis shows role, seniority, mode/location, compensation,
  skills, responsibilities, risks, unknowns, evidence, model, and version.
- AC-2: A missing field is shown as unknown and never filled by invention.

Edge cases:

- EC-1 (partial): provider returns only some fields → completed partial result
  labels the rest unknown and preserves valid evidence.
- EC-2 (stale): job text changed after analysis → UI shows the analyzed job
  revision and offers a new analysis.

### US-024: Inspect analysis versions and failures

**As an** administrator, **I want** to inspect prompt/schema versions, model
metadata, failures, and bounded cost metadata, **so that** I can operate the
feature responsibly.

Acceptance criteria:

- AC-1: Admin can see active and historical versions and each run's status.
- AC-2: Secrets and raw provider payloads are never displayed or persisted.

Edge cases:

- EC-1 (permissions): candidate requests operational metadata → only the
  candidate-visible analysis is returned.

### US-025: Retry an analysis without duplicate output

**As an** administrator, **I want** to retry a failed analysis, **so that** a
transient provider failure can recover while preserving the failed attempt.

Acceptance criteria:

- AC-1: Retry creates a linked attempt with a new timestamp and the same input
  revision unless explicitly reanalyzed after a job change.
- AC-2: The latest successful result is clearly distinguished from prior
  failures.

Edge cases:

- EC-1 (quota): provider quota is exhausted → run is paused/retryable and the
  job remains searchable.
- EC-2 (concurrency): two retries race → one active attempt wins by idempotency.

### US-026: Handle missing or ambiguous fields safely

**As a** candidate or administrator, **I want** ambiguous job fields marked
unknown, **so that** an analysis does not turn inference into false evidence.

Acceptance criteria:

- AC-1: Every field is classified as explicit evidence, normalized inference,
  or unknown.
- AC-2: Unsupported fields are omitted or unknown rather than guessed.

Edge cases:

- EC-1 (contradiction): source contains conflicting location/mode statements →
  show conflict and evidence, not an arbitrary single fact.

## Resilience, Scale, and Audit

### US-027: Operate safely after interruption

**As an** administrator, **I want** runs to resume or report interruption, **so
that** a browser or worker restart does not silently lose work.

Acceptance criteria:

- AC-1: A worker restart leaves each run in a recoverable state with completed
  items retained.
- AC-2: The UI offers resume/retry when a run is recoverable.

Edge cases:

- EC-1 (partial): process dies after upsert but before acknowledgement → replay
  is idempotent and does not duplicate the job.

### US-028: Respect concurrency and idempotency

**As an** administrator, **I want** concurrent triggers bounded and idempotent,
**so that** a busy source is not overloaded.

Acceptance criteria:

- AC-1: Source and global runs reserve concurrency before awaiting network work.
- AC-2: A source cannot have two equivalent active captures or verification
  loops at the same time.

Edge cases:

- EC-1 (limit): concurrency quota reached → work remains queued with a visible
  reason instead of being dropped.

### US-029: Keep impersonation from mutating operations

**As an** administrator, **I want** borrowed sessions to remain read-only for
operations, **so that** impersonation cannot trigger or alter ingestion.

Acceptance criteria:

- AC-1: An impersonated session can see only the same permitted job views and
  cannot mutate sources, runs, statuses, or analyses.

Edge cases:

- EC-1 (deep link): direct action URL under impersonation → denied before queue
  or database mutation.

### US-030: Operate the catalog at source/job scale

**As an** administrator, **I want** pagination, bounded lists, and resumable
runs, **so that** the portal remains usable as the corpus grows.

Acceptance criteria:

- AC-1: Catalog, run history, and job results paginate without loading the full
  corpus into the browser.
- AC-2: A run has bounded work and reports a resumable cursor/checkpoint.

Edge cases:

- EC-1 (zero): zero jobs or sources → useful empty states and successful no-op
  runs.
- EC-2 (100x): high volume → response time remains bounded by pagination and
  worker limits, not browser memory.

### US-031: Review an immutable operational history

**As an** administrator, **I want** source, capture, verification, and analysis
events retained, **so that** I can explain changes in the corpus.

Acceptance criteria:

- AC-1: Each run records actor, scope, configuration/model versions, timestamps,
  status, counts, and bounded errors.
- AC-2: History rows cannot be edited to hide a prior attempt.

Edge cases:

- EC-1 (PII): error logging includes a URL with personal data → redaction rules
  remove secrets and unrelated personal fields before persistence.
