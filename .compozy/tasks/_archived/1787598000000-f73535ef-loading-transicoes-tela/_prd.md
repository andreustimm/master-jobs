# Product Requirements Document: Unified Navigation Splash and Safe Offline Shell

## Overview

Master Jobs already has a branded splash that bridges the gap between the operating system/browser and the first ready document. Client-side navigation does not reuse it: after a menu or internal link click, the previous screen can remain visible without a clear indication that the destination is loading. The mismatch is especially noticeable in the installed PWA and on slower mobile connections.

This feature establishes one loading contract for every first-party screen transition. It reuses the existing splash identity in a full-screen, blocking state; adapts duration to actual navigation readiness; explains prolonged waits and failures; and provides a safe offline outcome. It serves authenticated candidates, recruiters, administrators, and unauthenticated visitors across desktop, mobile browser, and installed PWA environments.

Offline support remains shell-only. It improves recovery without caching authenticated screens, APIs, public profiles, or private user data.

## Goals

- Users see immediate, recognizable feedback whenever an accepted first-party action changes screens.
- Desktop menu, mobile menu, contextual links, cards, redirects, URL-backed views, and browser history share one transition lifecycle.
- Fast destinations are not forced to wait for the startup splash's 900 ms minimum.
- Slow navigation remains truthful, switching to a localized prolonged-wait state after three seconds rather than exposing stale content.
- Failed navigation restores or preserves an operable screen and explains the failure in the active language.
- Offline navigation reaches a branded, retryable offline outcome without persisting private or revocable content.
- The experience remains equivalent across themes, locales, viewport sizes, safe areas, keyboard/screen-reader use, zoom, and reduced-motion preferences.

## User Stories

- **US-001 — Navigation coverage:** every first-party screen change uses one full-screen splash contract.
- **US-002 — Transition lifecycle:** normal, prolonged, failed, interrupted, and superseded navigations have deterministic outcomes.
- **US-003 — Offline shell:** authenticated users receive a safe offline outcome without cached private content.
- **US-004 — Public and authentication routes:** login, recovery, callback, and public-profile routes receive the same contract.
- **US-005 — Inclusive experience:** locale, assistive technology, motion preference, theme, safe area, desktop, and mobile behavior remain equivalent.

[Full user stories](_user_stories.md)

## Core Features

### 1. Unified full-screen transition splash

- Reuse the existing Master Jobs startup splash's visual identity: app icon, product name, indeterminate progress treatment, semantic theme colors, and localized status.
- Cover the entire application viewport and prevent interaction with the previous interface while an accepted navigation is pending.
- Apply to every first-party route transition: global desktop/mobile menus, contextual links, cards, form redirects, URL-backed view changes, and browser back/forward.
- Apply equally to authenticated role-specific areas, login/recovery/callback surfaces, and public profiles.
- Exclude external destinations and interactions that do not change screens, including theme changes, modals, accordions, and disclosure controls.
- A direct document load uses the existing startup splash only; startup and transition states must not stack.

### 2. Adaptive and truthful lifecycle

- Begin when a first-party navigation is accepted.
- Use a short minimum duration only to prevent a perceptual flash. Do not apply the startup splash's 900 ms minimum to route transitions.
- End when the destination is ready, never merely because a fixed maximum timer expired.
- After three seconds, replace the normal loading label with a localized prolonged-wait label while preserving the same visual shell.
- If navigation fails, remove the overlay, keep or restore an operable route, and show a localized navigation error without raw technical details.
- If a newer navigation supersedes an older transition, the latest accepted destination exclusively owns status and dismissal.
- If connectivity is the cause, hand off to the safe offline outcome instead of a generic navigation error.

### 3. Safe offline shell and recovery

- Cache only non-sensitive, versioned shell resources needed to render the product identity and dedicated offline experience.
- On an offline route transition, move from the transition splash to a localized offline screen with a clear retry path.
- On a full offline start, provide the same safe offline outcome when the shell is available.
- Retry through an ordinary fresh, authorized navigation after reconnection.
- Never make authenticated HTML, route payloads, APIs, exports, public profiles, resumes, jobs, applications, salary data, or administrative content available from a service-worker cache.
- Preserve privacy even when logout never runs because a session expired or a device was lost.

### 4. Accessible, localized, and responsive feedback

- Use the active typed `pt-BR` or English dictionary for normal loading, prolonged wait, offline, retry, and failure messages.
- Announce status changes politely without moving focus into the splash or announcing decorative image/progress elements.
- Treat progress as indeterminate; never invent a percentage or completion estimate.
- Under reduced-motion preference, remove non-essential entrance, sweep, and fade motion while preserving the full status information.
- Preserve readable contrast in all three themes and light/dark/system environments.
- Respect visual viewport and safe-area insets in mobile browser and installed PWA modes.
- Restore normal destination focus behavior after the loading node leaves.

## Business Rules

