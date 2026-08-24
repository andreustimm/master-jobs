# Test Specification: Unified Navigation Splash and Safe Offline Shell

Canonical test contract for the unified navigation splash and safe offline shell. Companion to `_techspec.md`; derived from `_user_stories.md` and the technical components defined in the TechSpec.

## Strategy

- **Frameworks and harnesses:** Vitest for pure/stateful modules and composition-boundary integration with fake timers only at the clock boundary; the isolated Next.js production-build runner plus Playwright/real Chromium for runtime integration, service-worker behavior, and desktop journeys; the repository's mobile browser harness at 375×812 for responsive parity. Network and storage are faked only in unit tests. `IT-*` identifies a cross-module contract: IT-001–IT-005 and IT-010–IT-011 are composition checks corroborated by their adjacent production-browser `E2E-*` journeys, while IT-006–IT-009 and IT-012–IT-014 execute in real browser/runtime fixtures with their own narrower predicates.
- **Execution:** task-scoped cases first, then `rtk pnpm check`, targeted browser tests, `rtk pnpm test:e2e`, targeted `qa-report`/`qa-execution`, and the repository's review/ship gates. Service-worker cases run against generated `public/sw.js` and `public/offline.html` from a production-equivalent build.
- **Conventions:** table-driven cases for URL/state boundaries, fake timers advanced to exact milliseconds, stable `data-testid` selectors for controls and transition phases, no translated control lookup, and seeded private markers when inspecting cache bodies. Every asynchronous race asserts the active generation before and after the stale signal.

## Coverage Matrix

