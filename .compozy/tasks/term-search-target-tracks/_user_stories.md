# User Stories: Saved Term Searches and Target Tracks

Canonical behavior catalog for saved term searches, target tracks and the Jobs
screen filters that browse their results. Companion to `_prd.md`; consumed by
`_techspec.md` (component mapping) and `_tests.md` (coverage matrix).

## Personas

- **Andreus (P1, candidate)** — Senior AI software architect, remote B2B from
  Brazil, no US work authorization. Prefers AI and architecture roles but
  accepts Laravel, PHP, TypeScript, React, Java or Tech Lead roles to get work
  sooner. Needs the system to go fetch more jobs about a term and to rank them
  against a target that fits them, then to triage everything on the Jobs screen.
- **Renata (P3, candidate in transition)** — Senior data engineer moving into
  ML platform work. Her desired track is supported by `growth:` more than by
  `evidence:`; she needs a track for where she is going, with gaps stated
  honestly.
- **Administrator** — keeps platforms healthy and quotas respected. Needs
  aggregate operational visibility without reading any candidate's strategy.
- **Recruiter** — authenticated user linked to candidates. Must never see a
  candidate's tracks, terms or compensation ranges.

## Story Index

| ID     | Feature Area              | Persona       | Story                                                        |
|--------|---------------------------|---------------|--------------------------------------------------------------|
| US-001 | Target tracks             | Andreus       | Current matching profile becomes the primary track           |
| US-002 | Target tracks             | Andreus       | Create an accepted track, suggested then confirmed           |
| US-003 | Target tracks             | Andreus       | Edit a track's titles, keywords, seniority and pay ranges    |
| US-004 | Target tracks             | Andreus       | Choose which track is primary                                |
| US-005 | Target tracks             | Andreus       | Archive and restore a track                                  |
| US-006 | Target tracks             | Renata        | See that a track has no supporting evidence yet              |
| US-007 | Saved terms               | Andreus       | Save a term linked to a track and start its first run        |
| US-008 | Saved terms               | Andreus       | Follow a term run's progress per platform                    |
| US-009 | Saved terms               | Andreus       | Saved terms repeat daily on their own                        |
| US-010 | Saved terms               | Andreus       | Re-run a term by hand within the cooldown                    |
| US-011 | Saved terms               | Andreus       | Pause, resume, move or delete a term                         |
| US-012 | Saved terms               | Andreus       | Term validation and equivalent spellings                     |
| US-013 | Term capture              | Andreus       | See which platforms a term reached and which it cannot       |
| US-014 | Term capture              | Administrator | Platform quotas hold for the whole system                    |
| US-015 | Term capture              | Andreus       | Same term saved by several candidates costs one call         |
| US-016 | Term capture              | Andreus       | A term run never hides, closes or reassigns a job            |
| US-017 | Term capture              | Andreus       | Term runs are off where ingestion is not permitted           |
| US-018 | Fit per track             | Andreus       | Each job carries a fit per active track                      |
| US-019 | Fit per track             | Andreus       | Track pay ranges and seniority shape its fit                 |
| US-020 | Jobs screen               | Andreus       | Track selector opens on the primary track                    |
| US-021 | Jobs screen               | Andreus       | Filter the corpus by any term, including descriptions        |
| US-022 | Jobs screen               | Andreus       | Filter to jobs a saved term brought in                       |
| US-023 | Jobs screen               | Andreus       | Filter by minimum pay in my currency and period              |
| US-024 | Jobs screen               | Andreus       | Undisclosed or non-comparable pay stays visible, marked      |
| US-025 | Jobs screen               | Andreus       | Sort by pay compares normalized amounts                      |
| US-026 | New-job awareness         | Andreus       | See how many new jobs each term brought since my last visit  |
| US-027 | Privacy and operations    | Recruiter     | Recruiter cannot see tracks, terms or pay ranges             |
| US-028 | Privacy and operations    | Administrator | Aggregate term-capture health without private data           |
| US-029 | Privacy and operations    | Administrator | Impersonation reaches a candidate's tracks, recorded         |
| US-030 | Single-fit readers        | Andreus       | Dossier, statistics and exports use the primary track        |

## Target Tracks

### US-001: Current matching profile becomes the primary track

**As** Andreus, **I want** my existing matching profile to become my primary
track, **so that** my AI ranking stays exactly as it is when tracks arrive.

