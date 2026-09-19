---
status: completed
title: "Jobs screen: track selector, term, brought-by and pay filters"
type: frontend
complexity: high
---

# Task 4: Jobs screen: track selector, term, brought-by and pay filters

## Overview

Deliver the Jobs screen as the single results surface: the track selector, the
whole-word term filter over title, company and description, the "brought by my
term" filter with new-job markers and visit recording, the minimum-pay filter
and the normalized sort by pay. This is where the candidate's original failed
search (`Laravel`) starts to work, and where every captured job is triaged.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST add `annualFactorSql()` and `normalizePayTop` to `src/core/money.ts`, sharing `PERIODS_PER_YEAR` between SQL and TypeScript (ADR-013).
2. MUST extend `BoardFilters`, `listBoard`, `countBoard` and `boardFacets` with the term filter (`termRegexSql` bound as a parameter over `lower(title)`, `lower(company_name)` and `lower(coalesce(job_page.text, description_text))`), the "brought by" filter through `attributedJobIds`, the pay filter and the normalized pay sort, keeping counts correct.
3. MUST order undisclosed and non-comparable pay after qualifying jobs, report the number hidden below the minimum, and break ties by fit then `job.id` in every sort so paging is stable.
4. MUST extend `readFilters`/`href` with `track`, `q`, `by`, `pay`, `cur`, `per`, `disclosed` and `sort`, returning notices (`track_unknown`, `term_*`, `term_unknown`, `pay_invalid`, `cluster_unknown`) instead of failing; the pay defaults come from the primary track's first range, else USD per month.
5. MUST add the track selector, the pay controls, the "brought by" select, the "search the platforms for this term" offer (emphasized under 10 matches), the new-job marker and the notices to `/jobs`, all texts from the dictionary and all state in the URL; the field hint MUST say it searches title, company and description.
6. MUST record the visit of `/jobs?by=<termId>` after render, skipping prefetch requests, and mark new jobs against the previous visit.
7. MUST replace the hard-coded Portuguese literal at `app/jobs/page.tsx:55` with a dictionary key.
8. MUST keep every control usable at 375 px and follow the theme tokens (no hex, no `max-w-xs…xl`).
</requirements>

## Subtasks
- [x] 4.1 Pay normalization helpers shared by SQL and TypeScript.
- [x] 4.2 Board query: term, brought-by, pay filter, pay sort, stable tie-break, new marker, hidden-below count.
- [x] 4.3 URL parsing and building for the new parameters, with notices and defaults.
- [x] 4.4 Jobs screen controls: track selector, term hint and save offer, brought-by, pay, toggle, notices, markers.
- [x] 4.5 Visit recording on render without prefetch side effects.
- [x] 4.6 Dictionary keys (pt-BR and en) for every new text; the existing literal fixed.
- [x] 4.7 E2E seeds (FX rates, pay variety, attributions) and the Jobs screen journeys; the existing company-substring check moved to whole words.

## Implementation Details

Follow the TechSpec sections "Data Models" (`BoardFilters`), "API Endpoints"
(`/jobs` parameters), ADR-012 and ADR-013, and "Development Sequencing" step
11. The track scope in the query already exists from task_01; this task adds
the UI and the remaining filters.

### Relevant Files
- `src/core/money.ts` (:30-185) — `Period`, `PERIODS_PER_YEAR`, `annualize`, `convert`.
- `src/contexts/fx/index.ts` (:26), `src/contexts/fx/infra/drizzle-store.ts` (:29-49) — latest rates.
- `src/core/db/repo.ts` (:76-363) — `BoardFilters`, `boardConditions` (`q` LIKE :138-143), sort (:185-190), facets.
- `src/core/db/work-mode.ts` (:12-25) — SQL regex precedent.
- `app/filters.tsx` (:26-278) — `FilterState`, `href`, `FilterBar`, `readFilters`, `toBoardFilters`.
- `app/jobs/page.tsx` (:28-55) — guards, candidate scope, the literal at :55.
- `src/contexts/sourcing/index.ts` — `attributedJobIds` from task_02.
- `src/core/i18n/pt-BR.ts`, `src/core/i18n/en.ts` — `jobs.*`, `filters.*`.
- `tests/cov-db-repo.test.ts`, `tests/board-read-model.test.ts` (generate_series seeding), `tests/work-mode-filter.test.ts`.

### Dependent Files
- `tests/e2e/setup.mjs`, `tests/e2e/ui.mjs` (~:2120 company substring query) — seeds and assertions.
- `app/api/export/route.ts` — shares `listBoard`; export keeps its columns.
- `tests/design.test.ts`, `tests/mobile.test.ts`, `tests/i18n.test.ts` — static checks on the new UI.
- `docs/qa/` scenarios for the Jobs screen search (reset to untested in task_05).

### Related ADRs
- [ADR-005: The Jobs Screen Is the Only Results Surface](adrs/adr-005.md) — filters and behavior.
- [ADR-012: One Whole-Word Term Pattern Builder](adrs/adr-012.md) — term filter.
- [ADR-013: Pay Normalization Computed in SQL](adrs/adr-013.md) — pay filter and sort.

## Deliverables
- Pay normalization helpers in `money.ts`.
- Extended board query and filter parsing.
- Jobs screen controls, notices and markers in pt-BR and en.
- Visit recording for "brought by" views.
- Updated E2E seeds and Jobs screen scenarios.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-013–UT-019 — pay normalization.
- [x] UT-064–UT-069 — filter parsing, URL round trip, pay defaults.
- [x] IT-095 — visit recording and prefetch.
- [x] IT-105–IT-115, IT-117–IT-120 — board query: term, brought-by, pay, sort, performance, markers, hostile input, currencies.
- [x] E2E-003, E2E-007, E2E-008, E2E-015, E2E-020 — Jobs screen journeys.

## Success Criteria
- Every assigned test case implemented and passing
- `rtk pnpm check` and `rtk pnpm test:e2e` green
- `listBoard` with term, pay, track and pay sort answers in under 2 seconds for 10,000 open jobs (IT-113)
- Searching `Laravel` finds a job whose only mention is in its description
