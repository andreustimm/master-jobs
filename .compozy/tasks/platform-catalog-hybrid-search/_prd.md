# Administered Job Platforms, Hybrid Search, Verification, and Analysis

## Overview

The job board can already ingest a fixed set of adapters and search by job title
or company. It does not yet give an administrator a safe way to manage those
platforms, run a capture for one platform, refresh the availability of existing
jobs, or find a relevant job whose useful terms occur only in its description.
The current search also misses close wording such as `Techlead` versus `Tech
Lead`.

This feature adds an administrator-facing platform catalog and operational
controls, a hybrid job search, an evidence-backed job-structure analysis, and
the run history needed to understand what happened. It is for Andreus as the
candidate, trusted administrators, and future recruiters who need a current,
searchable corpus without turning the portal into an unbounded scraper.

The product decision for this initiative is **hybrid search**: exact filters
and lexical matching remain authoritative; trigram proximity and optional
semantic similarity improve ordering and discovery. If embeddings are absent,
the same search still works with PostgreSQL full-text and proximity matching.

## Goals

- An administrator can see, add, edit, enable, disable, validate, and inspect
  the health of supported job-platform definitions from the portal.
- An administrator can start an idempotent capture for one platform or for all
  enabled platforms, observe progress, retry a failed run, and see counts for
  fetched, new, updated, unchanged, closed, and inconclusive records.
- Candidate and recruiter searches can match terms in title, company, and
  normalized description, while work mode, location, status, and other filters
  remain exact and authoritative.
- Close wording is discoverable through proximity matching and semantic
  ordering when embeddings are available, with a deterministic lexical fallback.
- An administrator or an authenticated candidate can request a structured
  analysis of a visible job and see what was extracted, what is unknown, which
  source evidence supports it, and which prompt/model version produced it.
- A status refresh distinguishes proof that a job is gone from a temporary
  block or an inconclusive response. Jobs are closed and retained for history;
  they are never deleted by ingestion or verification.
- Every operational action is permission-checked, observable, retryable, and
  safe to repeat without duplicate jobs or duplicate runs.

## User Stories

The canonical story catalog is [the full user stories file](_user_stories.md).

- US-001–US-006: platform catalog and administrator permissions
- US-007–US-011: source-specific and global capture operations
- US-012–US-016: job status verification and lifecycle history
- US-017–US-021: text, proximity, and hybrid semantic search
- US-022–US-026: structured job analysis and evidence
- US-027–US-031: resilience, concurrency, and operational visibility

## Core Features

### 1. Platform catalog

The admin portal exposes one row for each supported source definition. A row
contains the display label, adapter kind, platform handle, public source link,
enabled state, supported capabilities, last run, last health result, and counts.
The catalog is deliberately limited to adapters registered by the application:
an admin can configure a supported board or career-page handle, but cannot
upload executable scraping code or make the server fetch an arbitrary private
endpoint.

A new platform type still requires a `SourceAdapter` implementation and a
deployment. Once the adapter is registered, its handles and operational
settings can be managed in the catalog. Secret material is never entered into
the catalog; integrations refer to an environment-variable or secret name.

The catalog must preserve the existing local bootstrap configuration while a
database-backed catalog is introduced. A clear source of truth and an import
path are required so a deploy cannot silently overwrite an administrator's
change.

### 2. Capture runs

The admin can select **Buscar agora** for one platform or **Buscar em todas**
for all enabled platforms. The action creates a run with a stable idempotency
key, queues work through the existing `QueuePort`, and returns immediately with
progress. The UI shows queued, running, succeeded, partially succeeded,
failed, and cancelled states, plus per-platform errors and retry actions.

Adapters normalize records through the existing ingestion boundary. A complete
source snapshot may reconcile missing jobs; a keyword or partial endpoint may
only upsert what it returned and must not close unrelated jobs. Each run records
its scope so the closure rule cannot be applied accidentally to a partial feed.

### 3. Availability and lifecycle verification

The admin can refresh one platform, a selection, or all due jobs. Verification
uses the canonical job URL or an adapter-specific status probe and records the
check time, response classification, evidence, and reason. A confirmed 404 or
410 can close a job. A public page that explicitly says filled, cancelled, or
paused can record that reason when the adapter has evidence for it; otherwise
the job is simply inconclusive.

Temporary blocks (401, 403, 429), server errors, timeouts, and network failures
never close a job. A later alive result reopens a previously closed job while
preserving the earlier close event. Existing applications and their history
remain linked to the job.

### 4. Search in descriptions and by proximity