Acceptance criteria:

- AC-1: Given a candidate with their own matching profile, when tracks become
  available, then the candidate has exactly one track, marked primary, whose
  titles, keywords, seniority and compensation ranges equal that profile.
- AC-2: Given that migration, when the candidate opens the Jobs screen, then
  every job's primary-track fit equals the fit the previous profile produces
  under the current scorer version.
- AC-3: Given the tracks screen, when the candidate opens it, then the primary
  track is listed first and labeled "primary".

Edge cases:

- EC-1: Candidate without an own matching profile → the primary track is
  pending: no job is scored for them, the Jobs screen shows no ranking (as
  today), and saving a term is disabled with a message to complete the primary
  track first. The system default profile never scores another candidate.
- EC-2: Candidate whose derived profile inherited titles or compensation from
  the system default → those fields show "not reviewed" in the track editor
  until the candidate saves them.
- EC-3: Migration runs twice → still exactly one primary track; no duplicate.
- EC-4: Candidate who is also an administrator → gets their own primary track
  like any candidate; no administrative shortcut changes it.
- EC-5: Migration interrupted mid-way → on the next start the candidate either
  has the full primary track or none; never a partially copied one.
- EC-6: Scale — a deployment with many candidates → each receives only their
  own primary track; no candidate sees another's.

### US-002: Create an accepted track, suggested then confirmed

**As** Andreus, **I want** to create a "PHP/Laravel" track from a name and a
term with titles and keywords pre-filled, **so that** I do not start from zero
and nothing reaches my score without my confirmation.

Acceptance criteria:

- AC-1: Given a name and a term (`Laravel`), when the candidate asks for a new
  track, then the form shows suggested target titles, weighted keywords and the
  candidate's own evidence that supports them, all editable.
- AC-2: Given the suggestion, when the candidate confirms, then the track is
  created as accepted (not primary) and jobs start receiving a fit for it.
- AC-3: Given the suggestion, when the candidate cancels, then no track exists
  and no fit changes.
- AC-4: Given the same inputs twice, when suggestions are generated, then they
  are identical (deterministic).

Edge cases:

- EC-1: Name empty, only spaces, or longer than 40 characters → rejected with a
  message naming the limit.
- EC-2: Name equal to an existing track's name ignoring case → rejected with a
  message pointing to the existing track.
- EC-3: Term unknown to the skills catalog and absent from evidence → the form
  pre-fills the term itself as a keyword and a generic title built from it
  ("<term> Developer"), and marks the suggestion as thin.
- EC-4: Candidate already has 6 active tracks → creation is refused with a
  message to archive one first.
- EC-5: Candidate confirms with zero titles or zero keywords → rejected; a
  track needs at least one of each.
- EC-6: Double submit of the confirmation → exactly one track is created.
- EC-7: Session expires before confirmation → the candidate is sent to login;
  no track is created; nothing is half-saved.
- EC-8: Recruiter or unauthenticated user → cannot reach the form (access
  denied, as any candidate-only screen).
- EC-9: Hostile text in name or term (markup, script) → shown as plain text,
  never interpreted.
- EC-10: Keyword weight outside the scale → rejected with the allowed range.
- EC-11: Skills catalog empty → the suggestion is the term as keyword and
  "<term> Developer" as title, marked thin; the candidate can still confirm.

### US-003: Edit a track's titles, keywords, seniority and pay ranges

**As** Andreus, **I want** to adjust a track's target titles, keywords,
seniority and compensation ranges, **so that** its fit reflects what I accept.

Acceptance criteria:

- AC-1: Given a track, when the candidate saves edits, then the track shows
  the new values and the Jobs screen states that fits for that track are being
  recalculated.
- AC-2: Given the recalculation finished, when the candidate opens the Jobs
  screen, then every job's fit for that track reflects the edits.
- AC-3: Given compensation ranges per currency and period (floor, target,
  ideal), when saved, then each range is shown back exactly as entered and no
  range is derived by converting another.
- AC-4: Given an edit to one track, when fits are recalculated, then fits for
  other tracks do not change.
- AC-5: Given a negative keyword (`wordpress`) on the primary track only, when a
  job mentions it, then only the primary track's fit is penalized.

Edge cases:

