---
status: pending
title: Migrate first-party navigation and close canonical route flows
type: frontend
complexity: high
---

# Task 4: Migrate first-party navigation and close canonical route flows

## Overview

Complete the feature through every real navigation entry point and permission
surface. This slice introduces stable typed adapters, migrates the full
first-party inventory, preserves native/external and POST semantics, and proves
that authentication, public profiles, roles, history, not-found outcomes, and
mobile navigation all obey one transition and cache-isolation contract.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- `TransitionLink` and `TransitionGetForm` MUST preserve Next typed-route behavior, native modifiers/download/target semantics, and idempotently coalesce with the router instrumentation signal.
- Every current first-party menu, contextual link, card, pagination control, density control, and URL-backed GET view change MUST use the stable adapter or an explicitly documented equivalent.
- Raw external links, downloads, hash-only disclosures, modals, theme changes, and non-navigation controls MUST remain outside the transition lifecycle.
- POST Server Action forms MUST remain ordinary action forms; transition start MUST occur only when Next accepts a redirect and MUST NOT replay or automatically retry the mutation.
- Desktop and mobile global navigation MUST have equivalent route coverage while preserving the current mobile popover-close behavior.
- Login, recovery, callback, candidate, recruiter, administrator, impersonation, public-profile, expired-session, missing-role, not-found, deleted, closed, and revoked outcomes MUST remain governed by existing authorization/domain rules.
- Loading/offline/error copy MUST remain permission-neutral and MUST never announce or cache protected destination content.
- An architecture guard SHOULD fail when a new raw same-origin navigation anchor bypasses the explicit allowlist.
- All affected journeys MUST use stable test IDs, work at 1280×900 and 375×812, and leave no horizontal overflow or focused removed overlay.
- Completion MUST run the repository's applicable automated, targeted QA, audit, cleanup, deep-review, and ship gates before claiming the workflow ready for PR.
</requirements>

## Subtasks

- [ ] 4.1 Create stable typed link and GET-form navigation adapters over the completed transition/store contracts.
- [ ] 4.2 Inventory and migrate desktop/mobile global menus and all contextual first-party navigation surfaces.
- [ ] 4.3 Preserve external, download, modifier, target, hash-only, modal, disclosure, and theme behavior outside transition state.
- [ ] 4.4 Verify every redirecting POST Server Action starts only the accepted route change and never duplicates mutation work.
- [ ] 4.5 Add an architecture guard for future raw same-origin navigation bypasses with a narrow explicit allowlist.
- [ ] 4.6 Close candidate, recruiter, administrator, impersonation, login/recovery/callback, public-profile, and permission-expiry route journeys.
- [ ] 4.7 Close missing/deleted/closed/revoked entity and long/malformed URL journeys without stale cached content or orphan overlays.
- [ ] 4.8 Run targeted QA on desktop and mobile, repair regressions, and complete all assigned integration/E2E cases.
- [ ] 4.9 Run full repository verification and required review/ship preparation gates for the completed workflow.

## Implementation Details

Follow `_techspec.md` sections **Stable navigation adapters**, **Internal
navigation coverage**, **Transition Data Flow**, and **Development Sequencing**.
Use the codebase inventory rather than limiting migration to the global menu.
Do not wrap POST Server Action submission merely to obtain a pending signal;
the root router bridge owns accepted redirects.

### Relevant Files

