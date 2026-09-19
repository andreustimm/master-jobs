---
status: completed
title: Searches, track editor, admin health and job detail screens
type: frontend
complexity: high
---

# Task 5: Searches, track editor, admin health and job detail screens

## Overview

Deliver the screens that close every flow: the Searches screen (tracks with
their terms, states and new counts), the suggested-track form and the track
editor with their Server Actions, the administrator's aggregate capture health,
per-track fits on the job detail, the navigation entry, and the translations,
service-worker, E2E and living-QA updates. After this task a candidate can go
from a failed search to a saved term and back to triage without leaving the
product.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST add `/searches`, `/searches/tracks/new` and `/searches/tracks/[id]`, each calling `requireOwnCandidatePage("candidate:read")` before loading data, listed in the architecture test's `privatePages`; a foreign or unknown track id MUST return `notFound()`.
2. MUST add the track Server Actions (create, update, set primary, archive, restore) in `app/searches/**/actions.ts`, each awaiting `guardOwnCandidate("candidate:write")` first and rendering failures through `MutationFeedbackForm`.
3. MUST render, per term, the per-platform state, counts, last and next run, new-job count, coverage note, "daily repeat paused", "no results for 14 days", "captures off", "waiting for quota" and "waiting for the next daily sweep", server-rendered without polling.
4. MUST render the evidence marker, the "not reviewed" markers and the "recalculating" notice (extending the existing score status card, not duplicating it).
5. MUST add `/admin/captures` behind `requirePage("admin:access")`, unavailable while impersonating, showing only aggregate health.
6. MUST show every active track's fit with its breakdown on `/jobs/[id]`, using the on-demand fit from task_01 for tracks without a row.
7. MUST add the `nav-searches` entry for candidate scope, every text in pt-BR and en with `data-testid` on controls and `data-user-content` on track names and terms, `/searches` in the service worker's `NEVER_CACHE`, and the new routes in the E2E overflow and English-leak lists.
8. MUST keep recruiters and the public profile free of tracks, terms, per-track fits and ranges, including the recruiter view of linked candidates.
9. MUST register a living-QA area for searches and tracks in `docs/qa/` and reset the Jobs screen search scenarios to `untested`.
</requirements>

## Subtasks
- [x] 5.1 Searches screen with tracks, terms, states, counts and labels.
- [x] 5.2 Suggested-track form and track editor with their Server Actions and feedback.
- [x] 5.3 Job detail per-track fits.
- [x] 5.4 Administrator capture health page.
- [x] 5.5 Navigation entry, dictionary keys, service worker list.
- [x] 5.6 Authorization and privacy checks for recruiters, admins, impersonation and the public profile.
- [x] 5.7 E2E journeys, route lists, mobile and English checks.
- [x] 5.8 Living QA area and scenario resets.

## Implementation Details

Follow the TechSpec sections "API Endpoints" (pages and track actions),
"Monitoring and Observability" (admin view contents) and "Development
Sequencing" steps 12–13; follow `DESIGN.md` and the theme tokens for every
component.

### Relevant Files
- `app/candidate/skills/page.tsx` and its `actions.ts` — page and action template (`dynamic`, `getTranslator`, `MutationFeedbackForm`, `data-testid="route-…"`).
- `app/candidate/page.tsx` (:172-239) — `ScoreQueueCard`, the status card to extend.
- `app/nav-links.tsx` (:19-69), `app/layout.tsx` (:122-130) — navigation and scope flags.
- `app/admin/users/` — admin area structure.
- `app/jobs/[id]/page.tsx` (:34) — job detail.
- `app/p/[slug]/` and `publicProfile()` — public allow-list.
- `app/recruiter/[candidateId]/page.tsx` (:52) — recruiter view of linked candidates.
- `src/core/i18n/pt-BR.ts`, `src/core/i18n/en.ts`, `app/i18n.ts` (:22-26).
- `scripts/sw-template.js` (:18-32) — `NEVER_CACHE`.
- `src/contexts/matching/index.ts` (tracks, saved terms), `src/contexts/sourcing/index.ts` (`captureHealth`).

### Dependent Files
- `tests/architecture.test.ts` (:466-537) — action guard regex, route guards, `privatePages`.
- `tests/e2e/ui.mjs` (:1002, 1168-1180, 1850-1910, 2756-2790) — route lists and role scenarios.
- `tests/mobile.test.ts`, `tests/design.test.ts`, `tests/i18n.test.ts`.
- `docs/qa/README.md`, `docs/qa/journeys/`, `docs/qa/scenarios/` — new area and resets.

### Related ADRs
- [ADR-002: Target Tracks as the Unit of Fit](adrs/adr-002.md) — track editor and primary default.
- [ADR-005: The Jobs Screen Is the Only Results Surface](adrs/adr-005.md) — Searches manages, Jobs triages.
- [ADR-006: Tracks and Terms Are Private](adrs/adr-006.md) — visibility, admin aggregate, impersonation.
- [ADR-009: A Track Is a Target Fragment](adrs/adr-009.md) — on-demand fit, not reviewed markers.

## Deliverables
- `/searches`, `/searches/tracks/new`, `/searches/tracks/[id]` with track actions.
- `/admin/captures` and per-track fits on `/jobs/[id]`.
- Navigation, translations, service worker and E2E list updates.
- Living QA area for searches and tracks; affected scenarios reset.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-070 — every failure code mapped to dictionary keys in both locales.
- [x] IT-103 — job brought by two terms: counts and a single marker.
- [x] IT-121–IT-123 — action guards, page guards, admin page access.
- [x] IT-126, IT-128–IT-130 — public profile, linked recruiter, impersonation, admin without impersonation.
- [x] E2E-001 — journey from a failed search to a saved term.
- [x] E2E-002, E2E-004, E2E-005 — tracks.
- [x] E2E-006, E2E-009 — terms and new counts.
- [x] E2E-010 — job detail per-track fits.
- [x] E2E-011, E2E-012, E2E-019 — recruiter, admin, impersonation.
- [x] E2E-013, E2E-014, E2E-016, E2E-017, E2E-018 — layout, English, session, validation, hostile input.

## Success Criteria
- Every assigned test case implemented and passing
- `rtk pnpm check` and `rtk pnpm test:e2e` green
- No horizontal scroll at 375 px on any new screen
- No Portuguese text or accent outside user content on the English screens
