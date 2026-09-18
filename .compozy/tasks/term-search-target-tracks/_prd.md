# Saved Term Searches and Target Tracks

## Overview

A candidate who types `Laravel` or `PHP` on the Jobs screen today finds
nothing, for three compounding reasons: the free-text filter matches only title
and company, never the description; the fit score measures every job against a
single profile, so a Laravel job scored against an AI-architecture target lands
around 33–37 and the screen hides anything under 45 by default; and no one can
ask the registered platforms for more jobs about a term — sourcing runs a fixed
feed per platform once a day.

The need behind it is common: a candidate prefers one kind of role (Andreus:
AI and architecture) but accepts others to get work sooner (Laravel, PHP,
TypeScript, React, Java, Tech Lead). A candidate in career transition (Renata)
has the same shape of need: a target her current profile does not describe.

This feature lets the candidate say **"bring me more jobs about this term"**
and **"this is a kind of job I accept"**, then triage everything on the Jobs
screen. It introduces:

- **Target tracks** — one primary and several accepted targets per candidate,
  each with its own titles, keywords, seniority and compensation ranges; every
  job is scored against each active track.
- **Saved term searches** — a term (technology or role) linked to a track that
  runs immediately on the registered platforms able to search by term, then
  repeats daily, within each platform's published limits.
- **Jobs screen filters** — a track selector, a term filter that reads
  descriptions, a "brought by my term" filter and a minimum-pay filter that
  compares normalized amounts.

