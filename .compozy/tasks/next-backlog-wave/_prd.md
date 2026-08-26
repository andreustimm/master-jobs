# Next Backlog Wave

## Overview

The current product is deployed and the original Compozy feature epics are
archived, but the remaining follow-up work is split between stale documentation,
an unregistered automation loop, an invisible ranking-refresh queue, and
incomplete ingestion regression coverage. This workflow gives the operator a
truthful source of instructions, makes the daily sweep safe to operate, shows a
candidate what is happening to their ranking, and protects adapter boundaries
without inventing source handles or committing credentials.

## Goals

- The roadmap, backlog, deployment guide, and environment example describe what
  the repository actually does today.
- Resend configuration uses one canonical sender variable and fails visibly to
  the documented console fallback when it is absent.
- The validated Compozy `job-sweep` loop is registered, manually verified, and
  scheduled with an auditable runbook while preserving the no-funnel-mutation
  invariant.
- A candidate can see their own rescore queue state and result in both supported
  locales and on the supported viewport classes.
- Adapter fixtures and sync integration tests prove normalization, stable
  fingerprints, idempotence, and source-failure isolation.

## User Stories

See [_user_stories.md](_user_stories.md): US-001 through US-004.

## Core Features

### 1. Truthful operations documentation and environment contract

Reconcile stale roadmap/backlog claims with the current dashboard, Gmail,
`db:seed`, scheduled scan, and rescore queue implementation. Use `RESEND_FROM`
consistently and add a regression test. Real secret values remain operator-owned
and outside version control.

### 2. Safe Compozy sweep activation

Document and execute the registration sequence for the existing loop: daemon,
workspace, loop, manual run, evidence, then weekday automation. The loop may
sync, score, and recommend; it must not mutate application decisions.

### 3. Candidate-scoped rescore status

Expose a read-only, candidate-scoped status from the existing score queue and
render pending, scoring, done, failed, and idle states through the existing
server-rendered candidate page and i18n system.

### 4. Adapter and sync regression coverage

Add fixture-driven coverage at the registry and sync boundaries for
SmartRecruiters/Recruitee and stable fingerprint/idempotence behavior. Keep
unverified real handles out of `config/sources.yaml`; document the probe command
as the manual follow-up.

## Business Rules

- Queue state is private to the candidate identified by the authenticated
  session; no global queue count may be rendered on a candidate page.
- `RESEND_API_KEY` and `RESEND_FROM` are the only runtime mail variables. No
  secret value may be added to tracked files or logs.
- Compozy automation must not call `jho track` or write `application`.
- A source failure is isolated; a missing source body is not converted into
  invented content.
- Re-running an identical fixture is idempotent and preserves the same
  fingerprint.
- SmartRecruiters and Recruitee enter active config only after a real handle is
  verified by `jho sources probe`.

## User Experience

The candidate page adds a compact status card near the CV editor. It uses the
existing tokens, typography, feedback affordances, and translation dictionary;
it must remain readable without horizontal scrolling at 375px, 812px landscape,
tablet, and desktop widths. No client polling or new visual language is needed
for the first release; refresh/navigation is the consistency boundary.

## High-Level Technical Constraints

- Next.js Server Components remain the default; shared reads go through core
  APIs, not SQL inside JSX.
- Use existing libSQL/Drizzle schema and queue table; no new broker.
- Use existing Vitest, test database, HTTP port fixtures, and isolated E2E
  harness.
- Follow `DESIGN.md`, semantic tokens, locale dictionaries, and the mobile
  viewport contract.
- Work must be created from `dev` in a `codex/*` worktree and merged through a
  PR; `dev`, `staging`, and `main` remain permanent.

## Non-Goals (Out of Scope)

- LLM re-ranking of top-fit jobs; this remains a separate product decision.
- A visual diff between CV versions; the current version history behavior stays.
- Shared-storage rate limiting for the public profile; required only for a
  future multi-instance deployment.
- Adding guessed SmartRecruiters/Recruitee handles.
- Rotating or copying user-owned Resend/Gmail secrets. The task documents and
  validates names, while the operator performs credential changes.

## Architecture Decision Records

- [ADR-001: Candidate-scoped rescore status read model](adrs/adr-001.md)
- [ADR-002: Register Compozy automation only after a manual run](adrs/adr-002.md)
- [ADR-003: One canonical Resend sender variable](adrs/adr-003.md)

## Open Questions

- Which verified SmartRecruiters and Recruitee company handles should be added
  later? The current workflow intentionally leaves this to an operator with
  evidence.
- Should the future LLM rerank, CV diff, or shared rate limit be the next
  product feature after this maintenance wave?