| Source | Behavior | Unit | Integration | E2E |
| --- | --- | --- | --- | --- |
| US-001 | Every accepted first-party screen change uses one splash | UT-001, UT-004–UT-006 | IT-001–IT-004, IT-012 | E2E-001–E2E-005 |
| US-001.EC-1 | Malformed or unsafe URL fails without concealed navigation | UT-003, UT-038 | — | E2E-019 |
| US-001.EC-2 | Missing destination yields canonical not-found | — | IT-014 | E2E-019 |
| US-001.EC-3 | Denied/expired session yields canonical auth result | — | IT-013 | E2E-020 |
| US-001.EC-4 | Near-simultaneous starts leave only latest owner | UT-006, UT-015 | IT-002 | E2E-008 |
| US-001.EC-5 | Back/forward interruption changes ownership | UT-006, UT-015 | IT-001 | E2E-005, E2E-008 |
| US-001.EC-6 | Same route creates no orphan transition | UT-002, UT-005 | IT-002 | E2E-006 |
| US-001.EC-7 | Redirect after mutation does not replay mutation | UT-017 | IT-012 | E2E-004 |
| US-001.EC-8 | Direct deep link renders startup only | UT-032 | IT-010 | E2E-013 |
| US-001.EC-9 | Result cardinality does not alter lifecycle | UT-009–UT-011 | — | E2E-003 |
| US-001.EC-10 | Changed/deleted entity yields canonical result | — | IT-014 | E2E-019 |
| US-002 | Normal, prolonged, failed, and superseded lifecycle | UT-004–UT-018, UT-029–UT-030 | IT-003–IT-005 | E2E-006–E2E-009 |
| US-002.EC-1 | Unparseable failure becomes generic localized error | UT-037 | IT-005 | E2E-009 |
| US-002.EC-2 | Missing prolonged translation fails before release | UT-033 | — | — |
| US-002.EC-3 | Indefinite pending remains truthful with browser recovery | UT-011 | — | E2E-007 |
| US-002.EC-4 | Session change chooses authorized result | UT-015 | IT-013 | E2E-020 |
| US-002.EC-5 | Out-of-order completion cannot dismiss latest | UT-012, UT-015 | IT-003 | E2E-008 |
| US-002.EC-6 | Connectivity flapping produces one final phase | UT-013–UT-018 | IT-007 | E2E-010 |
| US-002.EC-7 | Retry starts from clean normal state | UT-017, UT-029 | — | E2E-010 |
| US-002.EC-8 | Multi-entry traversal leaves final history owner | UT-006, UT-015 | IT-001 | E2E-005 |
| US-002.EC-9 | Stream size does not invent determinate progress | UT-009–UT-011 | IT-003 | E2E-007 |
| US-002.EC-10 | Transition component failure restores operable surface | UT-016, UT-037 | IT-005 | E2E-009 |
| US-003 | Safe offline shell without private persistence | UT-019–UT-028, UT-034–UT-036 | IT-006–IT-009 | E2E-010–E2E-012 |
| US-003.EC-1 | Malformed/outdated shell fails without private substitution | UT-024, UT-028 | IT-006 | E2E-011 |
| US-003.EC-2 | No cache installed fails safely | UT-028 | IT-006 | E2E-012 |
| US-003.EC-3 | Storage refusal preserves online behavior | UT-028 | IT-006 | E2E-012 |
| US-003.EC-4 | Lost authorization exposes no prior private screen | UT-026 | IT-008 | E2E-020 |
| US-003.EC-5 | Concurrent offline/retry does not stack | UT-013, UT-017 | IT-007 | E2E-010 |
| US-003.EC-6 | Online retry wins over stale offline completion | UT-014–UT-015 | IT-007 | E2E-010 |
| US-003.EC-7 | Repeated offline reload remains idempotent | UT-027–UT-028 | IT-006 | E2E-011 |
| US-003.EC-8 | Offline history never restores cached private page | UT-026 | IT-008 | E2E-011 |
| US-003.EC-9 | Cache cardinality preserves exclusion and retires old versions | UT-026–UT-027 | IT-008 | E2E-011 |
| US-003.EC-10 | Reconnect retrieves current deletion/revocation | UT-017–UT-018 | IT-014 | E2E-010, E2E-019 |
| US-004 | Auth and public routes share transition/offline contract | UT-001, UT-021–UT-024 | IT-012–IT-014 | E2E-004, E2E-013, E2E-018 |
| US-004.EC-1 | Invalid/replayed token yields canonical safe result | UT-037 | IT-013 | E2E-018 |
| US-004.EC-2 | Empty optional public data preserves existing validation | — | IT-014 | E2E-018 |
| US-004.EC-3 | Extremely long/malformed public URL fails without overflow | UT-038 | IT-014 | E2E-017, E2E-019 |
| US-004.EC-4 | Role mismatch redirects to valid authorized destination | — | IT-013 | E2E-020 |
| US-004.EC-5 | Racing callback/recovery cannot replay token | UT-015 | IT-013 | E2E-018 |
| US-004.EC-6 | Consumed token plus connectivity failure preserves canonical result | UT-013–UT-018 | IT-007, IT-013 | E2E-010, E2E-018 |
| US-004.EC-7 | Reloaded callback shows replay protection | — | IT-013 | E2E-018 |
| US-004.EC-8 | History to consumed token never serves cached success | UT-026 | IT-008, IT-013 | E2E-005, E2E-018 |
| US-004.EC-9 | Long public content never enters overlay | UT-024 | IT-014 | E2E-013, E2E-017 |
| US-004.EC-10 | Profile revoked during navigation resolves 404 | UT-026 | IT-014 | E2E-019 |
| US-005 | Locale, accessibility, motion, theme, and viewport parity | UT-021–UT-023, UT-031, UT-033 | IT-010–IT-011 | E2E-014–E2E-017 |
| US-005.EC-1 | Hostile localized value is escaped | UT-023 | — | — |
| US-005.EC-2 | Blank status is rejected before build | UT-033 | — | — |
| US-005.EC-3 | Expanded copy/200% zoom remains contained | — | — | E2E-017 |
| US-005.EC-4 | Role changes do not alter announced protected content | UT-024 | IT-013 | E2E-015, E2E-020 |
| US-005.EC-5 | Rapid updates coalesce announcements | UT-005–UT-006, UT-029 | IT-002 | E2E-015 |
| US-005.EC-6 | Reduced-motion change removes motion without restart | UT-031 | IT-011 | E2E-016 |
| US-005.EC-7 | Repeated transitions reset announcements/state | UT-029 | IT-003 | E2E-015 |
| US-005.EC-8 | History restoration never focuses removed overlay | UT-015 | IT-001 | E2E-005, E2E-015 |
| US-005.EC-9 | Desktop/mobile/PWA safe areas remain usable | UT-031 | IT-011 | E2E-017 |
| US-005.EC-10 | Theme changes preserve contrast and singleton overlay | UT-031 | IT-010–IT-011 | E2E-016 |
| Transition reducer/store | State, time, concurrency, and error paths | UT-004–UT-018, UT-029–UT-030 | IT-001–IT-005 | E2E-006–E2E-010 |
| URL classifier/adapters | Internal acceptance and native exclusions | UT-001–UT-003, UT-035, UT-038 | IT-001–IT-002 | E2E-001–E2E-005, E2E-019 |
| Router instrumentation contract | Next hook start bridge and failure isolation | UT-004, UT-037 | IT-001–IT-002 | E2E-004–E2E-005 |
| Presenter/loading/error components | Blocking, readiness, accessible phase, recovery | UT-009–UT-012, UT-016, UT-029–UT-033, UT-037 | IT-003–IT-005, IT-010–IT-011 | E2E-006–E2E-009, E2E-014–E2E-017 |
| Offline renderer/generator | Deterministic localized credentialless document | UT-021–UT-024, UT-034 | IT-006, IT-008 | E2E-011–E2E-012, E2E-014 |
| Service-worker message/cache contract | Deny-by-default cache and matching failure signal | UT-019–UT-020, UT-025–UT-028, UT-036 | IT-006–IT-009 | E2E-010–E2E-012 |