The search box covers normalized title, company, location, skills, and
description text. Query parsing supports ordinary words and quoted phrases;
blank queries preserve the current board behavior. Existing exact filters such
as work mode, seniority, source, cluster, status, salary, and fit are applied
before ranking.

The relevance view combines lexical full-text matches with a proximity signal
for near spellings and word forms. For example, `Techlead`, `Tech Lead`, and a
common punctuation variation can be shown together without weakening a strict
remote or status filter. Relevance is explained with matching fields or a
semantic-match label, so a candidate can understand why a result appeared.

### 5. Optional semantic ordering

When a configured embedding adapter is available, normalized job text and a
query are embedded asynchronously and compared with pgvector. Semantic score
only orders results that already pass the user's exact filters; it cannot
override a hard work-mode, location, eligibility, or status rule. The vector
model and dimensions are stored with each embedding.

Missing, stale, failed, or not-yet-generated embeddings fall back to the same
lexical and proximity search. Re-embedding is an explicit, resumable operation
and never blocks ingestion. The first release does not require a particular
vendor or a bundled local model.

### 6. Structured job analysis

From a visible job, an authenticated candidate or administrator can request an
analysis. The request is queued and idempotent. The result is a versioned,
structured record containing:

- normalized role and title family;
- seniority, employment type, work mode, location, and work-authorization
  signals;
- compensation and benefits when stated;
- must-have and preferred skills, responsibilities, and domain signals;
- risks or blockers, missing fields, confidence per field, and an overall
  analysis status;
- short evidence excerpts or source spans, the prompt version, model, and
  timestamps.

The analysis is evidence-bound: a missing field is `unknown`/null and never
invented. It does not alter an application, score, candidate profile, or
funnel state. Administrators can inspect active prompt/schema versions and
retry failures; arbitrary prompt editing and bulk automatic application are
outside the first release.

## Business Rules

### Catalog and permission rules

1. Only an authenticated `admin` may create, edit, enable, disable, probe, or
   delete a platform definition, start a source/global capture, start a status
   refresh, or inspect operational run details. An impersonated session cannot
   perform these actions, even when the target account is an admin.
2. `candidate` and `recruiter` may read jobs according to existing scope rules
   and use search. They cannot mutate the platform catalog or run ingestion.
3. A platform handle is unique within its adapter kind. A disabled platform is
   not selected by an all-platform run.
4. Catalog writes validate the adapter kind, handle, URL, capability settings,
   and secret reference before persistence. Secrets and API keys are never
   stored in the database or logs.
5. Removing a catalog row is a soft retirement. Existing jobs and their source
   history remain queryable; historical runs are immutable.

### Capture and verification rules

6. Every run has one scope: a complete source snapshot, one configured search
   profile, one platform, or all enabled platforms. Only a complete snapshot
   may reconcile missing jobs for that source.
7. Repeating the same action while an equivalent run is queued or running
   returns the existing run. Retrying a failed platform creates a new attempt
   linked to the original run, not duplicate jobs.
8. Ingestion may create or update `job` and source-health records only. It
   never creates, deletes, or changes an `application` or another user decision.
9. A job that disappears is marked closed with `closedAt` and an evidence
   record; it is never deleted. A later confirmed alive result may reopen it.
10. Only 404/410 or explicit adapter evidence may establish closure. 401, 403,
    429, 5xx, timeouts, and network errors are inconclusive and leave the job
    open.
11. A status reason is one of `closed`, `filled`, `cancelled`, `paused`, or
    `unknown`; the reason is only shown as a fact when evidence supports it.

### Search and ranking rules

12. Exact filters are applied before relevance ranking. Semantic similarity and
    proximity cannot return an otherwise excluded job.
13. Query text searches title, company, location, skills, and normalized
    description. Raw HTML is not reintroduced to support search.
14. Relevance with no embedding is a valid result. A missing vector is neutral,
    not a penalty; embedding failure is visible in run health and can be
    retried.
15. The default board sort remains fit for an empty query. When a query is
    present, the user may choose relevance; fit and recency remain available as
    explicit sorts and deterministic tie-breakers.
16. Search result explanations use only persisted match signals. The system
    never claims a semantic match when only a title or lexical match exists.

### Analysis rules

17. Analysis is available only for a job the current session may read. Admin
    bulk analysis, prompt/schema inspection, and run-cost details are admin-only.
18. A job analysis is immutable by version. Re-running creates a new attempt or
    version and retains the previous result for auditability.
19. Every extracted value has a provenance class: explicit source evidence,
    normalized inference, or unknown. The UI distinguishes these classes.