- EC-1: A range amount zero, negative, non-numeric or above 10,000,000, or a
  floor above its target or a target above its ideal → rejected with the rule.
- EC-2: Two ranges with the same currency and period → rejected; one range per
  currency and period.
- EC-3: Removing the last title or last keyword → rejected.
- EC-4: Two tabs edit the same track → the later save wins and the earlier tab,
  on its next save, is told the track changed and shown the current values.
- EC-5: Edit while a previous recalculation is still running → the newest edit
  is the one reflected when recalculation finishes; no mix of both.
- EC-6: Edit on an archived track → allowed; no recalculation runs until the
  track is restored.
- EC-7: While recalculating, the candidate reloads the Jobs screen → previous
  fits stay visible with the "recalculating" notice; no blank fits.

### US-004: Choose which track is primary

**As** Andreus, **I want** to choose which track is primary, **so that** the
Jobs screen opens on what I prefer right now.

Acceptance criteria:

- AC-1: Given two tracks, when the candidate marks the accepted one as primary,
  then it becomes primary and the former primary becomes accepted.
- AC-2: Given the change, when the candidate opens the Jobs screen without a
  track in the URL, then it opens on the new primary track.
- AC-3: At every moment the candidate has exactly one primary track.

Edge cases:

- EC-1: Marking an archived track as primary → refused; restore it first.
- EC-2: Two tabs promote different tracks → the later promotion wins; still
  exactly one primary.
- EC-3: A shared link with an explicit track in the URL → opens on that track
  regardless of which is primary.
- EC-4: Link naming a track the viewer does not own → opens on the viewer's
  primary track with a notice; never another candidate's track.

### US-005: Archive and restore a track

**As** Andreus, **I want** to archive a track I no longer pursue, **so that** it
stops shaping my board without losing its history.

Acceptance criteria:

- AC-1: Given an accepted track, when archived, then it disappears from the
  Jobs screen selector, its fit is no longer shown, and its saved terms are
  paused.
- AC-2: Given an archived track, when restored, then it returns to the
  selector, fits are recalculated and its terms resume.
- AC-3: Archiving never removes a job or an application.

Edge cases:

- EC-1: Archiving the primary track → refused with a message to promote
  another track first.
- EC-2: Archiving the only accepted track → allowed; the primary remains.
- EC-3: Restoring when 6 tracks are already active → refused with the limit.
- EC-4: Archive while one of its terms is running → the running capture
  finishes; no new run starts; its jobs stay in the corpus.
- EC-5: An application exists for a job whose best fit came from the archived
  track → the application is untouched; the job shows the fit of the
  remaining tracks.
- EC-6: Archive requested twice → one archived track; second request is a
  no-op.

### US-006: See that a track has no supporting evidence yet

**As** Renata, **I want** a track whose keywords my evidence does not support
to say so, **so that** I pursue the transition honestly.

Acceptance criteria:

- AC-1: Given a track where none of the keywords is supported by the
  candidate's own `evidence` entries or confirmed skills, when the track is
  shown, then it is marked "no evidence yet — assumed gap".
- AC-2: Given a track with partial support, when shown, then it lists which
  keywords have evidence and which are gaps.
- AC-3: The evidence marker never changes the fit.

Edge cases:

- EC-1: Candidate with no evidence at all → every track shows the marker; the
  candidate can still create and use tracks.
- EC-2: Evidence edited later → markers update on the next view.
- EC-3: Keyword present only in `growth:` → counted as a gap, never as
  evidence.
