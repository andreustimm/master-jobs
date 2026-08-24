# Technical Specification: Unified Navigation Splash and Safe Offline Shell

## Executive Summary

Master Jobs will add one generation-based navigation transition coordinator that starts at accepted App Router intent—or reconciles before committed paint when the installed runtime omits that signal—waits for the destination URL and root loading boundary to settle, and presents the existing branded splash through a small client island. The root layout and route pages remain Server Components. A documented Next.js 16.3 `onRouterTransitionStart` bridge covers App Router push/replace/traverse starts; project-owned `TransitionLink` and `TransitionGetForm` components provide a stable, searchable integration surface and idempotent fallback for ordinary first-party navigation. Because the installed Server Action reducer bypasses that public hook, the committed-route observer performs the narrow compatibility reconciliation accepted in ADR-005.

The existing service-worker privacy policy remains network-only for application content. Offline support is hardened around a generated, credentialless `/offline.html` document and an explicit same-origin router-payload failure message. Neither authenticated HTML nor RSC payloads, APIs, exports, public profiles, or user data enter Cache Storage. Normal transitions have a 180 ms perceptual minimum, change to prolonged copy at 3,000 ms, and never auto-dismiss while work remains.

## System Architecture

### Component Overview

#### Pure transition domain — `src/core/pwa/transition.ts`

- Defines `NavigationTransition`, its phases, event union, URL classification, and the pure reducer.
- Assigns no time and touches no browser API. Callers pass `generation`, normalized URLs, and timestamps.
- Enforces latest-generation ownership, duplicate-start coalescing, the 180 ms readiness gate, prolonged state at 3,000 ms, and stale-event rejection.
- Classifies same-origin screen changes separately from same-route, hash-only, external, malformed, download, and new-context navigation.

#### Browser transition store — `src/core/pwa/transition-store.ts`

- Owns one browser-local store shared by `instrumentation-client.ts` and the React presenter.
- Wraps the pure reducer, `performance.now()`, short/prolonged timers, subscribers, online/offline listeners, and service-worker messages.
- Exposes idempotent `begin`, `urlCommitted`, `loadingMounted`, `loadingUnmounted`, `routeError`, `offline`, and `reset` functions. The coordinator may supply the previous committed URL to `begin` only when reconciling a hook-less accepted redirect.
- Records the normalized active target and monotonically increasing generation. Every asynchronous callback carries the generation it was created for.
- Performs no fetch, mutation, authorization decision, or cache write.

#### Router instrumentation bridge — `instrumentation-client.ts`

- Exports the documented two-argument `onRouterTransitionStart(url, navigationType)` function.
- Synchronously forwards valid `push`, `replace`, and `traverse` starts to the browser store inside a defensive `try/catch`.
- Does not enable `experimental.instrumentationClientRouterTransitionEvents`; transition metadata is unnecessary.
- Contains no React, asynchronous import, analytics request, or user data.

#### Stable navigation adapters — `app/transition-link.tsx` and `app/transition-get-form.tsx`

- `TransitionLink` wraps `next/link`, preserves typed routes and native modifier/download/target behavior, and sends an idempotent start signal from `onNavigate`.
- `TransitionGetForm` wraps `next/form` for URL-backed GET navigation and sends the same idempotent signal.
- Internal raw anchors used by filters, pagination, density controls, cards, detail links, and public-profile links migrate to these adapters.
- External links and downloads remain ordinary anchors.
- POST Server Action forms remain ordinary `<form action={serverAction}>` elements. Their redirect is reconciled only after Next accepts and commits it when the installed runtime bypasses the hook, so the feature does not portray a background mutation as screen navigation or replay it.

#### Root readiness signals — `app/loading.tsx` and `app/navigation-transition-loading-signal.tsx`