The product's bottleneck is the decision, not discovery (`docs/product/
vision.md`). This feature respects that: captures only add jobs to the corpus,
and every job still reaches the candidate through the Jobs screen's fit cut and
filters, now measured against the target the job actually fits.

It is for candidates. Administrators get aggregate health of term captures;
recruiters see none of it.

## Goals

- A candidate can save a term such as `php`, `Laravel`, `techlead` or `java`,
  link it to a track, and see the registered platforms start fetching jobs for
  it within a minute, with per-platform progress.
- Saved terms keep fetching every day without the candidate asking again, and
  the candidate sees how many new jobs each term brought since the last visit.
- A candidate can hold several target tracks; a Laravel job is measured against
  the Laravel target, and the primary ranking stays untouched by default.
- Typing a term on the Jobs screen finds jobs already in the corpus whose
  description mentions it, and offers to save the term when few match.
- A candidate can filter the Jobs screen by a minimum pay in their currency and
  period, without hiding jobs that do not disclose pay.
- The system guarantees that a term capture never closes, deletes or
  reassigns a job, never exceeds a platform's published limits, and never runs
  where ingestion is not permitted.
- A candidate's tracks, terms and compensation ranges are visible to that
  candidate only.

## User Stories

Canonical catalog: [Full user stories](_user_stories.md).

- US-001–US-006: target tracks — primary migration, creation, editing, primary
  choice, archive, evidence marker
- US-007–US-012: saved terms — save and first run, progress, daily repeat,
  manual re-run, management, validation and equivalence
- US-013–US-017: term capture — platform coverage, quotas, shared calls,
  non-destructive capture, environment gate
- US-018–US-019: fit per track
- US-020–US-025: Jobs screen — track selector, corpus term filter, "brought by"
  filter, minimum pay, undisclosed pay, normalized sort by pay
- US-026: new-job awareness in-app
- US-027–US-029: privacy and operations — recruiter denial, administrator
  aggregate health, impersonation
- US-030: single-fit readers (dossier, statistics, export) use the primary track

## Core Features

### 1. Target tracks

A track is a named target the candidate pursues. It owns target titles
(optionally grouped in title clusters, as the profile already allows), weighted
keywords including negative keywords, target seniority and compensation ranges.
Work eligibility, blockers, work mode, years of experience and evidence belong
to the person and apply to every track. Exactly one track is primary; the
others are accepted.

- The candidate's own matching profile becomes the primary track, so every
  existing fit is preserved. A candidate without an own profile has a pending
  primary track and no ranking, as today (M-06).
- A new track is suggested, then confirmed: from a name and a term, the system
  pre-fills titles and keywords from the skills catalog and the candidate's
  own evidence, and shows the evidence that supports them. The suggestion is
  deterministic. Nothing reaches the score until the candidate confirms.
- The candidate can edit, promote to primary, archive and restore tracks.
- A track whose keywords the candidate's evidence does not support is marked as
  an assumed gap; the marker never changes the fit.

Why: a fit measured against the wrong target is not auditable, and widening
one profile would let accepted roles invade the preferred ranking (ADR-002).

### 2. Saved term searches

A saved term is a word or short phrase — a technology (`Laravel`, `java`) or a
role (`techlead`) — linked to exactly one track (ADR-003).

- Saving starts the first run immediately on every registered, enabled
  platform able to search by term. Each platform reports its own state.
- Every active term runs again with the daily sweep. The candidate may re-run a
  term by hand once per 24 hours.
- Terms can be paused, resumed, moved to another track and deleted; deleting
  never removes a job.
- Spelling variants that differ only by case, spaces or hyphens are the same
  term (`Techlead` = `Tech Lead` = `tech-lead`).

Why: platforms limit repeated calls and some deliver postings a day late, so a
search that keeps working beats a one-off snapshot; the market pattern is
saved searches over an indexed catalog (ADR-001).

### 3. Bounded, non-destructive term capture

Term captures are the only way a candidate causes platforms to be queried, and
they are constrained (ADR-004):

- Only registered, enabled platforms whose integration searches by term **and
  passed validation against the real API** are reached. Proven today: Remotive
  (`search`). Candidates that answered correctly in live tests on 2026-09-18
  but are not yet in their integrations: RemoteOK (`tag`) and Himalayas (search
  endpoint; the current feed endpoint ignores `q`). Adzuna searches by term but
  is disabled and needs credentials. Other registered platforms return whole
  boards that the daily sync already downloads; the Jobs screen term filter
  covers them.
- A term capture adds and refreshes jobs only. It never closes, archives or
  deletes a job and never changes the platform a job is attributed to.
- Platform limits apply to the whole system and count every call to the
  platform, regular sync included; the same normalized term is fetched once per
  platform per day and shared across candidates.
- Captures run only where ingestion is permitted.

### 4. Fit per track

Every open job receives one fit per active track of the candidate. Blockers
and eligibility are evaluated once and apply to every track. Each track's pay
component compares with that track's compensation ranges, and its seniority
component with that track's target seniority. Editing a track recalculates only
that track.

### 5. Jobs screen as the single results surface

Jobs brought in by saved terms are triaged on the existing Jobs screen
(ADR-005), which gains:

- A track selector that opens on the primary track, can switch to another
  track, or shows "all tracks" with each job once, labeled with the track where
  it fits best.
- A term filter over title, company and description, whole-word, for any typed
  term. When the term is not saved, the screen offers to search the platforms
  for it.
- A "brought by my term" filter per active saved term.
- A minimum-pay filter — amount, currency, period — that only filters: it never
  reaches platforms, is not saved with a term and never changes a fit.
- Sort by pay on normalized amounts.

All filter state lives in the URL, as today.

### 6. New-job awareness in-app

Each saved term shows how many jobs it brought since the candidate last opened
the Jobs screen filtered by that term; those jobs carry a "new" marker until
then. Nothing is sent by e-mail or push (ADR-006).

### 7. Privacy and operations

Tracks, terms, run history and compensation ranges are the candidate's alone.
Recruiters see none of it. Administrators see aggregate per-platform health of
term captures without term text, ranges or identities, and reach individual
data only by recorded impersonation, which never starts a capture (ADR-006).

### Interaction between features

A saved term needs a track (feature 1 → 2). A term capture brings jobs into the
shared corpus (3), where every job receives a fit per track (4). The Jobs
screen reads those fits through the track selector and narrows them with the
term, "brought by" and pay filters (5), while term counters point the candidate
to what is new (6).

## Business Rules

### Ownership and limits

1. Tracks and saved terms belong to exactly one candidate. The candidate is
   always taken from the session, never from request input.
2. Each candidate has exactly one primary track at all times. The primary track
   cannot be archived; another track must be promoted first.
3. A candidate has at most **6 active tracks** and **20 active saved terms**.
4. A track name has 1–40 characters after trimming and is unique per candidate
   ignoring case. A track has at least 1 target title and at least 1 keyword;
   keyword weights use the scale the scorer already uses.
5. Per track: target titles (optionally grouped in title clusters), weighted
   keywords including negative keywords, target seniority, and compensation
   ranges with the structure the profile already uses — independent ranges per
   currency and period, each with floor, target and ideal; a range in one
   currency is never a conversion of another (M-01). Per person, shared by all
   tracks: work eligibility, blockers, work mode, years of experience,
   evidence. Negative keywords are per track because a term that disqualifies a
   job for one target (`wordpress` for an AI track) is ordinary in another (a
   PHP track).

### Track lifecycle

6. States: **active** and **archived**. Archiving hides the track from the
   selector, stops showing its fit and pauses its terms; restoring reverses all
   three and recalculates its fit. Archiving and restoring never touch jobs or
   applications.
7. A candidate's own matching profile becomes their primary track exactly once;
   repeated migration never creates a second primary. A candidate without an
   own profile gets a **pending** primary track: no job is scored for them and
   saving terms is disabled until they complete it — the system default
   profile is never used to score another candidate (M-06). Fields a derived
   profile inherited from the system default (titles, compensation) are marked
   "not reviewed" in the track editor until the candidate saves them.
8. Track suggestions are deterministic for the same inputs and come only from
   the term, the skills catalog and the candidate's own evidence. No LLM takes
   part in suggestions or scoring. With an empty skills catalog, the suggestion
   is the term itself as keyword and "<term> Developer" as title, marked thin.
9. For the evidence marker, a keyword is supported only by the candidate's own
   `evidence` entries or skills the candidate confirmed; never by another
   candidate's profile. A keyword present only in `growth` is a gap.

### Saved terms

10. Every saved term belongs to exactly one active track. Moving to an archived
    track is refused.
11. A term has 2–60 characters after trimming, drawn from letters (accented
    included), digits, spaces and `+ # . - /`, and contains at least one letter
    or digit.