- EC-4: Evidence inherited from the system default profile (another person's)
  → never counts as support for this candidate.

## Saved Terms

### US-007: Save a term linked to a track and start its first run

**As** Andreus, **I want** to save `java` and have the system start fetching
jobs about it immediately, **so that** I get more relevant jobs without asking
again.

Acceptance criteria:

- AC-1: Given the terms screen, when the candidate enters a term, picks an
  existing track or creates one (US-002), and saves, then the term appears
  under that track with status "running".
- AC-2: Given the save, then the first run starts within 1 minute.
- AC-3: Given the term already appears in one of an existing track's keywords,
  when entering it, then that track is pre-selected.
- AC-4: Given the Jobs screen term filter holding an unsaved term, when the
  candidate chooses "search the platforms for this term", then the save form
  opens pre-filled with it.

Edge cases:

- EC-1: No track chosen and none created → save refused; every term belongs to
  a track.
- EC-2: Candidate already has 20 active terms → refused with the limit.
- EC-3: Same normalized term already saved by this candidate → refused with a
  link to the existing term.
- EC-4: Double submit → exactly one term and one first run.
- EC-5: Connection lost after pressing save → on reload, either the term exists
  (and its run started) or it does not; never a term without a status.
- EC-6: Primary track pending (US-001 EC-1) → saving disabled with a message.
- EC-7: Environment where captures are off → term saved; status "captures off
  in this environment" (US-017).
- EC-8: Saved under impersonation → the term is saved but no run starts; it
  shows "waiting for the next daily sweep".

### US-008: Follow a term run's progress per platform

**As** Andreus, **I want** to see each platform's progress for my term, **so
that** I know what was searched, what came back and what is still pending.

Acceptance criteria:

- AC-1: Given a running term, when the candidate views it, then each platform
  shows one state: queued, running, succeeded, waiting for quota, failed or
  skipped.
- AC-2: Given a platform succeeded, then it shows how many jobs were new to the
  corpus and how many were already known; the closed count is always 0.
- AC-3: Given the candidate leaves and returns or reloads, then the state shown
  is the current one; nothing restarts, and the page does not poll.
- AC-4: The page never blocks while platforms run; other screens stay usable.
- AC-5: Given a run where not every platform succeeded, then the term shows
  "partial".

Edge cases:

- EC-1: A platform fails → marked failed with a plain reason; other platforms
  continue; the failed one is retried in the next daily run.
- EC-2: A platform hits its quota → "waiting for quota" with the time of the
  next window.
- EC-3: A platform returns more than 100 jobs → the first 100, newest first,
  and the state says "100 of about N".
- EC-4: A platform returns zero → succeeded with 0; not an error.
- EC-5: The process restarts mid-run → pending platforms resume or are marked
  failed and retried in the next window; completed platforms keep their result.
- EC-6: All platforms skipped → the term shows "no platform can search this
  term right now", and the Jobs screen term filter still works on the corpus.

### US-009: Saved terms repeat daily on their own

**As** Andreus, **I want** my terms to run again every day, **so that** I see
new postings within their first days.

Acceptance criteria:

- AC-1: Given an active term, when the daily sweep runs, then the term is run
  again on every term-capable platform, within quotas.
- AC-2: Given a daily run, then only jobs not seen before count as new.
- AC-3: Given a paused term, then the daily sweep skips it.

Edge cases:

- EC-1: The daily sweep does not happen (outage) → the next sweep runs each
  term once; runs are not stacked.
- EC-2: A term returns zero jobs for 14 consecutive daily runs → it stays
  active and shows "no results for 14 days".
- EC-3: A term manually re-run in the last 24 hours → the daily run of that
  term on the same platform reuses that result (US-015).
- EC-4: Scale — 20 terms for each of many candidates → runs are spread within
  quotas; terms that do not fit today's window wait, labeled.
- EC-5: Daily sweep turned off for the environment → no term repeats; each
  active term shows "daily repeat paused".

### US-010: Re-run a term by hand within the cooldown

**As** Andreus, **I want** to re-run a term, **so that** I can check again after
editing its track or after a failure.

Acceptance criteria:

- AC-1: Given a term not run in the last 24 hours, when the candidate chooses
  "run again", then a run starts within 1 minute.
- AC-2: Given a term run in the last 24 hours, then "run again" is disabled and
  states when it becomes available.

Edge cases:

- EC-1: "Run again" while the term is running → ignored; the current run is
  shown.
- EC-2: Only one platform failed in the last run → "run again" is allowed
  inside the cooldown for that platform alone; it runs when that platform's
  quota allows, otherwise it waits for the next window.
- EC-3: Double click → one run.
- EC-4: Requested under impersonation → no run starts; the term shows
  "waiting for the next daily sweep".

### US-011: Pause, resume, move or delete a term

**As** Andreus, **I want** to manage my terms, **so that** the system fetches
only what I still want.

Acceptance criteria:

- AC-1: Pause → no automatic or manual runs; status "paused".
- AC-2: Resume → included in the next daily run; manual run allowed if outside
  cooldown.
- AC-3: Move to another track → the term's jobs show under the new track's
  selector filter from then on.
- AC-4: Delete → the term disappears; its jobs stay in the corpus; the
  "brought by" filter for it is no longer offered.

Edge cases:

- EC-1: Delete while running → the run finishes; results stay in the corpus
  without attribution to the deleted term.
- EC-2: Move to an archived track → refused.
- EC-3: Delete twice → second request is a no-op.
- EC-4: A job the deleted term brought in has an application → application
  untouched; job stays.

### US-012: Term validation and equivalent spellings

**As** Andreus, **I want** `Techlead`, `Tech Lead` and `tech-lead` to mean the
same term, **so that** spelling does not decide what I find.

Acceptance criteria:

- AC-1: Terms match case-insensitively and treat spaces and hyphens inside the
  term as equivalent.
- AC-2: A term is 2 to 60 characters after trimming, made of letters (accented
  included), digits, spaces and `+ # . - /` (so `C++`, `C#`, `.NET`, `Node.js`
  and `CI/CD` are valid).
- AC-3: Synonyms are not expanded (`Technical Lead` is a different term); the
  track's target titles carry them.

Edge cases:

- EC-1: One character, empty, or over 60 → rejected with the limit.
- EC-2: Characters outside the allowed set → rejected, naming the character.
- EC-3: Only punctuation (`++`) → rejected.
- EC-4: Leading or trailing spaces → trimmed before validation and comparison.
- EC-5: `Tech Lead` saved while `techlead` exists → treated as duplicate
  (US-007 EC-3).

## Term Capture

### US-013: See which platforms a term reached and which it cannot

**As** Andreus, **I want** to know which platforms search by term and which are
only covered by the daily sync, **so that** I read the result honestly.

Acceptance criteria:

- AC-1: The terms screen lists the platforms a term run reaches (registered,
  enabled, declaring term search and validated against the real API) and
  states that other registered platforms are covered by the daily sync and by
  the Jobs screen term filter.
- AC-2: Only registered platforms are ever queried; a candidate cannot add,
  edit or enable a platform.

Edge cases:

- EC-1: Administrator disables a platform after terms were saved → that
  platform shows "skipped — platform disabled" in later runs.
- EC-2: A platform's term parameter stops working (wrong or empty results
  where it used to return) → the platform is marked failed with the reason; the
  administrator sees it in aggregate health (US-028).