## Unit Tests

### URL classification and stable adapters

- **UT-001** (happy): `classifyNavigation()` receives current `https://jobs.example/jobs` and candidate `/pipeline?stage=applied`; it returns an internal screen target normalized to `/pipeline?stage=applied`.
- **UT-002** (boundary): `classifyNavigation()` receives the current pathname/search with either no fragment or a changed fragment; it returns `null` for both same-screen cases.
- **UT-003** (error): `classifyNavigation()` receives `javascript:alert(1)`, `https://other.example/jobs`, and malformed `%`; each returns `null` without throwing.
- **UT-035** (state): `shouldStartFromLinkEvent()` returns false for prevented events, non-primary buttons, modifier keys, `download`, and non-`_self` targets, and true for an ordinary primary same-origin activation.
- **UT-038** (boundary): `classifyNavigation()` handles a 16 KiB same-origin public-profile path without throwing and rejects a malformed URL containing an invalid escape.

### Pure transition reducer and browser store

- **UT-004** (happy): `start` from `idle` at `1000` creates generation `1`, phase `loading`, the normalized target, and `committed=false`.
- **UT-005** (idempotency): a second `start` for the same active target returns unchanged generation and phase.
- **UT-006** (concurrency): a `start` for a different target while pending increments generation and clears committed/fallback/prolonged state from the older target.
- **UT-007** (ordering): `url-committed` with a mismatched URL leaves `committed=false`.
- **UT-008** (ordering): `url-committed` for the active target sets `committed=true` but does not leave while `fallbackCount=1`.
- **UT-009** (state): `fallback-unmounted` for the active committed generation makes completion eligible only when the count reaches zero.
- **UT-010** (boundary): a ready transition at 179 ms remains visible and the same transition at 180 ms enters `leaving`.
- **UT-011** (boundary): the phase is `loading` at 2,999 ms and `prolonged` at exactly 3,000 ms without scheduling dismissal.
- **UT-012** (concurrency): prolonged, leave, and reset callbacks carrying an old generation cannot change the current snapshot.
- **UT-013** (error): an offline event with active generation and matching target changes `loading` or `prolonged` to `offline` exactly once.
- **UT-014** (ordering): an offline message for a mismatched target or stale generation is ignored.
- **UT-015** (concurrency): out-of-order commit/error/offline/completion signals from generation `1` cannot mutate generation `2`.
- **UT-016** (error): `failRoute()` cancels phase timers, releases the overlay, and leaves the store in an operable idle snapshot.
- **UT-017** (idempotency): two retry activations in one offline generation invoke one hard navigation to the active target.
- **UT-018** (state): an `online` event while offline preserves the offline phase and does not invoke navigation automatically.
- **UT-029** (state): a new transition after success, error, or offline retry begins with normal loading phase and no stale prolonged/error announcement state.
- **UT-030** (ordering): two nested fallback mounts require two matching cleanups before a committed transition becomes ready.

### Service-worker messages and cache policy