1. **One visual contract:** startup and route-transition loading use the same Master Jobs identity; a second unrelated spinner or skeleton cannot replace it for screen transitions.
2. **Latest navigation wins:** only the most recently accepted first-party navigation may update or dismiss the transition state.
3. **No false completion:** a pending splash cannot disappear solely because a timer elapsed.
4. **Adaptive timing:** route transitions use a short anti-flicker minimum and do not inherit the startup splash's 900 ms minimum.
5. **Prolonged wait threshold:** at three seconds of continuous pending state, the user-visible message changes to the localized prolonged-wait copy.
6. **Failure recovery:** a failed transition must leave an operable screen or canonical route error and a localized explanation; it may not leave a permanent overlay.
7. **Exactly one loading layer:** a direct document startup cannot render a transition splash on top of the startup splash.
8. **Internal-only scope:** external navigation does not promise a Master Jobs loading lifecycle.
9. **Interaction blocking:** while the transition splash covers the app, underlying application controls cannot receive pointer, keyboard, or touch interaction. Native browser controls remain outside this restriction.
10. **Permission neutrality:** loading feedback never reveals whether a protected destination exists and never bypasses normal authorization outcomes.
11. **Offline privacy by absence:** no authenticated page, route payload, API response, export, public profile, or user content enters a service-worker cache.
12. **Fresh retry:** offline recovery always asks the server for current authorized content after reconnection.
13. **Localized status:** every user-visible transition, prolonged, offline, retry, and failure message comes from the typed dictionaries; missing English copy is a build failure.
14. **Reduced motion:** reduced-motion users receive an equivalent static status with no non-essential transition animation.
15. **Responsive parity:** behavior and containment must be verified in real browsers at 1280×900 and 375×812, including installed/mobile safe-area conditions.

## User Experience

### Primary flow

1. The user activates any first-party destination from a menu, link, card, URL-backed control, completed form, or browser history.
2. Master Jobs accepts the navigation and covers the full viewport with the existing splash identity.
3. The previous app interface cannot receive additional actions while the destination is pending.
4. If the destination is ready quickly, the splash completes after only the short anti-flicker interval.
5. If waiting reaches three seconds, the message changes to a localized prolonged-wait status without implying a percentage.
6. When the destination is ready, the splash exits and normal focus/navigation semantics resume.

### Failure flow

1. A non-connectivity failure returns the user to an operable screen or canonical error route.
2. The splash exits and a localized message explains that navigation failed and may be retried.
3. A retry starts a clean transition with no stale prolonged/error state.

### Offline flow

1. Connectivity disappears before or during navigation.
2. The splash hands off to the branded offline screen instead of waiting forever or exposing cached private content.
3. The screen explains that current content is unavailable and offers retry.
4. After reconnection, retry performs a fresh authorized request and continues through the normal transition lifecycle.

### UI and accessibility considerations

- The established splash is the focal moment; this feature does not introduce a competing visual language.
- The overlay covers both content and application navigation, is centered within safe areas, and remains legible under text expansion and browser zoom.
- Status is programmatically identifiable and announced politely. Decorative icon and indeterminate motion do not create duplicate announcements.
- Reduced motion replaces animated sweep/entrance/fade with an equivalent static presentation.
- Desktop and mobile navigation must feel identical even though the mobile menu closes before route transition begins.

## High-Level Technical Constraints

- Remain compatible with the installed Next.js App Router version and its documented loading, prefetching, and interruptible-navigation behavior.
- Preserve existing Server Component boundaries and avoid making unrelated pages client-rendered merely to display navigation feedback.
- Preserve the current splash as the visual and semantic source of truth rather than duplicating its markup, timing labels, or accessibility rules across unrelated components.
- Preserve existing role-based authorization, public-profile 404 behavior, typed locale dictionaries, theme tokens, safe-area handling, and PWA service-worker versioning.
- Preserve the service-worker invariant: authenticated routes, APIs, exports, and `/p/` remain network-only and absent from cache.
- Navigation feedback must not add a meaningful artificial delay to an already-ready route.
- Verification must exercise actual navigation in real Chromium/WebKit-compatible mobile conditions and desktop, including prefetched and delayed destinations, offline/reconnect, interruption, failure, reduced motion, zoom, safe areas, and all supported roles.

## Non-Goals (Out of Scope)

- Full offline access to previously viewed jobs, profiles, applications, pipeline, salary, resume, or administrative data.
- Automatic caching of authenticated or revocable public content.
- User-selected downloadable offline packs; this was considered and not selected for this feature.
- Background synchronization or offline mutation queues.
- A determinate progress percentage or fabricated time estimate.
- A new splash illustration, animation system, brand identity, skeleton library, or route-specific loading design.
- Loading indicators for background mutations that do not change screens; their existing pending/error feedback remains authoritative.
- Intercepting or styling external websites after the user leaves Master Jobs.

## Architecture Decision Records

- [ADR-001: Use One Full-Screen Splash Contract for First-Party Navigation](adrs/adr-001.md) — Reuse the startup identity globally with adaptive, truthful transition timing.
- [ADR-002: Keep Offline Support Shell-Only and Free of Private Content](adrs/adr-002.md) — Provide branded offline recovery without caching authenticated or revocable content.

## Open Questions

None. Product scope and behavior were resolved during the PRD interview. Exact implementation mechanisms and the numerical anti-flicker interval belong to the TechSpec.