12. Terms compare case-insensitively, with spaces and hyphens inside the term
    treated as equivalent. Synonyms are not expanded. A candidate cannot hold
    two saved terms that compare equal.
13. States per term: **active** and **paused**. Deleting removes the term; its
    jobs stay in the corpus without attribution to it.

### Term runs

14. The first run starts within **1 minute** of saving. A manual re-run is
    allowed once per **24 hours** per term, the first run included; while a
    run is in progress, further re-run requests are ignored.
15. Every active term runs once per day with the daily sweep. A missed sweep is
    not made up by stacking runs: the next sweep runs each term once. While the
    daily sweep is turned off for the environment, terms do not repeat and each
    shows "daily repeat paused".
16. Per platform, a term run is in exactly one state, using the run vocabulary
    of `platform-catalog-hybrid-search`: **queued**, **running**,
    **succeeded** (new-to-corpus count and already-known count; closed count is
    always 0), **waiting for quota** (with the next window time), **failed**
    (plain reason; retried in the next daily run) or **skipped** (platform
    disabled, or captures off in this environment). A term whose platforms did
    not all succeed shows **partial**.
17. Reached platforms are those registered, enabled and whose integration
    declares term search and passed validation against the real API. Until the
    administrator platform catalog exists, enablement comes from the existing
    source configuration. A candidate cannot add, edit or enable a platform.
18. Budgets apply to the whole system, per UTC day and per minute, and count
    every call to the platform — regular sync included:

    | Platform  | Budget |
    |-----------|--------|
    | Remotive  | at most 4 calls per day and 2 per minute (its published terms). The two keyword sources already configured use 2, leaving 2 term calls per day. |
    | Himalayas | 20 results per request, at most 5 requests per term run; any "too many requests" answer pauses term calls to it until the next UTC day |
    | RemoteOK  | no published limit: at most 1 call per minute |
    | Adzuna    | only when credentials are configured; at most 1 call per minute |
    | Any term-capable platform added later | at most 1 call per minute unless its published terms are stricter |

19. The same normalized term is fetched from the same platform at most once per
    UTC day; every candidate who saved it receives that result. No candidate
    can learn who else saved a term.
20. A term run keeps at most **100 jobs per platform**, newest first, and
    reports "100 of about N" when there were more.
21. A term run never closes, archives or deletes a job and never changes which
    platform a job is attributed to. Only a 404 or 410 closes a job, and only
    through verification or a complete-snapshot sync. A closed or archived job
    that a term run returns reopens as ADR 0020 item 7 defines: both closure
    and archiving are cleared.
22. A job is attributed to a term only when the term appears as a whole word in
    its title, company, description or the platform's tags for it. Attribution
    is decided when the job is captured, while the platform response is in
    hand; the platform's raw payload is not retained for it (ADR 0019). Looser
    platform matches enter the corpus unattributed.