- EC-3: A platform whose term search has not passed validation (for example,
  Himalayas' feed endpoint that ignores `q`) → not listed as reached and never
  queried by a term run.

### US-014: Platform quotas hold for the whole system

**As** an administrator, **I want** every platform's published limits honored
across all candidates, **so that** the system never loses API access.

Acceptance criteria:

- AC-1: Each platform's budget (PRD Business Rules, rule 18) is enforced
  system-wide per window and counts every call to that platform, regular sync
  included.
- AC-2: When a budget is spent, pending runs wait for the next window, labeled
  "waiting for quota"; none exceeds the limit.
- AC-3: A platform answering "too many requests" pauses term calls to it until
  its next window.
- AC-4: The budget holds across every runtime that calls platforms (web
  action, runner, daily sweep) and across restarts.

Edge cases:

- EC-1: Many candidates save terms at the same minute → calls are serialized
  within the per-minute limit; nothing is dropped.
- EC-2: Window boundary crossed during a run → calls after the boundary count
  toward the new window.
- EC-3: Platform with no published limit → the conservative default applies.
- EC-4: Remotive's daily budget already used by its two configured keyword
  sources → only 2 term calls remain that day; further terms wait.

### US-015: Same term saved by several candidates costs one call

**As** Andreus, **I want** my term to reuse a same-day result another candidate
already fetched, **so that** quotas stretch and I still get my jobs.

Acceptance criteria:

- AC-1: The same normalized term on the same platform is fetched at most once
  per day; every candidate who saved it gets the jobs.
- AC-2: No candidate can learn who else saved the term.

Edge cases:

- EC-1: Two candidates save the same term at the same moment → one call; both
  terms show the result.
- EC-2: A candidate's term reuses a result from earlier today → their run shows
  "succeeded" with that result's counts, stated as reused.

### US-016: A term run never hides, closes or reassigns a job

**As** Andreus, **I want** term runs to only add and refresh jobs, **so that** a
narrow search never makes a good job disappear.

Acceptance criteria:

- AC-1: A term run never closes, archives or deletes a job.
- AC-2: A job already attributed to a platform keeps that attribution after a
  term run returns it.
- AC-3: A job counts as a result of a term only when the term appears as a
  whole word in its title, company, description or the platform's tags;
  looser platform matches still enter the corpus, unattributed. Attribution is
  decided when the job is captured; the platform's raw payload is not kept.

Edge cases:

- EC-1: A job previously closed or archived reappears in a term run → it
  reopens and its archiving is cleared (ADR 0020 item 7).
- EC-2: A term run returns the same posting repeated for several countries →
  each location remains a separate job, as today (grouping is an Open
  Question).
- EC-3: A term run and the regular sync process the same job at the same time →
  one job; no duplicate.
- EC-4: Job without description returned by a term run → attributed only if the
  term appears in title, company or tags.

### US-017: Term runs are off where ingestion is not permitted

**As** Andreus, **I want** to be told when captures are off in an environment,
**so that** I do not wait for results that will not come.

Acceptance criteria:

- AC-1: Where ingestion is not permitted, saving a term succeeds, no platform
  is called and the term shows "captures off in this environment".
- AC-2: The Jobs screen term filter keeps working on the corpus.

Edge cases:

- EC-1: Ingestion becomes permitted later → paused-by-environment terms run in
  the next daily sweep.
- EC-2: Manual "run again" in such an environment → disabled with the same
  message.
- EC-3: Any entry point that could start a run (web action, runner, daily
  sweep) → refuses the same way; none bypasses the gate.

## Fit per Track

### US-018: Each job carries a fit per active track

**As** Andreus, **I want** every job measured against each of my active tracks,
**so that** a Laravel job is judged against my Laravel target.

Acceptance criteria:

- AC-1: For every open job, the candidate has one fit per active track.
- AC-2: Blockers (for example, US-only work authorization) are evaluated once
  and apply to every track's fit.
- AC-3: The job detail shows each track's fit with its component breakdown.

Edge cases:

- EC-1: A job with a blocker → the same blocker appears under every track.
- EC-2: Scorer version changes → every track's fit is recalculated; no mix of
  versions is shown.
- EC-3: Scale — 6 tracks and 10,000 open jobs → all fits are available within
  the recalculation notice period; the Jobs screen stays usable meanwhile.
- EC-4: Job without description → scored as today (neutral where data is
  missing) under every track.

### US-019: Track pay ranges and seniority shape its fit

**As** Andreus, **I want** my PHP track's lower compensation ranges and
different seniority to count only for that track, **so that** a fair PHP offer
is not punished by my AI floor.

Acceptance criteria:

- AC-1: The pay component of a track's fit compares the job's pay with that
  track's compensation ranges, the same way the scorer compares with the
  profile's ranges today.
- AC-2: The seniority component compares with that track's target seniority;
  years of experience stay the person's.
- AC-3: Changing one track's ranges changes only that track's fit.

Edge cases:

- EC-1: Job without disclosed pay → neutral pay component under every track,
  as today.
- EC-2: Track without compensation ranges → the pay component behaves as today
  with no ranges.

## Jobs Screen

### US-020: Track selector opens on the primary track

**As** Andreus, **I want** the Jobs screen to open on my primary track with a
selector for others or all, **so that** my preferred ranking is the default.

Acceptance criteria:

- AC-1: Without a track in the URL, the screen shows fits of the primary track.
- AC-2: Selecting a track shows that track's fit; the choice lives in the URL.
- AC-3: Selecting "all tracks" shows each job once, with the fit and label of
  the track where it fits best.
- AC-4: The minimum-fit cut applies to the fit displayed.
- AC-5: The title cluster filter lists only the selected track's clusters and
  narrows within that track.

Edge cases:

- EC-1: URL names an archived or unknown track → primary track with a notice.
- EC-5: URL carries a cluster that does not belong to the selected track → the
  cluster filter is dropped with a notice.
- EC-2: Candidate with only the primary track → the selector shows it and "all
  tracks" behaves identically.
- EC-3: Tie between tracks in "all" → the primary track's label wins; otherwise
  the track listed first.
- EC-4: Narrow screen (375px) → the selector fits without horizontal scroll.

### US-021: Filter the corpus by any term, including descriptions

**As** Andreus, **I want** typing `Laravel` to find jobs that mention it in the
description, **so that** my first search does not come back empty.

Acceptance criteria:

- AC-1: The term filter matches title, company and description as whole words,
  using the scorer's term boundary (any character other than a letter, digit,
  `+` or `#` separates words), with the equivalences of US-012. The
  description is the captured page text when present, else the posting's
  description.