- Root `loading.tsx` renders only a client lifecycle signal; the branded overlay remains owned by the always-mounted presenter.
- The signal increments the active root-fallback count in `useLayoutEffect` and decrements it on cleanup.
- URL commit is not sufficient while the fallback count is non-zero. Completion becomes eligible only after the observed URL matches the active target and the root fallback has unmounted.
- A missing fallback on an already-prefetched route is valid: URL commit alone makes the transition eligible for the 180 ms minimum.

#### Transition presenter and observer — `app/navigation-transition.tsx`

- A single client island subscribes through `useSyncExternalStore` and renders the transition overlay as a sibling of the server-rendered application shell.
- A nested observer uses `usePathname()` and `useSearchParams()` inside `Suspense` and constructs the committed route key. Its layout effect reconciles a missing accepted redirect/history generation without superseding an uncommitted target; its normal effect reports commit. The loading signal's layout effect therefore still runs before readiness is reported when both mount in one commit.
- The presenter receives only serializable localized labels from `RootLayout`: normal loading, prolonged loading, offline title/body/retry, and generic failure/retry.
- While active, it sets `inert` and `aria-busy="true"` on `#application-shell`; the overlay itself accepts pointer input only in retry/error phases.
- It never moves focus into the overlay. One `role="status"`, `aria-live="polite"`, `aria-atomic="true"` node announces normal and prolonged phases. Offline/error content uses a heading and actionable button without raw error text.
- On completion, it removes `inert`, clears `aria-busy`, and lets the destination retain Next/browser focus behavior.

#### Shared splash presentation — `src/core/pwa/splash.ts` and `app/globals.css`

- Startup and transition states share brand element names, icon, product name, semantic theme tokens, progress treatment, safe-area padding, and reduced-motion rules.
- Startup preserves its current inline-first behavior and 900 ms minimum. Transition state uses separate root identity and lifecycle constants: 180 ms minimum, 3,000 ms prolonged threshold, and the existing 260 ms exit treatment unless reduced motion disables it.
- Startup is never dispatched through the transition store. Direct document loads therefore render one startup layer only.
- Transition overlay uses `pointer-events: auto`; startup remains noninteractive.

#### Route error surface — `app/error.tsx`

- A localized client error boundary calls `routeError()` on mount so an active overlay cannot cover the canonical error surface.
- It renders a generic localized explanation and `reset()` retry without exposing the exception message or digest.
- `notFound()`, authorization redirects, and login redirects remain canonical successful destinations and do not use the generic error boundary.

#### Offline document renderer — `src/core/pwa/offline.ts`

- Purely renders a standalone HTML document containing the splash identity, localized `pt-BR` and English offline copy, retry control, safe-area/reduced-motion CSS, and a minimal locale-selection script.
- Embeds no session, route result, user content, API response, or external asset requirement beyond explicit public icons.
- Escapes every translated value before insertion.
- Chooses locale from the non-sensitive locale cookie, then `navigator.languages`, then `pt-BR`.
- Retry calls `location.reload()`. Because a service-worker navigation fallback keeps the originally requested address, this performs a fresh request to that destination.

#### Service-worker generation and runtime — `scripts/sw-version.mjs` and `scripts/sw-template.js`

- The existing prebuild/predev generator writes both versioned `public/sw.js` and derived `public/offline.html`.
- Install fetches `/offline.html` with `credentials: "omit"`. `/login` is no longer cached.
- Cache-first applies only to the explicit static allowlist and `/_next/static/`; arbitrary same-origin file extensions are not enough.
- Full navigation remains network-only and falls back to the standalone offline response.
- App Router/RSC payload requests remain network-only. On fetch rejection, the worker posts `{ type: "navigation-offline", url }` to the initiating controlled client and rethrows the network failure; it never returns the offline HTML as RSC success.
- Versioned activation deletes obsolete cache generations. Storage or install failure does not block online operation.

### Transition Data Flow

