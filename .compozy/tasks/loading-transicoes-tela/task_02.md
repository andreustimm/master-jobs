---
status: pending
title: Integrate the App Router coordinator and accessible branded splash
type: frontend
complexity: critical
---

# Task 2: Integrate the App Router coordinator and accessible branded splash

## Overview

Wire the transition domain into the real Next.js App Router while preserving
the server-rendered root and the established startup splash. This slice
delivers exhaustive router-start observation, two-signal readiness, a
full-screen accessible presenter, canonical error recovery, and responsive
visual parity across themes and input modes.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The implementation MUST install dependencies in the implementation worktree and revalidate the documented two-argument Next.js 16.3 `onRouterTransitionStart` contract before relying on it.
- Router `push`, `replace`, and `traverse` starts MUST reach the project store without enabling the optional experimental metadata flag or performing asynchronous instrumentation work.
- Root readiness MUST require a matching URL commit and zero mounted root fallbacks; fallback lifecycle MUST be reported before normal URL effects when both occur in one commit.
- The root layout MUST remain a Server Component and pass only serializable localized labels into one small always-mounted client island.
- Startup and transition presentation MUST share visual primitives while retaining separate lifecycle, root identity, pointer behavior, and the startup 900 ms minimum.
- While transition is active, the application shell MUST be inert and `aria-busy`; the overlay MUST block application pointer, touch, and keyboard actions while leaving native browser controls available.
- Status changes MUST use one polite atomic live node, MUST NOT steal focus, and MUST remove no destination focus behavior when the overlay exits.
- Reduced motion, safe areas, semantic theme tokens, 200% zoom, and 375×812 containment MUST follow `DESIGN.md` and existing token utilities without new arbitrary values.
- A route-render failure MUST release the overlay to a localized operable error boundary and MUST never display raw exceptions or digests.
- Direct document load MUST render only the startup splash; transition state MUST not stack during hydration or locale reload.
</requirements>

## Subtasks

- [ ] 2.1 Add and contract-test the root Next.js router-transition instrumentation bridge.
- [ ] 2.2 Add root URL-commit observation and loading-boundary lifecycle signaling with deterministic effect ordering.
- [ ] 2.3 Build the single transition presenter and connect application-shell inert/`aria-busy` behavior.
- [ ] 2.4 Refactor reusable splash presentation primitives without changing startup timing or first-paint behavior.
- [ ] 2.5 Add normal, prolonged, leaving, and generic error UI using typed copy and stable test selectors.
- [ ] 2.6 Add the localized root route-error surface and retry contract.
- [ ] 2.7 Verify server/client serialization, hydration, Suspense placement, and one-layer startup behavior.
- [ ] 2.8 Implement the assigned integration and real-browser cases across timing, failure, locale, theme, accessibility, safe area, zoom, desktop, and mobile.

## Implementation Details

Follow `_techspec.md` sections **Router instrumentation bridge**, **Root
readiness signals**, **Transition presenter and observer**, **Shared splash
presentation**, and **Route error surface**. `useSearchParams()` must remain
inside `Suspense`. The loading signal uses layout-effect lifecycle while the URL
observer uses a normal effect. Keep the inline startup renderer first in the
body and outside transition-store startup.

### Relevant Files

- `instrumentation-client.ts` — documented App Router start bridge to create at repository root.
- `app/navigation-transition.tsx` — client observer/presenter island to create.
- `app/navigation-transition-loading-signal.tsx` — root fallback lifecycle signal to create.
- `app/loading.tsx` — root Suspense fallback integration to create.
- `app/error.tsx` — localized canonical route error boundary to create.
- `app/layout.tsx` — server-owned shell, startup splash injection, serializable labels, and application wrapper.
- `src/core/pwa/splash.ts` — startup renderer and reusable brand presentation primitives.
- `app/globals.css` — semantic full-screen, safe-area, motion, and view-transition styles.
- `app/themes.css` and `app/design-tokens.css` — existing theme and spacing/type authorities.
- `DESIGN.md` — mandatory design source of truth.
- `tests/pwa-chrome.test.ts` — real-browser splash/PWA patterns.
- `tests/mobile.test.ts`, `tests/ui-spacing.test.ts`, `tests/e2e/ui.mjs` — viewport, spacing, and full-journey harnesses.

### Dependent Files

- `src/core/pwa/transition.ts` and `src/core/pwa/transition-store.ts` — Task 1 contracts consumed without redefining state rules.
- `app/auth.ts`, `app/session-badge.tsx`, and `app/mobile-nav.tsx` — server/session and header behavior that must remain functional under the shell wrapper.
- `app/locale-switch.tsx` and `app/theme-switch.tsx` — direct reload/non-navigation controls that must not stack or misclassify transitions.
- `app/service-worker.tsx` — remains an independent registration client island.
- `next.config.ts`, `package.json`, and `pnpm-lock.yaml` — installed Next version and build behavior used by the compatibility test.

### Related ADRs

- [ADR-001: Use One Full-Screen Splash Contract for First-Party Navigation](adrs/adr-001.md) — Defines the visible lifecycle and adaptive timing.
- [ADR-003: Coordinate Navigation Transitions with a Next Router Hook and Typed Adapters](adrs/adr-003.md) — Defines hook usage, readiness signals, and the stable project boundary.

## Deliverables

- Root App Router instrumentation bridge with an installed-version compatibility test.
- Always-mounted accessible transition presenter and deterministic readiness signals.
- Shared startup/transition visual primitives with unchanged startup behavior.
- Inert application shell and localized operable route-error recovery.
- Desktop/mobile/theme/locale/reduced-motion/zoom/safe-area browser coverage for every assigned phase.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**.

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-031, UT-032 — semantic/safe-area/reduced-motion CSS and unchanged startup lifecycle.
- [ ] IT-001 — real router instrumentation bridge for push, replace, and traverse.
- [ ] IT-003, IT-004 — URL/fallback readiness ordering and prefetched no-fallback completion.
- [ ] IT-005 — route-error release, localized retry, and raw-error redaction.
- [ ] IT-010, IT-011 — startup/transition singleton hydration and dynamic motion/theme behavior.
- [ ] E2E-006, E2E-007, E2E-008, E2E-009 — 180 ms fast route, prolonged wait, supersession race, and operable failure.
- [ ] E2E-014, E2E-015, E2E-016, E2E-017 — locale, live-region/inert/focus, themes/reduced motion, and responsive safe-area/zoom parity.

## Success Criteria

- Every assigned test case implemented and passing.
- Next.js starts, URL commits, and fallback lifecycles produce one observable generation with no orphan overlay.
- Root pages remain Server Components and no unrelated page becomes client-rendered.
- Startup remains visually and behaviorally unchanged while route transitions use the 180 ms/3,000 ms contract.
- Real desktop and 375 px mobile browsers pass interaction, focus, announcement, contrast, motion, safe-area, zoom, and overflow assertions.