20. Analysis output cannot write to applications, candidate profiles, fit
    scores, or platform settings. A human must decide whether to use it.
21. LLM calls go through `LlmPort`; provider keys remain in environment
    configuration. Prompt, schema, model, and token/cost metadata are retained
    without retaining raw provider secrets.

## User Experience

### Personas

- **Administrator** — keeps supported sources healthy, starts captures and
  status checks, and investigates failures.
- **Candidate** — searches a broad but current corpus, compares remote,
  hybrid, and onsite roles, and requests analysis before deciding to apply.
- **Recruiter** — searches and reads jobs within existing authorization without
  operating the ingestion system.

### Primary flows

1. Admin opens **Administração → Plataformas**, reviews health, adds a supported
   handle, probes it, enables it, and clicks **Buscar agora**. The run detail
   shows progress and links to affected jobs.
2. Admin clicks **Buscar em todas** or **Atualizar status**, sees one aggregate
   run with per-source progress, and retries only failed/inconclusive sources.
3. Candidate opens `/jobs`, enters a phrase such as `Laravel` or `Tech Lead`,
   adds the remote/hybrid/onsite filter, and switches to relevance. Results
   show whether the match came from title, description, proximity, or semantic
   ordering.
4. Candidate opens a job and requests **Analisar vaga**. A pending state
   survives refresh; the completed view presents structured fields, unknowns,
   evidence, confidence, and the analysis version.

The controls must work by keyboard, expose busy/error/success states to assistive
technology, use existing semantic theme tokens, and remain usable at the
project's mobile viewport. Destructive actions require a confirmation and
explain that job history is retained.

## High-Level Technical Constraints

- Follow the existing bounded-context structure, `SourceAdapter`, `QueuePort`,
  `LlmPort`, pure domain functions, and composition-by-function rules.
- Preserve the current SQLite/libSQL local workflow and support PostgreSQL/
  pgvector where the deployment already provides it. The feature must be
  useful without a vector extension or an embedding provider.
- Use PostgreSQL full-text search and `pg_trgm` for the lexical/proximity path;
  use pgvector only as an optional semantic signal. Search and ingestion must
  not depend on a network call to an LLM.
- Do not scrape LinkedIn or use authenticated browser sessions. Only existing
  public adapters and explicitly supported authenticated-import paths may be
  used.
- Do not retain raw HTML or full scraped payloads as a new storage strategy.
  Store normalized job text and bounded evidence needed for audit.
- Respect the current auth, role, PII, service-worker, theme, mobile, and
  localization rules. All user-visible text comes from the i18n dictionary.
- Operational actions need bounded concurrency, cancellation/retry behavior,
  structured logs, and metrics sufficient to diagnose a source without dumping
  personal data.

## Non-Goals (Out of Scope)

- Uploading arbitrary scraper code or letting an admin configure an unknown
  private website without an adapter.
- Scraping LinkedIn or driving a logged-in browser session.
- Automatically applying to a job, sending a message, changing a funnel stage,
  or accepting an LLM recommendation as a user decision.
- Storing raw HTML, complete scraper payloads, or a second MongoDB archive as
  part of this feature.
- Replacing the deterministic fit scorer with embeddings or an LLM.
- Requiring a single embedding vendor or shipping a local model in the first
  slice.
- Building a general-purpose prompt editor, a billing system, or a recruiter
  multi-tenant workspace.

## Architecture Decision Records

- [ADR-001: Hybrid search with a lexical fallback](adrs/adr-001.md) — exact
  filters and PostgreSQL text/proximity search stay authoritative while vectors
  improve ordering when available.
- [ADR-002: Separate source definitions from search scopes](adrs/adr-002.md) —
  partial keyword runs cannot accidentally close jobs from a complete source.
- [ADR-003: Evidence-bound, versioned job analysis](adrs/adr-003.md) —
  structured analysis is auditable and cannot mutate user decisions.

## Open Questions

- Which embedding provider/adapter should be the default in production, and
  what per-run budget or daily quota should gate semantic indexing? The first
  implementation must preserve the lexical path if this is not configured.
- Should an admin be allowed to publish a new prompt/schema version from the
  portal, or should publishing remain a reviewed code/config change initially?
- Which existing adapters can prove `filled`, `cancelled`, or `paused` beyond
  an HTTP 404/410, and what evidence format does each adapter expose?
- When the database-backed catalog becomes authoritative, which deployment
  command imports the current `config/sources.yaml` exactly once and how is
  drift reported?
