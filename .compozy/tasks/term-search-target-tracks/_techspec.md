# TechSpec: Saved Term Searches and Target Tracks

## Executive Summary

The feature adds target tracks, saved term searches and new Jobs screen
filters on top of the existing sourcing, scoring and board code, without a new
runtime. Three decisions carry the design. First, term captures are rows in a
table-backed queue (`term_capture`) drained by `after()` right after the Server
Action that saves or re-runs a term, and by a new step of the daily sweep that
calls the same function (ADR-007). Second, fit per track lives in `job_score`,
whose primary key becomes `(candidate_id, track_id, job_id)`; every reader
filters through one matching helper (ADR-008). Third, a track is a target
fragment (titles, clusters, keywords, seniority thresholds, compensation
ranges) merged with the person-level profile into the `Profile` the scorer
already accepts; the primary track scores every job and accepted tracks score
only jobs that mention them (ADR-009).

Around those decisions: a durable per-platform quota ledger with atomic
reservation that the regular sync also obeys (ADR-010); term captures ingest
under a non-synced `<kind>:~terms` source through `observeRawJob` in a mode that
never reassigns an existing job, and reopening now clears archiving (ADR-011);
one whole-word term pattern builder serves TypeScript and PostgreSQL (ADR-012);
pay normalization for filtering and sorting runs in SQL from the money module's
constants (ADR-013). The main trade-offs are a primary-key migration on
`job_score` (automatic promotion suspends for review), a 30-second ceiling on
the immediate drain, and regex filtering without a text index until the
hybrid-search work adds one.

## System Architecture

### Component Overview

| Component | Location | Responsibility |
|---|---|---|
| Term kernel | `src/core/term.ts` (new) | Validate a term, derive its key, build the whole-word pattern for TypeScript and SQL. Pure. |
| Pay normalization | `src/core/money.ts` (extended) | Export the SQL factor table and a TypeScript normalizer that share `PERIODS_PER_YEAR`. Pure. |
| Tracks | `src/contexts/matching/{domain,app,infra}/track*.ts` (new) | Track model, merge with the person profile, relevance gate, suggestion, evidence support, CRUD, primary/archive lifecycle, primary-track migration. |
| Track scope | `src/contexts/matching/app/track-scope.ts` (new) | Resolve primary / chosen / all tracks for a candidate and expose `scoreTrackFilter` for every `job_score` reader. |
| Per-track scoring | `src/core/scoring/apply.ts`, `src/core/scoring/queue.ts` (modified) | Score each active track with its effective profile; apply the relevance gate on accepted tracks; recalculate one track after an edit. |
| Saved terms | `src/contexts/matching/{domain,app,infra}/saved-term*.ts` (new) | Save, pause, resume, move, delete, re-run with cooldown; new-job counts; visit recording; active term keys for the sweep. |
| Sourcing context | `src/contexts/sourcing/` (new) | Request and run term captures, reserve quota, attribute jobs to terms, report aggregate health. Owns `term_capture`, `term_attribution`, `platform_quota`. |
| Term-search adapters | `src/core/sources/{types,aggregators}.ts` (modified) | Optional `termSearch` capability with a declared budget on Remotive, RemoteOK and Himalayas; `RawJob.tags`. |
| Ingestion changes | `src/core/ingest/{observe,run}.ts`, `src/core/sources/config.ts` (modified) | `keepExistingSource` option, archive cleared on reopen, `~terms` source, quota reservation in `syncOne`, handle refinement. |
| Board | `src/core/db/repo.ts`, `app/filters.tsx`, `app/jobs/page.tsx` (modified) | Track selector, term filter, "brought by" filter, minimum pay, normalized sort, stable tie-break, "new" marker. |
| Screens | `app/searches/**`, `app/admin/captures/page.tsx`, `app/jobs/[id]/page.tsx`, `app/nav-links.tsx` (new/modified) | Searches screen, track editor, admin health, per-track fits on the job detail, navigation entry. |
| CLI and sweep | `src/cli.ts`, `.github/workflows/varredura.yml` (modified) | `jho terms run`, `jho terms status`, `jho tracks list`; one sweep step. |

Data flow for a saved term:

1. `saveTermAction` (Server Action) → `matching.saveTerm` validates the term,
   stores `saved_term`, and calls `sourcing.requestTermCaptures` with the term
   key.
2. `requestTermCaptures` checks the ingestion guard and enqueues one
   `term_capture` row per reachable platform for today's UTC day (idempotent on
   `(platform, term_key, window_day)`). A platform is reachable when its adapter
   declares `termSearch` with a non-null `validatedOn` and its entry in
   `config/sources.yaml` is enabled.
