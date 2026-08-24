---
status: completed
title: Build the navigation transition domain and browser store
type: backend
complexity: high
---

# Task 1: Build the navigation transition domain and browser store

## Overview

Deliver the pure and browser-local contracts that make every later navigation
integration deterministic. This slice establishes URL classification,
generation ownership, timing, concurrency, connectivity messages, retry
idempotency, typed copy, and safe public error mapping without coupling the
domain to React or Next.js rendering.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The transition reducer MUST remain pure and MUST be the only authority for phase, target, generation, commit, and fallback-count changes.
- A genuinely newer target MUST reserve its generation synchronously; duplicate signals for the same active target MUST coalesce without duplicate announcements or timers.
- Every timer, completion, route error, offline message, and retry callback MUST be scoped to its captured generation and MUST ignore stale or mismatched targets.
- URL classification MUST accept only same-origin HTTP(S) screen changes and MUST preserve native behavior for same-route, hash-only, malformed, external, modifier, download, and new-context navigation.
- Transition readiness MUST honor the 180 ms minimum, prolonged copy MUST begin at exactly 3,000 ms, and no maximum timer MAY claim completion.
- Connectivity returning MUST NOT auto-retry or replay navigation; one explicit retry MAY perform one hard navigation to the active target.
- Browser code MUST be import-safe in unit/SSR contexts and MUST clean up subscriptions, timers, online/offline listeners, and service-worker listeners idempotently.
- New interface copy MUST originate in the typed `pt-BR`/English dictionaries, reject blank leaves, and never expose raw technical errors.
- All TypeScript MUST use erasable syntax and explicit `.ts` relative imports where required by repository conventions.
</requirements>

## Subtasks

- [x] 1.1 Establish the pure transition state, event, URL-target, offline-message, label, and timing contracts.
- [x] 1.2 Implement same-origin screen-change classification and stable adapter-event eligibility rules.
- [x] 1.3 Implement generation-based reduction for start, commit, fallback, prolonged, offline, leave, reset, and supersession events.
- [x] 1.4 Build the browser-local external store with subscriptions, monotonic timing, exact timer boundaries, and lifecycle cleanup.
- [x] 1.5 Add validated service-worker connectivity message handling and explicit idempotent hard retry.
- [x] 1.6 Add complete typed transition/offline/error/retry copy to both locale dictionaries.
- [x] 1.7 Add generic public navigation-error mapping that redacts arbitrary thrown values and framework digests.
- [x] 1.8 Implement every assigned unit contract case with table-driven boundaries and fake time only at the clock interface.

## Implementation Details

Follow `_techspec.md` sections **Pure transition domain**, **Browser transition
store**, **Core Interfaces**, **URL and Start Rules**, and **State and
Concurrency Rules**. Keep decision logic in `src/core/pwa/transition.ts`; the
browser store may orchestrate APIs and time but must not duplicate reducer
rules. The message parser is a deny-by-default boundary used later by the
service worker and presenter.

### Relevant Files

- `src/core/pwa/splash.ts` — existing startup constants and visual contract whose lifecycle must remain separate.
- `src/core/pwa/transition.ts` — pure state, reducer, URL classification, and message contract to create.
- `src/core/pwa/transition-store.ts` — browser singleton, timers, subscriptions, connectivity listeners, and retry orchestration to create.
- `src/core/i18n/pt-BR.ts` — reference dictionary where new typed leaves originate.
- `src/core/i18n/en.ts` — English dictionary constrained by the Portuguese reference shape.
- `src/core/i18n/index.ts` — translator and typed-key behavior consumed by later presentation.
- `tests/pwa.test.ts` — established PWA policy and source-test patterns.
- `tests/i18n.test.ts` — typed dictionary and untranslated-copy test conventions.
- `tests/cov-core-theme.test.ts` — table-driven pure-domain coverage style.

### Dependent Files

- `instrumentation-client.ts` — Task 2 forwards router starts into the store.
- `app/navigation-transition.tsx` — Task 2 subscribes to snapshots and invokes store lifecycle methods.
- `app/transition-link.tsx` and `app/transition-get-form.tsx` — Task 4 consume URL/start contracts.
- `scripts/sw-template.js` — Task 3 emits the typed offline message.
- `tests/e2e/ui.mjs` — later tasks exercise the contract through the public UI.

### Related ADRs

- [ADR-001: Use One Full-Screen Splash Contract for First-Party Navigation](adrs/adr-001.md) — Defines adaptive timing, latest-navigation ownership, and failure behavior.
- [ADR-003: Coordinate Navigation Transitions with a Next Router Hook and Typed Adapters](adrs/adr-003.md) — Establishes the generation-based coordinator and hybrid start paths.

## Deliverables

- Pure URL classifier and generation-based transition reducer with explicit phase and event types.
- Browser-safe external store with exact timing, subscriptions, stale-event protection, connectivity handling, and idempotent retry.
- Validated offline-message and generic public-error boundaries.
- Complete typed `pt-BR` and English transition copy.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**.

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-001, UT-002, UT-003 — internal, same-screen, external, malformed, and unsafe URL classification.
- [x] UT-004, UT-005, UT-006, UT-007, UT-008, UT-009, UT-010, UT-011, UT-012 — generation creation/coalescing, commit/fallback ordering, 180 ms readiness, 3,000 ms prolonged state, and stale timers.
- [x] UT-013, UT-014, UT-015, UT-016, UT-017, UT-018 — offline matching, superseded signals, route-error release, one-shot retry, and no automatic replay.
- [x] UT-019, UT-020 — valid and hostile service-worker message parsing.
- [x] UT-029, UT-030 — clean repeated transitions and nested fallback ownership.
- [x] UT-033 — typed nonblank locale completeness.
- [x] UT-037, UT-038 — generic error redaction and long/malformed URL boundaries.

## Success Criteria

- Every assigned test case implemented and passing.
- The pure reducer has no browser, React, Next.js, network, storage, or clock dependency.
- Duplicate and stale signals cannot create, mutate, announce, dismiss, or retry the wrong generation.
- No supported URL/error/message input throws across the public boundaries.
- Locale keys typecheck in both languages and never render blank transition states.