1. A user activates `TransitionLink`, `TransitionGetForm`, browser history, or a redirect accepted by the App Router.
2. The stable adapter and/or `onRouterTransitionStart` calls `begin()`. When the installed Server Action reducer bypasses the hook, the route observer reconciles the accepted committed destination using the previous route as classification base. Same-target duplicate signals coalesce; a new target increments the generation.
3. The store immediately exposes `loading`; the presenter covers the visual viewport and marks the application shell inert.
4. Root `loading.tsx` reports any active Suspense fallback. The URL observer reports the committed pathname and search string.
5. Once the target URL has committed and the fallback count is zero, the store schedules completion at `startedAt + 180 ms`.
6. If still pending at `startedAt + 3,000 ms`, the same generation enters `prolonged`; no maximum timer dismisses it.
7. Completion fades and resets the same generation. A canonical error releases the overlay to `app/error.tsx`. A matching connectivity failure enters `offline` and exposes hard retry.
8. Any signal carrying an older generation or mismatched target is ignored.

### Offline Data Flow

1. The service worker installs only explicit public shell/static responses and never application content.
2. A full navigation failure returns cached `/offline.html`; if absent, it returns a non-sensitive plain-text `503`.
3. A soft RSC navigation failure posts a typed message to the initiating client and rejects the route request.
4. The transition store accepts the message only when the normalized URL matches its current target, then renders the offline phase.
5. Retry uses `window.location.assign(activeTarget)` to force a fresh authorized document request. It never replays a Server Action or cached route payload.

## Implementation Design

### Core Interfaces

```ts
export type TransitionPhase =
  | "idle"
  | "loading"
  | "prolonged"
  | "offline"
  | "leaving";

export type NavigationTransition = {
  generation: number;
  phase: TransitionPhase;
  target: string | null;
  startedAt: number | null;
  committed: boolean;
  fallbackCount: number;
};
```

```ts
export type TransitionEvent =
  | { type: "start"; target: string; at: number }
  | { type: "url-committed"; url: string; generation: number }
  | { type: "fallback-mounted"; generation: number }
  | { type: "fallback-unmounted"; generation: number }
  | { type: "prolonged"; generation: number }
  | { type: "offline"; target: string; generation: number }
  | { type: "leave"; generation: number }
  | { type: "reset"; generation: number };
```

```ts
export type TransitionStore = {
  getSnapshot(): NavigationTransition;
  subscribe(listener: () => void): () => void;
  begin(url: string, currentOverride?: string): number | null;
  commit(url: string): void;
  mountFallback(): () => void;
  failRoute(): void;
  retry(): void;
};
```

```ts
export type NavigationOfflineMessage = {
  type: "navigation-offline";
  url: string;
};

export function parseNavigationOfflineMessage(
  value: unknown,
): NavigationOfflineMessage | null;
```

```ts
export type TransitionLabels = {
  loading: string;
  prolonged: string;
  offlineTitle: string;
  offlineBody: string;
  retry: string;
  failedTitle: string;
  failedBody: string;
};
```

All interfaces use erasable TypeScript syntax. No enum, decorator, parameter property, class instance, `Date`, function prop from a Server Component, or non-serializable value crosses the Server/Client boundary.

### Timing Constants

| Constant | Value | Meaning |
| --- | ---: | --- |
| `TRANSITION_MIN_MS` | 180 ms | Matches the existing root view-transition duration and prevents an instant flash without inheriting startup's 900 ms delay |
| `TRANSITION_PROLONGED_MS` | 3,000 ms | Changes copy while remaining pending |
| `SPLASH_FADE_MS` | 260 ms | Existing splash exit duration; disabled under reduced motion |

There is deliberately no transition maximum. Browser controls remain available if a request never resolves.

### URL and Start Rules