- AC-2: It works for any typed term, saved or not, and combines with every
  other filter.
- AC-3: The filter lives in the URL.
- AC-4: When the typed term is not saved, the screen offers "search the
  platforms for this term" (US-007 AC-4), emphasized when fewer than 10 jobs
  match.
- AC-5: The search field's hint states that it searches title, company and
  description; today's substring match on title and company is replaced.

Edge cases:

- EC-1: Partial word (`Lara`) → does not match `Laravel`; `java` does not match
  `JavaScript` (whole word).
- EC-2: Term with symbols (`C#`, `Node.js`) → matched literally.
- EC-3: Empty term → filter off.
- EC-4: Hostile input → shown escaped; never interpreted.
- EC-5: Job without description → matched on title and company only.
- EC-6: Zero matches → an empty state that names the term and offers the save
  action.

### US-022: Filter to jobs a saved term brought in

**As** Andreus, **I want** to see only jobs a given saved term brought in, **so
that** I triage one search at a time.

Acceptance criteria:

- AC-1: The Jobs screen offers each active saved term as a filter; choosing one
  shows the jobs attributed to it (US-016 AC-3).
- AC-2: Opening a term from the terms screen lands on the Jobs screen with this
  filter and the term's track selected.

Edge cases:

- EC-1: Term deleted → no longer offered; an old link shows the unfiltered
  screen with a notice.