3. The action schedules `after(() => sourcing.runTermCaptures({ budgetMs:
   25_000, worker: "web" }))` and returns.
4. `runTermCaptures` claims a row (`SKIP LOCKED`), calls
   `adapter.termSearch.search(query, { limit: 100, reserve })`, where `reserve`
   hits `PlatformQuotaPort` before each request, then for each raw job decides
   attribution with `matchesTerm`, calls `observeRawJob(raw, "<kind>:~terms",
   { keepExistingSource: true })`, writes `term_attribution`, and records the
   outcome.
5. New jobs and changed jobs lose their scores (existing invalidation); the next
   scoring run (`score_task` from the sweep or the CLI, or the capture's
   follow-up enqueue) scores them per track.
6. The Jobs screen reads `job_score` through `trackScope`, filters by term,
   attribution and pay, and marks jobs attributed after the last visit as new.

External interactions: Remotive, RemoteOK and Himalayas public HTTP APIs
through the existing `HttpPort`; no other external system.

Dependency direction follows the context map: matching calls sourcing's public
API (`requestTermCaptures`, `attributedJobIds`, `captureStatusFor`); sourcing
never reads matching tables.

## Implementation Design

### Core Interfaces

Term kernel (`src/core/term.ts`):

```ts
export const TERM_BOUNDARY = "[^a-z0-9+#]";
export type TermError = "term_too_short" | "term_too_long" | "term_invalid_char" | "term_no_alnum";
export type ValidTerm = { term: string; key: string };

export function validateTerm(raw: string): { ok: true; value: ValidTerm } | { ok: false; code: TermError; char?: string };
export function termKey(term: string): string;            // "Tech Lead" -> "techlead"
export function termPattern(term: string): string;        // body with [ -]? between alphanumerics
export function termRegexSql(term: string): string;       // `(^|[^a-z0-9+#])<body>([^a-z0-9+#]|$)` for ~*
export function matchesTerm(term: string, text: string): boolean;
```

Track model (`src/contexts/matching/domain/track.ts`):

```ts
export type TrackTarget = {
  targets: Profile["targets"];
  keywords: Profile["keywords"];
  seniority: Pick<Profile["seniority"], "min_years_expected" | "reject_below_years">;
  compensation: Pick<Profile["compensation"], "reference_currency" | "ranges">;
};
export type Track = {
  id: number; candidateId: number; name: string; isPrimary: boolean;
  status: "active" | "archived"; position: number;
  target: TrackTarget | null;           // null = pending primary
  unreviewed: Array<"targets" | "compensation" | "seniority">;
};
export function effectiveProfile(person: Profile, target: TrackTarget): Profile;
export function isRelevant(target: TrackTarget, job: { title: string; description: string }): boolean;
export function evidenceSupport(target: TrackTarget, evidence: OwnEvidence): { supported: string[]; gaps: string[] };
export function suggestTrack(input: { term: ValidTerm; catalog: CatalogSkill[]; evidence: OwnEvidence; primary: TrackTarget }):
  { target: TrackTarget; thin: boolean };
export function validateTrackTarget(name: string, target: TrackTarget, rates: FxTable): { ok: true } | { ok: false; code: TrackError };
```

Track scope (`src/contexts/matching/app/track-scope.ts`):

```ts
export type TrackChoice = { kind: "primary" } | { kind: "track"; trackId: number } | { kind: "all" };
export type TrackScope = {
  candidateId: number; primaryTrackId: number;
  trackIds: number[];                   // one id for primary/track, all active ids for "all"
  mode: "single" | "best";
  notice?: "track_unknown";             // chosen id not the viewer's or archived -> primary
};
export async function trackScope(candidateId: number, choice: TrackChoice): Promise<TrackScope | null>; // null = pending
export function scoreTrackFilter(scope: TrackScope): SQL;       // predicate on job_score.track_id
export function primaryScoreFilter(): SQL;                       // cross-candidate readers
```

Term-search capability (`src/core/sources/types.ts`):

```ts
export type PlatformBudget = { perDay?: number; perMinute?: number; pageSize: number; maxRequestsPerRun: number };
export type TermSearch = {
  budget: PlatformBudget;
  /** Date the integration last passed `jho sources probe --term`; null keeps the platform out of term runs. */
  validatedOn: string | null;
  /** Calls `reserve()` before every HTTP request and stops when it returns false. */
  search(query: string, opts: { limit: number; reserve: () => Promise<boolean> }):
    Promise<FetchResult & { totalHint: number | null; stoppedByQuota: boolean }>;
};
export type SourceAdapter = {
  kind: FetchableSourceKind; docs: string;
  fetchJobs(config: SourceConfig): Promise<FetchResult>;
  termSearch?: TermSearch;
};
```

Sourcing ports (`src/contexts/sourcing/ports.ts`):

```ts
export type CaptureOutcome =
  | { status: "succeeded"; fetched: number; created: number; known: number; attributed: number; totalHint: number | null }
  | { status: "waiting_quota"; retryAt: string }
  | { status: "failed"; code: "http_error" | "network" | "parse" | "endpoint_gone"; retryable: boolean }
  | { status: "skipped"; code: "platform_disabled" | "ingestion_blocked" };
export type ClaimedCapture = { id: number; platform: FetchableSourceKind; termKey: string; query: string; windowDay: string };

export interface TermCaptureQueuePort {
  enqueue(rows: CaptureRequest[]): Promise<{ created: number; existing: number }>;
  claim(worker: string, now: Date): Promise<ClaimedCapture | null>;
  finish(id: number, outcome: CaptureOutcome, now: Date): Promise<void>;
}
export interface PlatformQuotaPort {
  reserve(platform: FetchableSourceKind, budget: PlatformBudget, now: Date): Promise<{ ok: true } | { ok: false; retryAt: string }>;
  exhaustDay(platform: FetchableSourceKind, now: Date): Promise<void>;
}
```

Sourcing public API (`src/contexts/sourcing/index.ts`):

```ts
export function requestTermCaptures(input: { termKey: string; query: string; origin: "web" | "sweep" | "cli"; now: Date }):
  Promise<{ enqueued: number; skipped: "ingestion_blocked" | "no_platform" | null }>;
export function runTermCaptures(opts: { budgetMs?: number; worker: string; max?: number }):
  Promise<Record<FetchableSourceKind, { claimed: number; succeeded: number; waiting: number; failed: number; created: number; known: number }>>;
export function captureStatusFor(termKeys: string[], now: Date): Promise<Map<string, PlatformCaptureState[]>>;
export function attributedJobIds(termKey: string): SQL;       // subquery for board filters
export function captureHealth(now: Date): Promise<PlatformHealth[]>; // aggregate, no term text
```

Saved terms (`src/contexts/matching/app/saved-terms.ts`):

```ts
export type SaveTermResult =
  | { ok: true; termId: number; run: "started" | "waiting_sweep" | "captures_off" | "no_platform" }
  | { ok: false; code: TermError | "term_duplicate" | "term_limit" | "track_required" | "track_archived" | "primary_pending" };
export function saveTerm(scope: CandidateScope, input: { term: string; trackId: number }, ctx: ActionContext): Promise<SaveTermResult>;
export function rerunTerm(scope: CandidateScope, termId: number, ctx: ActionContext):
  Promise<{ ok: true; run: "started" | "waiting_sweep" | "captures_off" } | { ok: false; code: "cooldown"; availableAt: string } | { ok: false; code: "not_found" | "running" }>;
export function setTermStatus(scope: CandidateScope, termId: number, status: "active" | "paused"): Promise<{ ok: boolean; code?: "not_found" }>;
export function moveTerm(scope: CandidateScope, termId: number, trackId: number): Promise<{ ok: boolean; code?: "not_found" | "track_archived" }>;
export function deleteTerm(scope: CandidateScope, termId: number): Promise<{ ok: boolean }>;
export type ActionContext = { now: Date; impersonated: boolean };
```

Track target validation (`validateTrackTarget`, pure) enforces: name 1–40
characters after trimming; at least 1 target title and 1 positive keyword;
positive keyword weights are integers 1–10 and negative ones −10 to −1 (the
scale `profile/profile.yaml` already uses: 2–10 and −3 to −6); at least one
compensation range, each with `0 < floor ≤ target ≤ ideal ≤ 10,000,000`, one
range per (currency, period), currencies with a stored exchange rate, and one
range in `reference_currency` (the `ProfileSchema` rule). A new track's
suggestion copies the primary track's compensation ranges and seniority
thresholds, which the candidate then edits.

Error handling conventions: domain and app functions return discriminated
results with stable string codes; they throw only on programming errors or
database failure. Server Actions map codes to dictionary keys and render them
through the existing `MutationFeedbackForm`. The capture runner never throws
out of `runTermCaptures`: each claimed row ends in an outcome.

### Data Models

New and changed tables in `src/core/db/schema.ts` (schema `production`).
Timestamps follow the existing text ISO-8601 convention.

`target_track` (matching):

| Column | Type | Notes |
|---|---|---|
| `id` | integer identity | PK |
| `candidate_id` | integer not null | FK `candidate.id` ON DELETE CASCADE |
| `name` | text not null | 1–40 chars |
| `name_key` | text not null | `lower(trim(name))`; unique `(candidate_id, name_key)` |
| `is_primary` | boolean not null default false | partial unique index `(candidate_id) WHERE is_primary` |
| `status` | text not null default `'active'` | `active` \| `archived` |
| `position` | integer not null | display order and tie-break |
| `target_json` | text null | `TrackTarget` JSON; null = pending primary |
| `unreviewed_json` | text not null default `'[]'` | inherited fields not yet saved by the candidate |
| `created_at`, `updated_at` | text not null | |

`job_score` (matching, changed): adds `track_id integer not null` FK
`target_track.id` ON DELETE CASCADE; primary key becomes
`(candidate_id, track_id, job_id)`; new index `(candidate_id, track_id, fit)`.
All other columns unchanged; `profile_hash` is the hash of the effective
profile of that track.

`saved_term` (matching):

| Column | Type | Notes |
|---|---|---|
| `id` | integer identity | PK |
| `candidate_id` | integer not null | FK `candidate.id` ON DELETE CASCADE |
| `track_id` | integer not null | FK `target_track.id` ON DELETE CASCADE |
| `term` | text not null | trimmed display form |
| `term_key` | text not null | `termKey(term)`; unique `(candidate_id, term_key)`; index `(term_key, status)` |
| `status` | text not null default `'active'` | `active` \| `paused` |
| `paused_reason` | text null | `manual` \| `track_archived`; restoring a track resumes only `track_archived` terms |
| `last_run_requested_at` | text null | cooldown anchor (first run included) |
| `last_visit_at` | text null | "new since last visit" anchor |
| `created_at`, `updated_at` | text not null | |

`term_capture` (sourcing; queue and run record):

| Column | Type | Notes |
|---|---|---|
| `id` | integer identity | PK |
| `platform` | text not null | source kind |
| `term_key` | text not null | |
| `query` | text not null | display term of the first request, sent to the platform |
| `window_day` | text not null | UTC `YYYY-MM-DD`; unique `(platform, term_key, window_day)` |
| `origin` | text not null | `web` \| `sweep` \| `cli` |
| `status` | text not null | `queued` \| `running` \| `succeeded` \| `waiting_quota` \| `failed` \| `skipped` |
| `reason_code` | text null | failure or skip code |
| `priority` | double precision not null | web 10, sweep/cli 0 |
| `attempts` | integer not null default 0 | |
| `run_after` | text null | next window for `waiting_quota` |
| `claimed_at`, `claimed_by` | text null | lease (5 minutes) |
| `fetched`, `created`, `known`, `attributed` | integer not null default 0 | |
| `total_hint` | integer null | "100 of about N" |
| `started_at`, `finished_at`, `created_at`, `updated_at` | text | |

Index `(status, priority)`.

`term_attribution` (sourcing): `term_key text`, `job_id integer` FK `job.id`
ON DELETE CASCADE, `platform text`, `attributed_at text`; PK
`(term_key, job_id)`; index `job_id`.

`platform_quota` (sourcing): `platform text`, `window_kind text` (`day` \|
`minute`), `window_start text`, `used integer not null`; PK
`(platform, window_kind, window_start)`.

`source` rows `<kind>:~terms` (existing table): created on first use with
`enabled = false`, label "<Platform> — termos".

`candidate_matching_profile` (unchanged structure): after migration it is the
person-level profile. `personProfile(row)` ignores its target-level keys; the
primary track owns them.

Table count goes from 30 to 35; `docs/engineering/context-map.md` adds the
`sourcing` context row, assigns `target_track`, `saved_term` to matching and
`term_capture`, `term_attribution`, `platform_quota` to sourcing, and updates
`schema-table-count`.

Migrations (`drizzle/postgres/`), in order:

1. `0004_target_tracks`: create `target_track`, `saved_term`, `term_capture`,
   `term_attribution`, `platform_quota`; add nullable `job_score.track_id`.
2. `0005_backfill_primary_tracks` (custom): for each candidate with a
   `candidate_matching_profile`, insert the primary track from its target-level
   keys and mark `unreviewed_json` for keys equal to the default profile when
   the candidate is not the owner; update `job_score.track_id` to that track;
   delete `job_score` rows of candidates without a profile (they are derived,
   and M-06 forbids them).
3. `0006_job_score_track_pk`: `track_id` NOT NULL, FK, drop the old PK, add
   `(candidate_id, track_id, job_id)`, add the `(candidate_id, track_id, fit)`
   index.

Request types for the Jobs screen (`BoardFilters`, extended):

```ts
export type BoardFilters = {
  /* existing: minFit, cluster, sourceKind, workMode, hideBlocked, freshDays, hasComp, hasDescription, namedEmployer, status */
  track: TrackScope | null;             // null = no candidate scope
  term?: ValidTerm;                     // replaces q
  broughtBy?: { termKey: string };      // viewer's saved term, resolved server-side
  pay?: { min: number; currency: string; period: "month" | "year"; disclosedOnly: boolean };
  sort: "fit" | "recent" | "comp";
  newSince?: string;                    // last visit of the "brought by" term
};
```

### API Endpoints

The product surface is Server Components, Server Actions and the CLI; there
is no new HTTP API route and no new cron route.

Pages (all `export const dynamic = "force-dynamic"`):

| Path | Guard | Purpose |
|---|---|---|
| `GET /searches` | `requireOwnCandidatePage("candidate:read")` | Tracks with their terms, per-platform states, new counts, coverage note, "daily repeat paused" |
| `GET /searches/tracks/new?term=&name=` | same | Suggested track form (server-rendered suggestion) |
| `GET /searches/tracks/[id]` | same | Track editor; unknown or foreign id → `notFound()` |
| `GET /admin/captures` | `requirePage("admin:access")` | Aggregate health per platform |
| `GET /jobs` | `requirePage("job:read")` (unchanged) | New params below |
| `GET /jobs/[id]` | unchanged | Per-track fits; on-demand fit for tracks without a row |

`/jobs` query parameters (all optional, validated in `readFilters`):

| Param | Values | Invalid value |
|---|---|---|
| `track` | track id \| `all` | primary track + notice `track_unknown` |
| `q` | term, validated by `validateTerm` | filter ignored + notice naming the rule |
| `by` | saved term id of the viewer | filter ignored + notice `term_unknown` |
| `pay` | integer 1–10,000,000 | filter ignored + notice `pay_invalid` |
| `cur` | currency with a stored rate | default currency |
| `per` | `month` \| `year` | `month` |
| `disclosed` | `1` | off |
| `sort` | `fit` \| `recent` \| `comp` | `fit` |

Server Actions (each awaits `guardOwnCandidate("candidate:write")` before any
effect; ids in `FormData` are requests, re-checked against the session scope):

| Action | Input | Success | Failure codes |
|---|---|---|---|
| `createTrackAction` | name, target fields | redirect to `/searches` | `track_name_invalid`, `track_name_duplicate`, `track_limit`, `track_titles_required`, `track_keywords_required`, `range_invalid`, `range_duplicate` |
| `updateTrackAction` | track id, target fields | revalidate; rescore enqueued | the above + `not_found`, `stale` (updated_at mismatch) |
| `setPrimaryTrackAction` | track id | revalidate | `not_found`, `track_archived` |
| `archiveTrackAction` / `restoreTrackAction` | track id | revalidate | `not_found`, `primary_cannot_archive`, `track_limit` |
| `saveTermAction` | term, track id \| new-track fields | revalidate; `after()` drain when `run = started` | `SaveTermResult` codes |
| `rerunTermAction` | term id | revalidate; `after()` drain | `cooldown` (+ available time), `running`, `not_found` |
| `pauseTermAction` / `resumeTermAction` | term id | revalidate | `not_found` |
| `moveTermAction` | term id, track id | revalidate | `not_found`, `track_archived` |
| `deleteTermAction` | term id | revalidate | — (idempotent) |

Under impersonation (`session.impersonatedBy !== null`), `saveTermAction` and
`rerunTermAction` never schedule `after()` and return `waiting_sweep`.

CLI (`src/cli.ts`):

| Command | Behavior | Exit |
|---|---|---|
| `jho terms run [--max N]` | Enqueue today's captures for every active term key (origin `sweep`), then drain with `runTermCaptures({ worker: "cli" })`; print per-platform aggregates only | 0; 1 when the ingestion guard blocks |
| `jho terms status` | Per-platform aggregate health (same as the admin view) | 0 |
| `jho tracks list [--candidate id]` | Tracks of a candidate with status and scored-job counts | 0 |

Sweep (`.github/workflows/varredura.yml`): one step `pnpm jho terms run` after
`jobs sync` and before `rescore run`.

## Integration Points

| Platform | Endpoint | Budget (ADR-010) | Notes |
|---|---|---|---|
| Remotive | `GET https://remotive.com/api/remote-jobs?search=<q>&limit=100` | 4/day, 2/min, 1 request per run | Proven in code (`aggregators.ts:135-139`); `tags` mapped to `RawJob.tags`; postings arrive with a 24-hour delay |
| RemoteOK | `GET https://remoteok.com/api?tag=<key with spaces as ->` | 1/min, 1 request per run | Undocumented parameter; first array item is the legal notice; enabled only after `jho sources probe remoteok --term <t>` validates it |
| Himalayas | `GET https://himalayas.app/jobs/api/search?q=<q>` + pagination | 1/min, 20 per page, 5 requests per run | Separate endpoint from the feed the sync uses (which ignores `q`); cursor pagination contract validated by probe before enabling |

- Authentication: none; requests carry the existing `JHO_USER_AGENT`.
- Terms of use: each job keeps the platform's original URL and the source label
  names the platform; results are not redistributed.
- Error handling: budgeted calls use `retries: 0`. HTTP 429 →
  `exhaustDay(platform)` and outcome `waiting_quota` with next UTC day.
  5xx and network errors → `failed`, retryable, next daily run. 404/410 on the
  endpoint → `failed` with `endpoint_gone`, not retryable, visible on the admin
  view. Parse errors → `failed` with `parse`.
- `jho sources probe` gains `--term <t>` to exercise `termSearch.search` without
  writing, and now passes the ingestion guard like every network entry point.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/db/schema.ts`, `drizzle/postgres/0004–0006` | modified | 5 tables, `job_score` PK swap with backfill; high risk | Follow `drizzle-safe-migrations`; promotion suspends for human review |
| `src/core/scoring/apply.ts`, `queue.ts` | modified | Scoring per track, relevance gate, no default-profile fallback; medium | Bump `SCORER_VERSION` to `1.4.0`; rescore all |
| `src/core/scoring/score.ts` | modified | Imports `TERM_BOUNDARY`; version bump only; low | — |
| `src/contexts/matching/*` | modified/new | Tracks, track scope, saved terms, `ensureMatchingProfile` writes the primary track; medium | Keep public API in `index.ts` |
| `src/contexts/sourcing/*` | new | Capture queue, quota ledger, attribution, runner, health; medium | Add to context map |
| `src/core/sources/types.ts`, `aggregators.ts`, `config.ts` | modified | `termSearch`, `tags`, handle refinement; low | Probe each platform |
| `src/core/ingest/observe.ts`, `run.ts` | modified | `keepExistingSource`; reopen clears `archived_at`; quota in `syncOne` for budgeted kinds; medium (changes sync behavior for archived jobs) | Regression tests on reopen |
| `src/core/db/repo.ts` | modified | All `job_score` readers take a track scope; board filters and sort; high (many readers) | Architecture test on `scoreTrackFilter` |
| `src/core/apply/dossier.ts`, `analytics/*`, `report/markdown.ts`, `contacts.ts`, `candidate.ts` (gap), `skills/infra/drizzle-adapters.ts`, `ingest/verify.ts`, `verify-queue.ts`, `scrape/infra/drizzle-queue.ts`, `scrape/parser.ts`, `triage/job-sweep.ts`, `app/api/export/route.ts` | modified | Read primary-track rows (rule 30) or cross-candidate primary rows; medium | Add `scoreTrackFilter` / `primaryScoreFilter` |
| `app/jobs/page.tsx`, `app/filters.tsx` | modified | New params and controls; fixes the hard-coded Portuguese literal at `page.tsx:55`; medium | E2E mobile + English checks |
| `app/searches/**`, `app/admin/captures/page.tsx`, `app/nav-links.tsx` | new/modified | New screens and nav entry; medium | Add to `privatePages`, E2E route lists |
| `app/jobs/[id]/page.tsx` | modified | Per-track fits with on-demand computation; low | — |
| `src/core/i18n/pt-BR.ts`, `en.ts` | modified | Sections `searches`, `tracks`, `captures`, filter and notice keys; low | Key parity test |
| `scripts/sw-template.js` | modified | `/searches` added to `NEVER_CACHE` (defense in depth); low | — |
| `src/cli.ts`, `.github/workflows/varredura.yml` | modified | New commands and sweep step; `sourcesFailed` and sync logs never print term text (term sources are not in YAML); low | — |
| `tests/architecture.test.ts`, `docs/engineering/context-map.md` | modified | Table count 35, `sourcing` row, `privatePages`, reader rule; low | — |
| `tests/e2e/setup.mjs`, `ui.mjs` | modified | Fixtures create primary tracks and `track_id`; new route checks; company-name search check updated to whole words; medium | — |
| `docs/scoring.md`, `docs/sources.md`, `docs/data-model.md`, `docs/cli.md` | modified | Document tracks, term search, quota, new commands; low | — |

## Testing Approach

- Frameworks: Vitest with the existing Docker PostgreSQL 17 global setup;
  `useTestDb()` gives each integration suite a migrated database. Pure modules
  (`term.ts`, `money.ts`, track domain, quota decision, capture state) are
  unit-tested without a database. HTTP is faked only at `HttpPort` with
  `fixtureHttp`; fixtures for Remotive, RemoteOK and Himalayas term responses
  come from real probe captures stored under `tests/fixtures/`.
- Unit level covers term validation, keys and patterns (TypeScript and the SQL
  string evaluated against PostgreSQL in one integration case), track merge,
  relevance, suggestion, evidence support, cooldown and new-count rules, quota
  window math, pay normalization, filter parsing.
- Integration level covers the migrations (backfill on a seeded pre-migration
  database), per-track scoring and the relevance gate, the capture runner end to
  end with fixture HTTP (quota, 429, 5xx, attribution, non-reassignment,
  reopen), concurrent drains, the board query with every filter (including a
  10,000-job timing case with a 2-second bound), every `job_score` reader's
  track behavior, Server Action guards, impersonation and the ingestion gate,
  and the CLI commands through `tests/cov-cli-harness.ts`.
- End-to-end level uses `pnpm test:e2e` (isolated build, PostgreSQL, real
  authentication) for the Searches screen, track editor, term save with captures
  off (the E2E environment does not permit ingestion), Jobs screen filters,
  job detail per-track fits, recruiter denial, admin health, 375-pixel layout
  and English-leak checks.
- Every case lives in `_tests.md`.

## Development Sequencing

### Build Order

1. Term kernel (`src/core/term.ts`) and pay normalization in `money.ts` — no
   dependencies.
2. Schema, migrations 0004–0006, context map and architecture test updates —
   depends on nothing but must land before any reader change.
3. Track domain (merge, relevance, suggestion, evidence support) — depends on 1.
4. Track infra and app (CRUD, primary, archive, migration hook in
   `ensureMatchingProfile`), track scope and `scoreTrackFilter` — depends on 2
   and 3.
5. Per-track scoring, relevance gate, queue per track, `SCORER_VERSION` 1.4.0 —
   depends on 4.
6. Every `job_score` reader moved to the track scope — depends on 4 and 5.
7. Ingestion changes (`keepExistingSource`, archive on reopen, `~terms` source,
   handle refinement) — depends on 2.
8. Adapter `termSearch` for Remotive, then RemoteOK and Himalayas after probe
   validation; `RawJob.tags`; `sources probe --term` with guard — depends on 7.
9. Sourcing context: quota ledger (and quota in `syncOne`), capture queue,
   runner, attribution, health — depends on 2, 7 and 8.
10. Saved terms app (save, re-run, pause, move, delete, counts, visits) and
    `jho terms run` / `status` / `tracks list`, sweep step — depends on 4 and 9.
11. Board filters, sort and "new" marker; `readFilters` — depends on 1, 6, 9
    and 10.
12. Screens: Searches, track editor, job detail per-track fits, admin health,
    nav, i18n, service worker list — depends on 10 and 11.
13. E2E fixtures and scenarios, documentation, living QA area for searches and
    tracks — depends on 12.

### Technical Dependencies

- Docker for the Vitest PostgreSQL setup and the E2E harness.
- Human review of migrations 0004–0006 before promotion to staging.
- Production captures require `JHO_SOURCE_ALLOWLIST` to be set; daily repeat
  requires the sweep to be re-enabled (`vars.SUPABASE_CRAWL_ENABLED`).
- Live probe access to Remotive, RemoteOK and Himalayas to capture fixtures and
  validate RemoteOK `tag` and the Himalayas search endpoint.

## Monitoring and Observability

- Metrics (derived from tables, shown on `/admin/captures` and by
  `jho terms status`): per platform, calls used and remaining in the day and
  minute windows, captures by state in the last 24 hours, failures and last
  error code, consecutive failed days, active term count, "daily repeat paused"
  (no `origin = sweep` capture in 36 hours).
- Log events: `jho terms run` prints one JSON line per platform with
  `{platform, claimed, succeeded, waiting, failed, created, known}`; the
  `after()` drain logs the same shape. No log line contains a term, a query or
  a candidate id.
- Alerting: the admin view marks a platform red after 3 consecutive UTC days of
  `failed` captures or any `endpoint_gone`; the sweep step fails the job when
  every platform failed in the run.

## Technical Considerations

### Key Decisions

- Queue plus `after()` for the first run; the sweep drains with the same
  function (ADR-007). Given up: independence from user requests.
- `track_id` in the `job_score` primary key with a central track filter
  (ADR-008). Given up: an additive-only migration.
- Track as a target fragment merged with the person profile; relevance gate on
  accepted tracks (ADR-009). Given up: a fit for every job on every track.
- Durable quota ledger with atomic reservation, no hidden retries on budgeted
  calls (ADR-010). Given up: transparent retry on transient errors.
- `~terms` source per platform and `keepExistingSource` (ADR-011). Given up:
  term captures reusing the regular source rows.
- One whole-word pattern builder, regex without a text index (ADR-012). Given
  up: indexed search now.
- SQL pay normalization from shared constants (ADR-013). Given up: an
  indexable normalized column.

### Known Risks

- RemoteOK `tag` is undocumented and may change (medium). Mitigation: probe
  before enabling; `endpoint_gone` and parse failures surface on the admin view;
  Remotive keeps working alone.
- Himalayas moved to cursor pagination on 2026-08-21 (medium). Mitigation: the
  adapter follows the cursor the probe records; `maxRequestsPerRun` caps calls.
- Regex over descriptions exceeds 2 seconds as the corpus grows (low now).
  Mitigation: the 10,000-job integration case; the hybrid-search trigram index.
- Remotive budget starvation: its sync uses 2 of 4 daily calls (high,
  expected). Mitigation: the Searches screen shows "waiting for quota" with the
  next window; B-11 may later move the keyword sources to term captures.
- `after()` drain cut at 30 seconds (low). Mitigation: 25-second budget, 5-minute
  lease, drain on the next save/re-run and in the sweep.
- Migration on production data (medium). Mitigation: expand/backfill/contract,
  rehearsal against the local snapshot, human review gate.
- Project pay stays "not comparable" because jobs carry no duration (known
  gap, low).

## Architecture Decision Records

- [ADR-001: Saved Term Searches With an Immediate First Run](adrs/adr-001.md) — terms become saved searches that run now and repeat daily.
- [ADR-002: Target Tracks as the Unit of Fit](adrs/adr-002.md) — one primary and several accepted tracks; eligibility stays per person.
- [ADR-003: Every Saved Term Belongs to Exactly One Track](adrs/adr-003.md) — jobs a term brings are measured against a fitting target.
- [ADR-004: Candidate-Triggered Term Capture as a Bounded Exception to Admin-Only Ingestion](adrs/adr-004.md) — validated platforms, never destructive, system-wide quotas.
- [ADR-005: The Jobs Screen Is the Only Results Surface](adrs/adr-005.md) — track selector, whole-word term filter, pay filter.
- [ADR-006: Tracks and Terms Are Private; New Jobs Are Announced In-App Only](adrs/adr-006.md) — owner-only visibility, aggregate admin health.
- [ADR-007: Term Captures Run Through a Table-Backed Queue Drained by `after()` and by the Daily Sweep](adrs/adr-007.md) — one capture function, two callers.
- [ADR-008: Per-Track Fit Lives in `job_score`, Keyed by Track](adrs/adr-008.md) — PK `(candidate_id, track_id, job_id)` and a central track filter.
- [ADR-009: A Track Is a Target Fragment Merged With the Person Profile; Accepted Tracks Score Only Relevant Jobs](adrs/adr-009.md) — scorer unchanged in shape; relevance gate.
- [ADR-010: A Durable Per-Platform Quota Ledger With Atomic Reservation, Shared by Sync and Term Captures](adrs/adr-010.md) — no hidden retries on budgeted calls.
- [ADR-011: Term Captures Ingest Under a Non-Synced Source per Platform, Without Reassigning Jobs](adrs/adr-011.md) — `~terms` sources, `keepExistingSource`, archive cleared on reopen.
- [ADR-012: One Whole-Word Term Pattern Builder for TypeScript and PostgreSQL](adrs/adr-012.md) — shared boundary; no text index yet.
- [ADR-013: Pay Normalization for the Jobs Screen Is Computed in SQL From the Money Module's Constants](adrs/adr-013.md) — filter and sort agree with the displayed amount.