- Normalize with `new URL(candidate, window.location.href)` and compare origin, pathname, and sorted/serialized search parameters.
- Accept only `http:`/`https:` URLs on the current origin.
- Reject same pathname/search, hash-only changes, `target` other than `_self`, `download`, default-prevented events, and modifier/non-primary activation in stable adapters.
- Preserve fragments on the actual Next destination but exclude them from screen-change identity.
- A malformed candidate returns `null`; it never starts or conceals the router's normal validation/error behavior.
- If a start targets the current active normalized destination while phase is non-idle, return the existing generation. Otherwise increment generation and reset all phase-local flags/timers.
- A committed-route reconciliation may classify against the previous committed URL. It runs only while idle or after the active generation committed; an uncommitted newer target always keeps ownership.

### State and Concurrency Rules

- The reducer is the only code allowed to decide state transitions.
- The store reserves a generation synchronously before any timer, subscription notification, or browser callback.
- Every timer closure captures its generation and becomes a no-op if the active generation changed.
- `leave` is legal only after commit with `fallbackCount === 0`, or after the generic route error has become operable.
- Offline signals require both the active generation and matching normalized target.
- A browser `online` event does not auto-retry; it only enables the explicit retry control. This prevents an action or redirect from replaying without user intent.
- Repeated retry creates one hard navigation and disables the retry control after its first accepted activation.

### Data Models

No database, Drizzle schema, cookie schema, API payload, or persistent domain model changes.

The only cross-runtime message is `NavigationOfflineMessage`. The only new generated artifacts are:

- `public/sw.js` — existing ignored artifact, versioned from `scripts/sw-template.js`.
- `public/offline.html` — ignored derived artifact generated from `src/core/pwa/offline.ts`.

The active transition lives only in browser memory and is discarded on document navigation.

### API Endpoints

No API endpoint is added or changed. `/offline.html` is a generated public static document, not an application API or authenticated route.

## Integration Points

### Next.js App Router 16.3

- `instrumentation-client.ts` uses the documented two-argument `onRouterTransitionStart` signature.
- Installed Next 16.3.2 does not call that hook from its Server Action reducer; ADR-005's observer reconciliation is the only compatibility path for that accepted redirect.
- `usePathname()` and `useSearchParams()` observe commit; the observer sits under `Suspense` to prevent a static-route client-rendering bailout.
- Root `loading.tsx` supplies fallback lifecycle only, not presentation.
- `app/error.tsx` is the canonical client error boundary and uses `reset()` for retry.
- A compatibility test must fail if the installed Next version no longer exports/invokes the expected transition hook. The implementation must be revalidated after `pnpm install` because the manifest requests `^16.3.2`.

### Browser and Service Worker