23. Where ingestion is not permitted, no platform is called; terms save
    normally and show "captures off in this environment".
24. A term that returns zero jobs in 14 consecutive daily runs stays active and
    shows "no results for 14 days".
25. A session under impersonation may view and edit tracks and terms but never
    starts a run; a term saved or re-run request made under impersonation waits
    for the next daily sweep and says so.

### Fit per track

26. Every open job has one fit per active track. Blockers and eligibility are
    evaluated once and apply to every track's fit.
27. A track's pay component compares with that track's compensation ranges;
    its seniority component with that track's target seniority. Missing job
    data scores neutral, never punitive, as today.
28. Editing a track recalculates only that track's fits. Until recalculation
    finishes, the Jobs screen keeps the previous fits and shows a
    "recalculating" notice for that track, using the existing rescoring status.
29. Introducing tracks, and any later change to the scorer or to how tracks
    feed it, bumps the scorer version and recalculates every track's fit; two
    scorer versions are never shown side by side.
30. Surfaces that show one fit per job — the application dossier, statistics by
    cluster, exports and the markdown report — use the primary track's fit
    unless the viewer chose a track.

### Jobs screen

31. Without a track in the URL, the Jobs screen shows the primary track's fit.
    "All tracks" shows each job once, with the fit and label of its best track;
    ties go to the primary track, then to the track listed first.
32. The minimum-fit cut applies to the fit displayed (selected track, or best
    track under "all tracks"); its default stays as today. The title cluster
    filter works inside the selected track and lists only that track's
    clusters.
33. The term filter matches title, company and description as whole words,
    using the scorer's existing term boundary (`docs/scoring.md`, any character
    other than a letter, digit, `+` or `#` separates words), with rule 12's
    equivalences, for any typed term; it combines with every other filter. The
    description is the text the board already uses: the captured page text when
    present, else the posting's description. This replaces today's substring
    match on title and company: `Lara` no longer finds `Laravel`, and `java` no
    longer finds `JavaScript`.
34. When the typed term is not a saved term, the screen offers to save it,
    emphasized when fewer than **10** jobs match.
35. The "brought by my term" filter lists only the viewer's active saved terms;
    a term that is not the viewer's is ignored with a notice.
36. The minimum-pay filter takes an amount from 1 to 10,000,000, a currency with
    a stored exchange rate and a period (month or year). Defaults: the currency
    and period of the primary track's first compensation range, else USD per
    month.
37. Pay comparison converts currency with the latest stored exchange rate and
    normalizes period with the conversions the scorer already uses (2,080 hours
    a year; project pay with a stated duration is annualized). The conversion
    exists only for this filter and its display; it never feeds a fit or a
    compensation range. A job qualifies when the top of its disclosed range (or
    its only disclosed bound) reaches the minimum. Jobs whose disclosed pay is
    entirely below it are hidden, and the screen states how many.