- **UT-019** (happy): `parseNavigationOfflineMessage()` accepts exactly `{type:"navigation-offline", url:"/jobs/1"}` and returns the typed value.
- **UT-020** (error): the parser rejects null, arrays, unknown types, missing URL, external URL, and additional prototype-hostile values without throwing.
- **UT-025** (state): `isCacheableStatic()` accepts only each explicit precache URL and `/_next/static/chunk.js`; it rejects `/jobs.json`, `/api/data.json`, and cross-origin assets.
- **UT-026** (error): cache eligibility rejects HTML/RSC/API/export/public-profile/private prefixes, including `/p/slug`, `/admin/users`, `/candidate`, `/pipeline`, `/referrals`, `/compare`, and an unrecognized authenticated route.
- **UT-027** (idempotency): activation with zero, one, or many obsolete cache names deletes every non-current version and preserves only current `static-*` and `shell-*` caches.
- **UT-028** (error): missing `/offline.html`, a rejected Cache Storage write, or quota failure leaves install settled and makes fallback return only the non-sensitive plain-text `503`.
- **UT-036** (error): a redirected response, response with non-OK status, or response containing a disallowed router payload is never inserted into shell/static caches.

### Offline renderer, i18n, and presentation contract

- **UT-021** (happy): `renderOfflineDocument()` contains the exact typed `pt-BR` offline title/body/retry strings and marks them as the default locale.
- **UT-022** (happy): the same document contains the exact typed English offline title/body/retry strings and locale-selection data.
- **UT-023** (error): a translation containing `<script>`, quotes, ampersand, and `</style>` is escaped and never appears as active markup or executable script.
- **UT-024** (state): generated offline markup and transition labels contain no supplied session email, candidate name, CV marker, job description, salary marker, application ID, reset token, or public-profile content.
- **UT-031** (state): shared splash CSS includes semantic theme tokens, safe-area insets, wrapping constraints, and a reduced-motion branch that removes entrance, sweep, and fade animation.
- **UT-032** (state): startup rendering retains `SPLASH_MIN_MS=900`, current root identity, headless bypass, and one startup node while transition constants remain separate.
- **UT-033** (error): typed dictionary validation fails when any normal/prolonged/offline/failure/retry English leaf is missing or blank.
- **UT-034** (idempotency): two generator runs for the same version/revision produce byte-identical `sw.js` and `offline.html`; a changed revision changes only the version marker-dependent output.
- **UT-037** (error): `toPublicNavigationError()` maps arbitrary thrown values, Next digests, and unparseable objects to one generic dictionary key without returning raw content; the App Router instrumentation bridge also swallows a forced store exception so observability cannot abort navigation.

## Integration Tests

### App Router bridge and readiness

- **IT-001**: load the real `instrumentation-client.ts`, invoke `onRouterTransitionStart()` with `push`, `replace`, and `traverse`, and assert each valid target reaches the shared store with the corresponding current generation.
- **IT-002**: activate a real `TransitionLink` whose router hook reports the same target in the same navigation; assert the store creates one generation and subscribers receive one loading phase announcement.
- **IT-003**: begin a route, mount the root loading signal in the same React commit as the URL observer, commit the target, and assert leaving occurs only after the loading signal unmounts and the 180 ms boundary passes.
- **IT-004**: begin and commit an already-prefetched target without mounting root loading; assert the overlay observes the 180 ms minimum and then leaves.
- **IT-005**: make a route render throw, mount real `app/error.tsx`, and assert the overlay releases before the localized error retry button becomes operable and no raw error/digest is rendered.

### Service-worker and generated shell

- **IT-006**: install the generated service worker with a request recorder; assert `/offline.html` is requested with `credentials:"omit"`, online navigation is network-only, and missing/storage-rejected shell degrades to non-sensitive `503`.
- **IT-007**: reject a same-origin RSC request for the active target; assert the worker posts one typed message to the initiating client, the matching generation enters offline, and a later stale worker completion cannot replace a successful hard retry.
- **IT-008**: seed authenticated pages and responses with unique email/CV/job/application/salary/token markers, exercise install and runtime fetching, and assert no Cache Storage key or response body contains any marker; `/login` and `/p/slug` are absent.
- **IT-009**: request `/api/export`, an RSC payload, a same-origin `.json` private path, and an unknown navigation; assert all bypass cache admission and no offline HTML is returned as a successful router payload.

### Layout, locale, auth, and canonical outcomes

- **IT-010**: render the real root layout for direct load and hydrate the transition island; assert exactly one startup splash exists initially and no transition overlay appears until an App Router start.
- **IT-011**: render transition phases across all semantic themes/modes and dynamically toggle reduced motion; assert computed animation becomes none without changing generation or status text.
- **IT-012**: submit a real redirecting Server Action fixture with a mutation counter; assert no adapter starts on POST submit, the accepted router redirect starts one transition, and the counter increments once.
- **IT-013**: exercise expired login/reset token, consumed callback, missing role, expired session, and impersonation exit redirects; assert each canonical authorized/login/forbidden destination commits and releases the active generation without protected copy in the overlay.
- **IT-014**: exercise missing/deleted job, empty public profile, revoked profile, and unavailable entity during navigation; assert the normal 404/closed behavior renders after the overlay and no prior entity body comes from cache.