- EC-2: Term whose runs found nothing yet → empty state stating the term's
  status.
- EC-3: Another candidate's term in the URL → ignored with a notice.

### US-023: Filter by minimum pay in my currency and period

**As** Andreus, **I want** to ask for at least USD 6,000 a month, **so that**
jobs below what I accept leave the list.

Acceptance criteria:

- AC-1: The filter takes an amount, a currency and a period (month or year);
  defaults come from the currency and period of the primary track's first
  compensation range, else USD per month.
- AC-2: Pay is compared after currency conversion with stored exchange rates
  and period normalization; the list shows the converted amount next to the
  original. The conversion serves only this filter and its display; it never
  feeds a fit or a compensation range.
- AC-3: A job qualifies when the top of its disclosed range reaches the
  minimum; jobs whose disclosed pay is entirely below it are hidden.
- AC-4: The filter never changes any fit and is not part of a saved term.
- AC-5: The filter lives in the URL.

Edge cases:

- EC-1: Amount zero, negative, non-numeric or above 10,000,000 → filter
  ignored with a notice.
- EC-2: Currency without a stored rate → not offered in the selector.
- EC-3: Job paid hourly → converted with the scorer's convention (2,080 hours a
  year).
- EC-4: Job with only a lower bound → that bound is the top of the range.
- EC-5: Job paid per project with a stated duration → annualized as the scorer
  does, then compared.

### US-024: Undisclosed or non-comparable pay stays visible, marked

**As** Andreus, **I want** jobs that do not disclose pay to stay in the list,
**so that** the filter does not hide most good jobs.

Acceptance criteria:

- AC-1: With a minimum set, jobs without disclosed pay appear after the
  qualifying ones, marked "not disclosed".
- AC-2: Jobs whose pay cannot be compared (currency without a rate, project pay
  without duration) appear with them, marked "not comparable".
- AC-3: A toggle "only with disclosed pay" hides both groups; it lives in the
  URL.
- AC-4: The screen states how many jobs were hidden for being below the
  minimum.

Edge cases:

- EC-1: Every job is undisclosed → the list shows them all, marked, with the
  toggle available.
- EC-2: Toggle on and nothing qualifies → empty state naming the minimum.

### US-025: Sort by pay compares normalized amounts

**As** Andreus, **I want** "sort by pay" to compare like with like, **so that**
USD per hour and BRL per year are not ordered by raw number.

Acceptance criteria:

- AC-1: Sort by pay orders by the amount converted to the filter's currency and
  period (or the default currency and period when no minimum is set).
- AC-2: Undisclosed and non-comparable jobs sort last.