38. Jobs without disclosed pay ("not disclosed") and jobs whose pay cannot be
    compared — currency without a rate, project pay without duration — ("not
    comparable") appear after the qualifying jobs, marked. The "only with
    disclosed pay" toggle hides both groups.
39. The minimum-pay filter never changes a fit and is never stored with a saved
    term.
40. Sort by pay orders by the normalized amount in the filter's currency and
    period (or the defaults of rule 36); undisclosed and non-comparable jobs
    sort last; ties break by fit, then by a stable identifier.
41. Every filter and the track selection live in the URL.

### New-job awareness

42. A saved term's "new" count is the number of jobs attributed to it that
    entered the corpus after the candidate last opened the Jobs screen filtered
    by that term; before the first such visit, it counts every job the term
    brought. Opening that view clears the count. Closed jobs leave the count.
43. Announcements are in-app only. Nothing is sent by e-mail or push.

### Visibility

44. Tracks, saved terms, run history and per-track compensation ranges are
    visible and editable only by the owning candidate. New permissions are
    owner-only and denied by default; recruiter access to a linked candidate
    (`candidate:read`) never extends to them.
45. Recruiters are denied the tracks and terms screens, and no view or export
    available to them shows a track, term, per-track fit or compensation range —
    including the pending recruiter view of linked candidates
    (`job-lifecycle-retention` task_03). The public profile never shows any of
    them.
46. Administrators see, per platform: calls used and remaining in the current
    window, runs waiting for quota, failures and last error, and the number of
    active terms system-wide — never term text, ranges or candidate identities.
    Term captures appear in any administrator run inspection only in this
    aggregate form. Individual data is reachable only through recorded
    impersonation (rule 25); bulk administrative views stay off while
    impersonating.
47. Term text never appears in logs, command output or the daily sweep's review
    snapshot, which carry aggregates only (ADR 0018).

### Standing invariants this feature must keep

48. LinkedIn is never a platform and is never queried; the job-alert e-mail
    stays the legitimate LinkedIn channel (AGENTS.md rule 1, ADR 0001, ADR 0008).
49. Captures write jobs only; they never write applications (rule 2).
50. Jobs that disappear are closed, never deleted (rule 3).
51. Nothing submits an application (rule 13, ADR 0010).
52. A source that names the employer is worth more than anonymous volume; term
    captures do not change how sources are weighed.

## User Experience

### Personas and goals

- **Andreus (P1)** — wants more AI roles, accepts PHP/Laravel, TypeScript/React,
  Java and Tech Lead roles; wants the system to fetch them and to triage on the
  Jobs screen.
- **Renata (P3)** — builds a track toward ML platform work and needs honest gap
  markers.
- **Administrator** — keeps platform integrations healthy and within quotas.
- **Recruiter** — unaffected; must not see any of this.

### Primary flows

1. **From a failed search to a saved term.** On the Jobs screen the candidate
   types `Laravel`. The corpus filter now reads descriptions and shows what
   exists. Next to the filter, "Search the platforms for 'Laravel'" is offered
   (emphasized when fewer than 10 match). Choosing it opens the save form with
   the term pre-filled and a track pre-selected when one already contains the
   keyword; otherwise the candidate creates a track from the suggestion,
   reviews titles, keywords and supporting evidence, and confirms. The term
   appears with per-platform state.
2. **Managing searches.** A "Searches" screen groups saved terms under their
   tracks. Each term shows its state per platform, last run, next run, new-job
   count and actions (open results, run again, pause, move, delete). The screen
   states which platforms search by term and that the rest are covered by the
   daily sync.
3. **Daily return.** The candidate opens Searches or the Jobs screen, sees new
   counts per term, and opens a term, landing on the Jobs screen filtered by
   "brought by" that term with its track selected. New jobs carry a marker.
4. **Triaging with pay.** On the Jobs screen the candidate sets "at least USD
   6,000 per month". Qualifying jobs show the converted amount next to the
   original; undisclosed and non-comparable jobs follow, marked; a line states
   how many were hidden for being below the minimum.
5. **Managing tracks.** From Searches, the candidate edits a track's titles,
   keywords, seniority and compensation ranges, promotes a track to primary, or
   archives one. After an edit the Jobs screen notes that fits for that track
   are being recalculated.
6. **Operations.** The administrator opens a term-capture health view listing,
   per platform, quota use, waiting runs and failures.

### UI considerations

- Every text comes from the dictionary in pt-BR and en; controls are found by
  `data-testid`, never by text. Track names and terms are user content and are
  marked as such, so the English-screen check does not flag their accents.
- Components use only the theme's semantic tokens and the existing type and
  spacing scales; all three themes, light and dark.
- Every new screen and control works at 375px width without horizontal scroll.
- State is conveyed by text, not color alone (run states, "new", "not
  disclosed", "not comparable", "assumed gap", "not reviewed").
- Pages show the current state when loaded or reloaded; they do not poll and
  send no client JavaScript for it, as the existing rescoring status does.

### Discoverability

- The Jobs screen term filter is the main entry point (flow 1).
- A navigation entry leads to Searches.
- The empty state of a term filter names the term and offers to save it.

## High-Level Technical Constraints

- **Integrations**: only platforms already registered through the existing
  source-adapter port. Term search is a capability of an integration, declared
  honestly and validated against the real API before use (`jho sources probe`).
  RemoteOK's `tag` is undocumented, and Himalayas' feed endpoint ignores `q`
  while its separate search endpoint honors it; both need validation before
  they count as coverage.
- **Platform terms of use**: jobs from Remotive, RemoteOK and Himalayas are
  shown with the platform's name and a link to the original posting; results
  are not redistributed to third parties.
- **Environment gate**: every entry point that can start a term capture (web
  action, runner, daily sweep) passes the same ingestion guard (ADR 0021):
  production requires the allowlist, local requires opt-in, dev/staging/preview
  deny. Synthetic fixtures for non-production environments include tracks,
  terms and runs.
- **Runtime**: there is no continuous worker; serverless functions stop at 30
  seconds; the daily sweep runs outside the web runtime and is currently paused
  in production. A capture cannot run inside a page request, and an immediate
  first run must use the same capture pipeline as the sweep, never a second one.
  Captures use the existing table-backed queue (ADR 0009).
- **Quota durability**: the per-platform budget is shared by every runtime
  (web, runner, sweep) and survives restarts; an in-memory limiter per process
  is not enough. A slot is reserved before any network wait.
- **Storage**: production runs on a storage-limited plan with alert thresholds
  (`docs/engineering/supabase-opportunities.md`). Per-track fits multiply score
  rows (6 tracks × 10,000 open jobs = 60,000 per candidate) and term captures
  grow the corpus. Enabling term captures in production requires a storage
  estimate within the approved budget.
- **Performance, from the user's side**: the first run starts within 1 minute of
  saving; with quota available, all platforms of a run typically finish within
  5 minutes; the Jobs screen with term, track and pay filters answers within 2
  seconds for a corpus of 10,000 open jobs; recalculating one track's fits for
  10,000 jobs finishes within 15 minutes.
- **Authorization**: deny-by-default policy; every page and action checks
  permission before any effect; the candidate scope comes from the session.
  Route-level tests per role prove the composition, not only the policy.
- **Privacy**: no credential is stored in the database (Adzuna keys stay as
  environment-variable names); the service worker never caches the Searches
  screen, run state or counters.
- **Scoring**: the score remains a weighted rubric with no embeddings or LLM;
  scorer changes bump the scorer version (today `1.3.0`) and trigger a full
  recalculation; missing data stays neutral.
- **Data model**: fit per track changes the identity of a fit (today one per
  candidate and job) and ADR 0007's fit assessment; the migration must follow
  the safe-migration process and suspends automatic promotion. Every new foreign
  key declares its delete action. New tables are placed in the context map.
- **Architecture boundary**: capturing from platforms belongs to sourcing;
  tracks, fits, listing and ranking belong to matching. The dashboard and the
  CLI use the same public APIs; queries are not duplicated between them.
- **Living QA**: the Jobs screen search changes meaning (whole-word, with
  descriptions), so affected QA scenarios reset to untested, and a new QA area
  for searches and tracks is registered before its first scenario.

### Relationship to existing work

- **`platform-catalog-hybrid-search`** (planned, not implemented) — amended on
  2026-09-18 to reference this PRD:
  - Its business rule 2 (candidates cannot run ingestion) and rule 6 (run
    scopes) gain the term-capture exception and scope defined here.
  - Its capture profiles are the natural home for term captures: a candidate's
    private saved term resolves to a system capture profile per platform and
    normalized term; that PRD owns the profile concept, this PRD owns saved
    terms and the quota ledger, which applies to every platform call.
  - Its run inspection (its rule 1 and its story US-031) shows term captures
    only in aggregate.
  - Its impersonation rule (its story US-029) and this PRD's rule 25 agree:
    impersonation never starts a run.
  - Its description search (its story US-017) extends the lexical filter
    defined here; its proximity and semantic matching (its stories US-018 and
    US-020, its ADR-001) only reorder or appear in a separately labeled group,
    and never change which jobs the whole-word filter returns. Full-text
    parsing that drops `#` or `+` is an ordering signal only.
  - The amendments are recorded in that PRD as A1–A6.
  - Its "salary" exact filter is replaced by this PRD's minimum-pay rules.
- **B-11 (source completeness and identity, backlog)** — owns the contract that
  separates complete snapshots from partial windows. The two keyword sources on
  Remotive and the capped Himalayas feed close jobs by absence today; moving
  them to non-closing captures belongs there. This PRD depends on it for the
  non-reassigning ingestion path of rule 21.
- **`job-lifecycle-retention`** — rule 21 relies on ADR 0020 item 7. Today the
  regular sync reopens a job without clearing its archiving (only
  verification does); that defect belongs to the lifecycle work and blocks rule
  21's guarantee for archived jobs.
- **M-01, M-02, M-04, M-06 (backlog)** — compensation ranges (M-01) and period
  normalization (M-02) are reused; sort by pay (M-04, marked done) sorts raw
  numbers today and is corrected here; the no-own-profile rule (M-06) is kept.
- **`next-backlog-wave`** — the rescoring status card is extended for
  per-track recalculation, not duplicated; queue state stays private to the
  candidate; adapter fixtures cover term search.
- **Roadmap 2.2 (scheduled sync, paused)** — daily repeat depends on it.

## Non-Goals (Out of Scope)

- **CV or dossier tailored to a track.** Adjusting the CV for a kind of job is
  a future feature that needs its own planning; this PRD only finds relevant
  jobs (user decision).
- **E-mail or push notifications** for new jobs — in-app only (user decision).
- **Recruiter access** to tracks, terms or ranges, including for linked
  candidates (user decision).
- **One-off live federated search** that does not save the term (ADR-001).
- **Pay filter beyond the Jobs screen** — it is not sent to platforms, not saved
  with terms and does not affect fit (user decision).
- **Adding platforms.** This feature uses registered platforms only; new
  platforms follow the existing source-addition process. Evaluated during
  research and left for that process: Get on Board (Latin America, public API
  with keyword search), Jobicy (`tag`, one call per hour), LaraJobs (official
  Laravel board, undocumented JSON, about 16 open jobs) and web3.career (token).
- **Scraping search-result pages** of any platform, and LinkedIn in any form.
- **Proximity or semantic search** (trigram, embeddings) and the administrator
  platform catalog UI — both belong to `platform-catalog-hybrid-search`.
- **Fixing the regular sync's closure of partial windows** — B-11.
- **Automatic application submission.**

## Architecture Decision Records

- [ADR-001: Saved Term Searches With an Immediate First Run](adrs/adr-001.md) —
  a term becomes a saved search that runs now and repeats daily, instead of a
  one-off live search or a next-day-only schedule.
- [ADR-002: Target Tracks as the Unit of Fit](adrs/adr-002.md) — one primary and
  several accepted tracks with their own titles, keywords, seniority and
  compensation ranges; eligibility stays per person; the board opens on the
  primary track.
- [ADR-003: Every Saved Term Belongs to Exactly One Track](adrs/adr-003.md) —
  guarantees jobs a term brings are measured against a fitting target.
- [ADR-004: Candidate-Triggered Term Capture as a Bounded Exception to
  Admin-Only Ingestion](adrs/adr-004.md) — validated term-capable platforms
  only, never destructive, system-wide quotas counting every call, shared
  calls, environment gate, no runs under impersonation.
- [ADR-005: The Jobs Screen Is the Only Results Surface](adrs/adr-005.md) —
  track selector, whole-word term filter over descriptions, "brought by"
  filter, normalized minimum-pay filter that keeps undisclosed pay visible.
- [ADR-006: Tracks and Terms Are Private; New Jobs Are Announced In-App
  Only](adrs/adr-006.md) — owner-only visibility, aggregate admin health, term
  text out of logs, no e-mail.

The exception to admin-only ingestion (ADR-004) and the privacy of tracks
(ADR-006) outlive this feature; when it ships they move to `docs/adr/` (ADR
0011).

## Open Questions

- **Postings repeated per country.** Himalayas returned 19 of 20 results for
  `laravel` as two postings repeated per country. Today each location is a
  separate job; grouping them changes job identity and needs a decision.
- **First-run mechanism in production.** No continuous worker exists and the
  daily sweep is paused; the TechSpec must show how the 1-minute start is met
  through the sweep's pipeline, or the target returns to the user.
- **Production allowlist per platform.** The ingestion allowlist only checks
  that it is not empty; whether it should name platforms is open.
- **Per-track minimum-fit default.** The default cut (45) is global today;
  whether accepted tracks need a different default is open.
- **Adzuna.** It searches by term but is disabled and needs credentials;
  enabling it is an operator decision.
- **Existing scorer artifact.** The target title "AI Engineer" loses "ai" to the
  short-word filter and matches any "… Engineer" title (about 21 title points
  in the `ai_lead` cluster), so a "Senior PHP Engineer" already scores 55–58 on
  the primary track while "Senior PHP Developer" scores 33–37 (manual
  estimates). Fixing it changes every primary-track fit and needs its own
  decision; tracks make the distortion visible but do not fix it.