## End-to-End Tests

### First-party navigation coverage

- **E2E-001**: at 1280×900 as a candidate, activate every desktop global-menu destination by `data-testid`; each accepted route displays one full-screen transition phase before the expected route landmark.
- **E2E-002**: at 375×812, open the mobile menu and select every allowed destination; the popover closes, one full-screen transition appears, and the destination landmark becomes visible without horizontal overflow.
- **E2E-003**: activate a job card/detail link, pagination link, density control, and URL-backed filter with zero, typical, and large-result fixtures; each actual screen change uses the same lifecycle and collection size does not change phase rules.
- **E2E-004**: submit login, password recovery, compare, manual-job creation, and impersonation fixtures that redirect; each mutation occurs once and one transition begins only for the accepted redirect.
- **E2E-005**: traverse back/forward rapidly across at least three entries; only the final history destination owns the overlay, the final landmark receives normal browser/Next focus behavior, and no removed overlay node holds focus.

### Timing, races, and failures

- **E2E-006**: navigate to an already-prefetched route; the transition becomes observable, remains for 180 ms ± browser scheduling tolerance, never inherits 900 ms, and disappears at the ready destination.
- **E2E-007**: delay a route beyond 3,000 ms; normal copy changes once to prolonged copy, the overlay remains beyond the old maximum until the response resolves, and the bar never exposes a percentage.
- **E2E-008**: dispatch two accepted destinations before the first settles and complete them out of order; the older completion cannot dismiss or change the newer transition.
- **E2E-009**: force a non-connectivity route-render failure and an unparseable client failure; the overlay releases, localized generic error UI remains operable, retry succeeds, and no technical message or digest is visible.

### Offline and recovery

- **E2E-010**: with an installed worker, begin a soft navigation, drop connectivity, restore it, and activate retry twice; one localized offline phase appears, one fresh hard request reaches the current authorized destination, and no stale offline/error phase replaces it.
- **E2E-011**: after an online install, start and reload while offline at authenticated, public-profile, and history URLs; the standalone localized offline document appears at the attempted URL, repeated reload is idempotent, and real Cache Storage contains only eligible public shell/static bodies.
- **E2E-012**: start offline in a fresh context with no worker cache and in a context where Cache Storage rejects writes; the browser/plain `503` failure is honest, no private page is visible, and later online use succeeds.

### Public/auth routes and canonical security behavior

- **E2E-013**: directly deep-link and internally navigate among login, forgot/reset, callback, and an available public profile; direct load has one startup splash, soft navigation has one transition splash, and the overlay never contains public-profile/user text.
- **E2E-018**: exercise invalid, expired, replayed, and raced reset/callback tokens plus empty optional public content; canonical localized outcomes appear, token actions occur once, and no cached success page is restored by reload/history.
- **E2E-019**: navigate to malformed/very long public URLs, missing/deleted jobs, and a profile revoked while pending; the route safely resolves/rejects, the overlay never remains orphaned, and no horizontal overflow or stale entity content appears.
- **E2E-020**: repeat representative navigation as candidate, recruiter, administrator, impersonated administrator, expired session, and missing-role user; the correct authorized/login/forbidden route wins while transition copy remains role-neutral and Cache Storage exposes no previous role's content.

### Accessibility, locale, theme, and responsive parity

- **E2E-014**: run normal, prolonged, offline, and failure phases under `pt-BR` and English; each exact typed string appears in the active locale and no opposite-locale interface literal appears.
- **E2E-015**: with accessibility-tree inspection, activate and supersede transitions; one polite atomic status is announced per current phase, underlying pointer/keyboard/touch controls are inert, browser controls remain usable, focus never enters the status node, and destination focus is normal after removal.
- **E2E-016**: across HP/Huly/Graphy and light/dark/system, toggle reduced motion during an active transition; computed contrast remains compliant, one overlay exists, and entrance/sweep/fade motion stops without restarting state.
- **E2E-017**: at 1280×900 and 375×812 with 200% zoom, long localized copy, and asymmetric safe-area fixture values, the overlay covers the visual viewport, content stays inside usable insets, remains readable/wrapped, and `scrollWidth` never exceeds viewport width.