- `app/transition-link.tsx` — typed internal link adapter to create.
- `app/transition-get-form.tsx` — typed URL-backed GET navigation adapter to create.
- `app/nav-links.tsx`, `app/mobile-nav.tsx`, `app/layout.tsx` — shared desktop/mobile menu and header/footer links.
- `app/grid.tsx`, `app/filters.tsx`, `app/filter-toggle.tsx`, `app/joblist.tsx`, `app/job-modal.tsx` — cards, filters, density, pagination, and contextual detail navigation.
- `app/page.tsx`, `app/jobs/page.tsx`, `app/jobs/[id]/page.tsx`, `app/pipeline/page.tsx`, `app/referrals/page.tsx`, `app/compare/page.tsx` — authenticated route surfaces.
- `app/candidate/page.tsx`, `app/candidate/skills/page.tsx`, `app/candidate/vocabulary/page.tsx` — candidate navigation surfaces.
- `app/admin/users/page.tsx`, `app/admin/actions.ts` — administrative and impersonation redirects.
- `app/login/page.tsx`, `app/login/forgot/page.tsx`, `app/login/reset/page.tsx`, `app/login/callback/route.ts` — authentication/recovery/callback surfaces.
- `app/p/[slug]/page.tsx` — revocable public route and 404 behavior.
- `tests/architecture.test.ts`, `tests/nav-mobile.test.ts`, `tests/mobile.test.ts`, `tests/e2e/ui.mjs` — bypass guard, mobile parity, overflow, and canonical browser journeys.

### Dependent Files

- `src/core/pwa/transition.ts` and `src/core/pwa/transition-store.ts` — Task 1 stable classification/start/retry contracts.
- `instrumentation-client.ts` and `app/navigation-transition.tsx` — Task 2 authoritative router and presenter integration.
- `scripts/sw-template.js` and `src/core/pwa/offline.ts` — Task 3 cache isolation and offline behavior verified across roles.
- `app/jobs/new/actions.ts`, `app/compare/actions.ts`, `app/login/actions.ts`, `app/login/forgot/actions.ts`, `app/login/reset/actions.ts`, `app/logout-action.ts` — redirecting POST actions whose mutation semantics must remain unchanged.
- `src/contexts/auth/domain/policy.ts` and `app/auth.ts` — existing permission decisions that remain authoritative.

### Related ADRs

- [ADR-001: Use One Full-Screen Splash Contract for First-Party Navigation](adrs/adr-001.md) — Requires full first-party coverage and native-control exclusions.
- [ADR-002: Keep Offline Support Shell-Only and Free of Private Content](adrs/adr-002.md) — Constrains role/public-profile cache verification.
- [ADR-003: Coordinate Navigation Transitions with a Next Router Hook and Typed Adapters](adrs/adr-003.md) — Defines the stable adapter plus authoritative router-hook relationship.

## Deliverables

- Stable typed link/GET-form adapters and a complete migrated first-party navigation inventory.
- Preserved external/native control and POST Server Action semantics.
- Architecture regression guard against unapproved raw internal navigation.
- Verified desktop/mobile, history, redirect, auth, role, public, not-found, deleted, closed, revoked, long, and malformed route outcomes.
- Updated targeted living QA evidence and full workflow verification/review handoff.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**.

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-035 — native modifier/download/target exclusion and ordinary internal adapter acceptance.
- [ ] IT-002 — stable adapter and router-hook duplicate coalescing.
- [ ] IT-012, IT-013, IT-014 — one-shot Server Action redirect, canonical auth/role outcomes, and canonical missing/deleted/revoked outcomes.
- [ ] E2E-001, E2E-002, E2E-003, E2E-004, E2E-005 — desktop menu, mobile menu, contextual/URL-backed navigation, redirecting actions, and multi-entry history.
- [ ] E2E-013 — startup versus soft transition on login/recovery/callback/public routes without user content in the overlay.
- [ ] E2E-018, E2E-019, E2E-020 — token/public edge cases, malformed/missing/revoked entities, and permission-neutral role/cache isolation.

## Success Criteria

- Every assigned test case implemented and passing.
- The codebase inventory has no unapproved raw first-party navigation bypass and future bypasses fail the architecture guard.
- Every role and unauthenticated/public route reaches its existing canonical outcome through one transition without protected copy or stale cache.
- POST mutations occur exactly once and are never automatically retried by the loading/offline system.
- Desktop and 375 px mobile journeys pass full interaction, focus, overflow, cache-isolation, and history assertions.
- Repository checks, E2E, targeted QA, audit, deslop, deep-review, and ship preparation complete with fresh evidence.

