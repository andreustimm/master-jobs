# User Stories: Next Backlog Wave

Canonical behavior catalog for the operational and candidate-facing follow-up
work. Companion to `_prd.md`; consumed by `_techspec.md` and `_tests.md`.

## Personas

- **Operator/owner** — runs the private sourcing system and needs reliable
  automation, honest operational documentation, and actionable failures.
- **Candidate** — edits their CV and needs to know whether the ranking refresh
  is pending, running, complete, or failed without seeing another candidate's
  data.
- **Maintainer** — changes adapters and needs fixtures that catch regressions
  before a source can silently poison the corpus.

## Story Index

| ID | Feature Area | Persona | Story |
|---|---|---|---|
| US-001 | Documentation and configuration | Operator | Trust the roadmap and mail configuration contract |
| US-002 | Compozy automation | Operator | Register and schedule a safe daily sweep |
| US-003 | Rescore visibility | Candidate | See the state of my ranking refresh |
| US-004 | Ingestion quality | Maintainer | Prove adapters and sync remain idempotent and isolated |

## Documentation and configuration

### US-001: Trust the operational contract

**As an** operator, **I want** the roadmap, backlog, deployment guide, and
environment example to describe the current implementation, **so that** I can
operate the system without following stale or misleading instructions.

Acceptance criteria:

- AC-1: Given the current repository, when I read the roadmap and product
  backlog, then implemented dashboard, Gmail, `db:seed`, rescore queue, and
  scheduled scan capabilities are marked as delivered or accurately described.
- AC-2: Given a fresh checkout, when I copy the documented Resend variable names,
  then the runtime mailer selects Resend when both required values are present.
- AC-3: Given a repository test run, when the environment contract test runs,
  then it fails if `RESEND_FROM_EMAIL` replaces or contradicts `RESEND_FROM`.

Edge cases:

- EC-1: Missing or blank Resend values → the documented console fallback remains
  expected; no secret is printed or committed.
- EC-2: A stale roadmap statement is found during review → update the status in
  the same change instead of preserving contradictory text.
- EC-3: A local `.env` contains a real key → never read, print, or modify it as
  part of this task.

## Compozy automation

### US-002: Register and schedule a safe daily sweep

**As an** operator, **I want** the validated `job-sweep` loop registered and
scheduled only after a successful manual run, **so that** daily triage happens
without silently changing my application funnel.

Acceptance criteria:

- AC-1: The workspace and loop can be registered idempotently from the runbook.
- AC-2: A manual run reaches a documented terminal state and returns the
  required `status`, `summary`, and `candidates` output fields.
- AC-3: The weekday automation is created only after the manual run evidence is
  recorded.
- AC-4: The loop never executes `jho track` or mutates `application`.

Edge cases:

- EC-1: The daemon is stopped → the runbook reports the prerequisite and does
  not create a partial schedule.
- EC-2: The loop already exists → registration reuses or reports it without a
  duplicate automation job.
- EC-3: A source fails during the sweep → the loop reports the source failure and
  continues according to its contract.
- EC-4: A run is interrupted → no funnel mutation is inferred from an absent
  recommendation.

## Rescore visibility

### US-003: See my ranking refresh state

**As a** candidate, **I want** the candidate page to show my rescore queue
status, **so that** I know whether new CV content is reflected in my ranking.

Acceptance criteria:

- AC-1: After saving a changed CV, the page shows a pending or scoring state on
  the next render.
- AC-2: After processing, the page shows completion and the number of scored
  jobs, or a localized failure state with a safe explanation.
- AC-3: The displayed counts are scoped to the signed-in candidate.
- AC-4: English and Brazilian Portuguese labels come from the i18n dictionary,
  and the component remains usable at 375px portrait, 812px landscape, tablet,
  and desktop widths.

Edge cases:

- EC-1: No queue task exists → show a neutral idle state, not an error.
- EC-2: A task is failed → show failure without exposing raw database errors or
  another user's state.
- EC-3: A candidate has no CV → do not imply that a score is current.
- EC-4: Two candidates have tasks in different states → each session sees only
  its own state.
- EC-5: A stale page is refreshed while a task changes state → the next render
  reflects the database state without client polling assumptions.

## Ingestion quality

### US-004: Prove adapter and sync invariants

**As a** maintainer, **I want** stable adapter fixtures and a sync idempotence
test, **so that** a source change cannot silently duplicate, erase, or block the
rest of the corpus.

Acceptance criteria:

- AC-1: SmartRecruiters and Recruitee fixture payloads pass through the registry
  and produce normalized jobs with stable identity fields.
- AC-2: Running the same fixture twice inserts once and then reports unchanged,
  with the same fingerprint.
- AC-3: A failing source is recorded while a healthy source in the same run
  completes.
- AC-4: No SmartRecruiters or Recruitee handle is added to production config
  without a verified real handle.

Edge cases:

- EC-1: Empty or partial adapter payload → return an empty/nullable normalized
  field without throwing the whole sync.
- EC-2: A source returns an error → isolate the error and preserve other source
  results.
- EC-3: A source returns the same job in a different order → fingerprint and
  idempotence remain stable.
- EC-4: No verified real handle is available → leave the source disabled and
  document the validation command instead of guessing.

