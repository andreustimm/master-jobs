---
status: pending
title: Deliver the credentialless offline shell and deny-by-default cache
type: infra
complexity: critical
---

# Task 3: Deliver the credentialless offline shell and deny-by-default cache

## Overview

Deliver an offline outcome whose safety does not depend on logout, session
expiry, or a later cleanup action. This slice generates a standalone localized
document, narrows service-worker caching to explicit public resources, reports
soft-navigation connectivity failure without synthesizing route success, and
proves that persistent response bodies contain no private or revocable data.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- Offline HTML MUST be a generated standalone document that does not inherit the dynamic root layout, React hydration, a live session, external fonts, or route data.
- The generated document MUST use the established splash identity, typed `pt-BR`/English copy, semantic safe-area/reduced-motion styling, escaped text, and a fresh reload retry.
- `/offline.html` MUST be installed through a credentialless request; `/login` and every application route MUST be absent from shell cache.
- Static cache admission MUST be allowlist-based for declared public assets and `/_next/static/`; a filename extension alone MUST NOT make a URL cacheable.
- Authenticated HTML, RSC payloads, APIs, exports, public profiles, resumes, jobs, applications, salary data, admin data, and unknown routes MUST remain network-only and absent from keys and response bodies.
- A full-document network failure MUST return standalone offline HTML when available and only a non-sensitive plain `503` otherwise.
- A failed App Router/RSC request MUST notify only the initiating controlled client with the typed target message, MUST reject the route request, and MUST NOT return HTML as a successful RSC payload.
- Service-worker install/storage/quota failure MUST degrade honestly without preventing later online operation.
- Generation MUST be deterministic for one version/revision and existing activation MUST retire all obsolete cache versions.
- Tests MUST inspect real Cache Storage response bodies using seeded private markers, not rely solely on source-code string checks.
</requirements>

## Subtasks

- [ ] 3.1 Build the pure standalone offline-document renderer with both typed locale editions and safe escaping.
- [ ] 3.2 Extend the existing prebuild/predev generator to emit deterministic `offline.html` beside the versioned service worker.
- [ ] 3.3 Replace credentialed shell precaching with explicit credentialless offline-document installation and remove cached login.
- [ ] 3.4 Narrow runtime static eligibility to the explicit public allowlist and framework static directory.
- [ ] 3.5 Preserve network-only handling for every application/private/revocable surface and add typed RSC failure notification.
- [ ] 3.6 Preserve safe full-navigation fallback, non-sensitive `503`, storage-failure tolerance, and old-cache retirement.
- [ ] 3.7 Add static and real-browser cache-body audits with authenticated fixtures and hostile redirect/response cases.
- [ ] 3.8 Implement full offline start, repeated reload, no-cache start, and refused-storage E2E journeys.

## Implementation Details

Follow `_techspec.md` sections **Offline document renderer**, **Service-worker
generation and runtime**, **Offline Data Flow**, and **Browser and Service
Worker**. `scripts/sw-template.js` remains the committed service-worker source;
`public/sw.js` and `public/offline.html` remain derived and ignored. Do not
enable Next.js automatic offline retry and do not route Server Actions through
the cache.

### Relevant Files

- `src/core/pwa/offline.ts` — pure standalone document renderer to create.
- `src/core/pwa/splash.ts` — shared non-sensitive brand primitives and style contract.
- `src/core/pwa/transition.ts` — typed offline message contract from Task 1.
- `scripts/sw-template.js` — cache policy, fetch strategies, client notification, and safe fallback.
- `scripts/sw-version.mjs` — existing version generator to extend deterministically.
- `app/service-worker.tsx` — registration timing and production-only behavior that must remain intact.
- `.gitignore` — confirms generated runtime artifacts remain untracked.
- `tests/pwa.test.ts` — static generation/cache-policy coverage.
- `tests/pwa-chrome.test.ts` — real service-worker browser and Cache Storage coverage.
- `tests/e2e/run-isolated.mjs`, `tests/e2e/setup.mjs`, `tests/e2e/ui.mjs` — production-equivalent build and offline journey harness.

### Dependent Files

- `package.json` — `prebuild`, `predev`, and `sw` commands invoke the generator.
- `src/core/i18n/pt-BR.ts` and `src/core/i18n/en.ts` — Task 1 typed offline text consumed by the renderer.
- `src/core/pwa/transition-store.ts` — Task 1 validates and consumes worker messages; Task 4 closes the browser journey.
- `app/navigation-transition.tsx` — Task 2 presenter later displays matching soft-offline state.
- `app/offline/page.tsx` — legacy dynamic offline route to retire or make non-authoritative without leaving conflicting cached behavior.

### Related ADRs

- [ADR-002: Keep Offline Support Shell-Only and Free of Private Content](adrs/adr-002.md) — Defines privacy by cache absence.
- [ADR-004: Generate a Credentialless Standalone Offline Document](adrs/adr-004.md) — Defines standalone generation, credentialless install, and the RSC failure contract.

## Deliverables

- Deterministic standalone localized offline document generated during existing build preparation.
- Credentialless explicit shell/static caches with network-only application content.
- Typed initiating-client notification for soft router failure and safe hard-navigation fallback.
- Cache-key and response-body privacy proofs against seeded authenticated/revocable content.
- Honest full offline start and degraded no-cache/storage-refusal behavior.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**.

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-021, UT-022, UT-023, UT-024 — bilingual offline rendering, hostile-value escaping, and private-marker absence.
- [ ] UT-025, UT-026, UT-027, UT-028 — explicit cache eligibility, private denial, version retirement, and safe storage/shell failure.
- [ ] UT-034, UT-036 — deterministic generation and rejection of redirected/non-OK/router payload responses.
- [ ] IT-006, IT-007, IT-008, IT-009 — credentialless installation, typed RSC failure message, real private-body exclusion, and network-only request classes.
- [ ] E2E-010, E2E-011, E2E-012 — soft offline/fresh retry, installed full offline start/cache audit, and no-cache/refused-storage degradation.

## Success Criteria

- Every assigned test case implemented and passing.
- Generated offline HTML is byte-deterministic, localized, retryable, and independent of session-aware layout/application bundles.
- Cache Storage contains only the current eligible shell/static responses and no seeded private or revocable marker in any body.
- Router payload failures never receive offline HTML as a successful component response.
- Online use remains functional when service-worker registration, Cache Storage, or offline artifact installation fails.