Edge cases:

- EC-1: Two jobs with the same normalized amount → tie broken by fit, then by
  a stable identifier, so paging never swaps them.

## New-Job Awareness

### US-026: See how many new jobs each term brought since my last visit

**As** Andreus, **I want** a count of new jobs per term and a "new" marker on
the Jobs screen, **so that** I act within the first days without e-mail.

Acceptance criteria:

- AC-1: Each saved term shows how many jobs it brought into the corpus since
  the candidate last opened the Jobs screen filtered by that term.
- AC-2: Those jobs carry a "new" marker on the Jobs screen until that visit.
- AC-3: Opening the Jobs screen with the term's filter clears its count.
- AC-4: Nothing is sent by e-mail or push.

Edge cases:

- EC-1: Candidate never visited the term's results → the count covers every
  job the term brought in so far.
- EC-2: A new job later closes → it leaves the count.
- EC-3: Same job brought by two of the candidate's terms → counted under each
  term; marked once on the Jobs screen.
- EC-4: Two tabs → visiting in one clears the count for both after reload.

## Privacy and Operations

### US-027: Recruiter cannot see tracks, terms or pay ranges

**As** a recruiter, **I must not** see a candidate's tracks, terms, run history
or compensation ranges, **so that** the candidate's strategy stays theirs.

Acceptance criteria:

- AC-1: A recruiter is denied the tracks and terms screens, as any
  candidate-only screen.
- AC-2: No screen or export available to a recruiter shows a track name, term,
  per-track fit or compensation range, including for linked candidates.
- AC-3: The public profile never shows tracks, terms or compensation ranges.
- AC-4: A recruiter linked to the candidate, with access to the candidate's
  resources, still cannot read tracks or terms; that access never extends to
  them.

Edge cases:

- EC-1: Recruiter crafts a URL with a candidate's track or term → denied or
  ignored; nothing leaks in the response.
- EC-2: Recruiter viewing the Jobs screen → sees jobs per existing rules,
  without any track selector or per-track fit of a candidate.
- EC-3: Expired session → sent to login; no data rendered.

### US-028: Aggregate term-capture health without private data

**As** an administrator, **I want** per-platform term-capture health, **so
that** I can fix a broken integration without reading anyone's strategy.

Acceptance criteria:

- AC-1: The administrator sees, per platform: calls used and remaining in the
  current window, runs waiting for quota, failures with last error, and the
  number of active terms system-wide.
- AC-2: No term text, compensation range or candidate identity appears in this
  view.
- AC-3: Any administrator run inspection shows term captures only in this
  aggregate form — never the actor or the term.
- AC-4: Term text never appears in logs, command output or the daily sweep's
  review snapshot.

Edge cases:

- EC-1: A single candidate on the deployment → counts still exclude term text.
- EC-2: Impersonated session → this aggregate view is not available (bulk
  administrative views are off while impersonating).

### US-029: Impersonation reaches a candidate's tracks, recorded

**As** an administrator, **I want** to reach a candidate's tracks and terms only
by impersonation, **so that** support is possible and always recorded.

Acceptance criteria:

- AC-1: While impersonating, the administrator sees and edits the candidate's
  tracks and terms as the candidate would, but never starts a run; the
  impersonation is recorded.
- AC-2: Without impersonation, no administrator screen shows another
  candidate's tracks or terms.

Edge cases:

- EC-1: Impersonating another administrator who is also a candidate → same
  behavior; bulk administrative actions stay off.
- EC-2: Saving a term or asking "run again" while impersonating → saved or
  recorded, no run starts; the term shows "waiting for the next daily sweep".

## Single-Fit Readers

### US-030: Dossier, statistics and exports use the primary track

**As** Andreus, **I want** surfaces that show one fit per job to use my primary
track, **so that** they stay consistent with the Jobs screen's default.

Acceptance criteria:

- AC-1: The application dossier, statistics by cluster, exports and the
  markdown report show the primary track's fit and cluster.
- AC-2: Where a surface lets the viewer choose a track, the chosen track's fit
  is shown instead, labeled.

Edge cases:

- EC-1: Primary track changed → the next dossier, report or export uses the new
  primary track.
- EC-2: Primary track pending (US-001 EC-1) → these surfaces show no fit, as
  they do today for a candidate without an own profile.
