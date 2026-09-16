## Overview

`master-jobs` currently records when a source stops showing a job, but the
candidate's application is a separate, durable decision. This feature gives
the candidate and an authorized recruiter a reliable history while allowing
old closed jobs to leave the active board. It is valuable because a dead
external URL must not erase application evidence or funnel counts.

## Goals

- Candidates can see every application, including applications whose jobs are
  closed or archived.
- Candidates can see unique application counts by funnel status and inspect the
  dates, next action, and event history that explain each count.
- Recruiters can see the same operational history only for candidates and jobs
  authorized by their session and existing relationship.
- Operators can preview and apply an idempotent archive routine for confirmed
  closed jobs without changing application decisions.
- Reopening a job restores its active presentation without duplicating the job
  or its application.

## User Stories

The canonical stories and edge cases are in [_user_stories.md](_user_stories.md).

- US-001: candidate application history and counts.
- US-002: recruiter-scoped application history.
- US-003: operator archive and reopen workflow.

## Core Features

### Candidate history

Show a candidate's unique applications grouped by status, with job title,
company, application dates, next action, and whether the job is open, closed,
or archived. A closed/archived job remains visible when an application exists.

### Recruiter-scoped history

Show counts and lists for only the candidates and applications the recruiter is
authorized to access. The product must deny arbitrary candidate-id lookups and
must not expose unrelated private profile fields.

### Safe archive and reopen

Archive confirmed closed jobs after a configurable retention window (90 days by
default). The operation has a dry-run, never changes `application.status`, and
never physically deletes a job with an application. A later `alive` observation
clears an automatic archive marker without creating a second identity.

## Business Rules

1. `closed_at` is an observed source fact; `archived_at` is an operational
   presentation state.
2. Ingestion never writes `application` or `application_event`.
3. Only a complete source reconciliation or a safe `404`/`410` verdict can
   establish closure. `401`, `403`, `429`, `5xx`, timeouts, and partial source
   failures are inconclusive.
4. A job with any `application` cannot be physically pruned.
5. Archiving a job never changes the application's funnel status, notes,
   document, or event history.
6. `application.id` counts unique applications. `application_event` counts
   transitions and audit evidence; events never inflate application totals.
7. The default archive cutoff is 90 days after confirmed closure and is
   configurable by the operator.
8. Manual and recruiter-authored jobs are excluded from automatic archive until
   an explicit authorship rule exists.
9. Candidate and recruiter reads enforce the session scope before aggregation.
10. A replayed archive command is a no-op; a replayed status transition creates
    no duplicate event.

## User Experience

The candidate opens a history view from the authenticated workspace, sees a
summary by status, then opens a row to inspect the job and its events. Closed or
archived labels explain why the job is absent from the active board. The
recruiter sees a scoped equivalent, with an explicit empty state when no linked
candidates are available. The operator runs the archive command from the CLI,
reviews its dry-run totals, and then applies it.

All visible copy uses the existing locale dictionaries and semantic theme
tokens. The history views must work at the supported mobile width without
horizontal scrolling. No automatic application submission is introduced.

## High-Level Technical Constraints

- Preserve the existing `job`, `application`, and `application_event` boundary.
- Use the existing auth policy (`can`, `guard`, and page guards) for scope.
- Keep domain decisions pure and adapters responsible for SQL/HTTP.
- Keep application history queryable in SQLite/libSQL and PostgreSQL.
- Keep payload retention and physical pruning separate from archive state.
- Do not introduce MongoDB or a second queue for this feature.
- Dev and staging use the fixtures defined by
  [`environment-sample-only`](../environment-sample-only/).

## Non-Goals (Out of Scope)

- Automatically rejecting, withdrawing, or archiving an application because a
  job closed.
- Automatically sending applications or changing a candidate's decision.
- Copying the production corpus into dev/staging.
- Creating `dev` and `staging` schemas in the first Supabase project.
- Materializing redundant counters before query measurements show a need.
- Moving raw scrape payloads to MongoDB as a default retention strategy.

## Architecture Decision Records

- [ADR-001: Separate archive state from source closure](adrs/adr-001.md)
- [ADR-002: Query-based scoped history before counters](adrs/adr-002.md)
- [ADR-0020: Archive preserves applications](../../../docs/adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md)

## Open Questions

- Should the first UI expose event details inline or behind an expand action?
- Should the archive cutoff be one global setting or per source after the first
  production measurement?
- Which existing recruiter relationship is the authoritative scope for the
  first release? The implementation must use the current policy rather than
  inventing a new relationship model.