- Requires the standard `inert`, Cache Storage, service-worker messaging, `URL`, `online`/`offline`, and History APIs supported by the project's browser baseline.
- Online behavior does not depend on service-worker registration; route errors still release the overlay.
- The service worker is registered only in production after `load`, preserving the existing development behavior.
- Cross-origin requests are never intercepted or cached.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/pwa/splash.ts` | Modified | Separates reusable visual primitives from startup-only lifecycle; medium visual regression risk | Preserve startup HTML snapshot, safe areas, themes, reduced motion, and 900 ms behavior |
| `src/core/pwa/transition.ts` | New | Pure state and URL rules; high correctness importance | Exhaustive table-driven unit coverage including races and boundaries |
| `src/core/pwa/transition-store.ts` | New | Browser singleton and timers; high stale-callback risk | Fake clock only at the time boundary and test generation ownership |
| `instrumentation-client.ts` | New | Framework hook bridge; medium upgrade risk | Contract test installed Next signature and keep synchronous work under 16 ms |
| `app/navigation-transition.tsx` | New | Global client island and accessibility presentation; high UX impact | Keep server tree outside client ownership and verify real browsers |
| `app/loading.tsx` | New | Root fallback lifecycle signal; medium ordering risk | Use layout-effect signal and integration-test commit/fallback ordering |
| `app/error.tsx` | New | Localized canonical route failure | Never expose raw error/digest; release overlay before interaction |
| Internal links/GET forms | Modified | Migrate to typed adapters; medium omission risk | Inventory imports/raw anchors and architecture-test remaining first-party anchors |
| Server Action forms | Unchanged structurally | Installed Next bypasses the hook and redirects reconcile at commit; high replay risk if wrapped incorrectly | Do not add generic submit interception or automatic retry |
| `app/layout.tsx` | Modified | Adds shell wrapper, client island, serializable labels; medium hydration risk | Preserve server session/theme/locale resolution and startup splash order |
| Typed dictionaries | Modified | Adds transition/offline/error/retry copy | Add `pt-BR` first and let English typecheck against it |
| `src/core/pwa/offline.ts` | New | Generates standalone cacheable HTML; high privacy importance | Escape strings and prove response body contains no seeded private markers |
| `scripts/sw-template.js` | Modified | Adds RSC failure messaging and tighter allowlist; high cache-policy risk | Preserve network-only default and test real Cache Storage |
| `scripts/sw-version.mjs` | Modified | Generates a second ignored artifact | Make generation deterministic and fail on missing template/version markers |
| PWA/unit/E2E/QA contracts | Modified | Adds transition and true-offline coverage | Run targeted QA on desktop/mobile before PR; full QA tier before production promotion |

## Testing Approach

- **Frameworks and harnesses:** Vitest with fake timers for the pure reducer/store, existing static PWA tests for generated policy, production Next build through the isolated E2E harness, Playwright Chromium plus the repository's mobile/WebKit-compatible journey tooling, and real service-worker Cache Storage inspection. Fakes are limited to time, network failure, and browser I/O boundaries.
- **Unit level:** URL classification, reducer transitions, timer boundaries, generation races, service-worker message validation, HTML escaping/localization, generation determinism, and cache eligibility.
- **Integration level:** router-hook/store wiring, adapter duplicate coalescing, commit plus root-fallback ordering, error-boundary release, service-worker client messaging, credentialless generation, and private-body exclusion.
- **End-to-end level:** each user journey through the public UI at 1280×900 and 375×812, including menu, contextual links, GET URL changes, Server Action redirects, history, prefetched/slow/error/offline flows, retry, locales, themes, reduced motion, zoom, safe areas, interaction blocking, focus, and announcements.
- **Execution:** implementation tasks run their assigned cases first. Feature completion requires `rtk pnpm check`, applicable targeted browser runs, `rtk pnpm test:e2e`, targeted `qa-report`/`qa-execution`, agent audit where applicable, `deslop`, and `deep-review` before `ship-pr`.
- The canonical individual cases and ownership IDs are in [`_tests.md`](_tests.md).

## Development Sequencing

### Build Order

1. Add typed i18n copy, pure transition types/reducer, URL classifier, and their unit tests.
2. Add browser store, timers, service-worker message parser, and concurrency tests.
3. Add the Next router instrumentation bridge plus a framework compatibility test.
4. Add the root presenter, application-shell inert integration, loading lifecycle signal, route error surface, and shared splash styles.
5. Add stable `TransitionLink`/`TransitionGetForm` adapters and migrate the internal navigation inventory without touching POST action semantics.
6. Add the standalone offline renderer and extend build generation.
7. Harden service-worker allowlists, add RSC failure messages, and verify cached bodies contain no private data.
8. Complete desktop/mobile E2E, accessibility, offline/reconnect, role, and concurrency journeys.
9. Update the living QA tracker, execute targeted dogfooding, run full automated gates, agent audit, `deslop`, `deep-review`, and `ship-pr`.

### Technical Dependencies

- Run `rtk pnpm install` in the implementation worktree before coding so local documentation/runtime matches `next@^16.3.2` from `package.json` and `pnpm-lock.yaml`.
- No new runtime package, database migration, service, secret, feature flag, or environment variable is required.
- Production-like service-worker tests require a build and HTTPS-equivalent/localhost secure context; the existing isolated E2E runner supplies the local origin.
- Chromium service-worker coverage is mandatory. Mobile layout parity remains required at 375×812; use the repository's existing supported mobile browser harness for complementary rendering verification.

## Monitoring and Observability

- No external analytics or user-navigation payload is introduced.
- Development/test builds expose `data-testid` and phase attributes on the overlay for deterministic browser assertions; user-visible lookup never depends on translated text.
- Unexpected reducer/store events may log one redacted development warning containing only event type and generation, never URL query values, session, email, token, or form content.
- CI gates measure:
  - transition overlay absent after every completed/error journey;
  - prolonged threshold at 3,000 ms;
  - no cached response body containing seeded email, CV, job, application, salary, token, or public-profile markers;
  - no horizontal overflow at 375 px and 200% zoom;
  - no accessibility violations on normal, prolonged, offline, and error states.
- No production alert threshold is added because the app has no client telemetry pipeline. A permanently visible overlay or cache-policy regression is release-blocking through E2E/CI rather than an after-deploy alert.

## Technical Considerations

### Key Decisions

- **Hybrid start integration:** use `onRouterTransitionStart` for router-owned push/replace/traverse coverage and typed adapters for stable project ownership, with ADR-005's commit reconciliation limited to accepted Server Action redirects and committed-history supersession.
- **Two-signal readiness:** require URL commit plus absence of the root loading fallback. This prevents premature exposure of streamed routes while still supporting prefetched routes that skip fallback UI.
- **Generation ownership:** latest target wins synchronously. This prevents old timers, errors, offline messages, or out-of-order completions from dismissing a newer overlay.
- **180 ms minimum and no maximum:** align with the existing route motion token, change copy at 3 seconds, and never lie about completion.
- **Standalone credentialless offline document:** cache only a generated public shell and explicit static assets. This trades a small duplicated shell for privacy independent of session cleanup.
- **Hard retry after offline:** retrieve current authorization and data from the server. Do not automatically replay Server Actions or synthesize RSC success.

### Known Risks

- **Router hook compatibility:** likelihood medium across Next upgrades; mitigation is a pinned lockfile, local-doc verification after install, and a contract test that blocks upgrade.
- **Readiness effect ordering:** likelihood low after prescribed layout/effect split; mitigation is an integration race test covering fallback mount in the same commit.
- **Unadapted future internal anchor:** likelihood medium; mitigation is an architecture test forbidding raw same-origin navigation anchors outside an explicit allowlist.
- **Over-broad service-worker cache admission:** impact critical; mitigation is deny-by-default runtime logic plus generated-cache and body-content tests with authenticated fixtures.
- **False offline from stale worker message:** likelihood low; mitigation is target normalization and generation ownership.
- **Overlay blocks recovery:** impact high; mitigation is no maximum dismissal but browser controls remain available, route errors explicitly release, and offline/error phases expose only their intended retry control.
- **Duplicate screen-reader announcements:** likelihood medium under rapid transitions; mitigation is one atomic live node, same-target start coalescing, and announcement-specific E2E assertions.

## Architecture Decision Records

- [ADR-001: Use One Full-Screen Splash Contract for First-Party Navigation](adrs/adr-001.md) — Defines the global adaptive loading experience.
- [ADR-002: Keep Offline Support Shell-Only and Free of Private Content](adrs/adr-002.md) — Defines the privacy boundary for offline support.
- [ADR-003: Coordinate Navigation Transitions with a Next Router Hook and Typed Adapters](adrs/adr-003.md) — Chooses the hybrid App Router integration and generation-based coordinator.
- [ADR-004: Generate a Credentialless Standalone Offline Document](adrs/adr-004.md) — Isolates cached offline HTML from sessions and private route data.
- [ADR-005: Reconcile Accepted Server Action Redirects at Route Commit](adrs/adr-005.md) — Records the installed Next 16.3.2 hook gap and the bounded compatibility path.
