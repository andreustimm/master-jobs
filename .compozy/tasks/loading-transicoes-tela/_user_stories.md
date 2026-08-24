# User Stories: Unified Navigation Splash and Safe Offline Shell

Canonical behavior catalog for the unified navigation splash and safe offline shell. Companion to `_prd.md`; consumed by `_techspec.md` (component mapping) and `_tests.md` (coverage matrix).

## Personas

- **Andreus / candidate** — moves quickly among ranking, jobs, comparisons, profile, and pipeline on desktop and mobile and needs unequivocal feedback that a requested screen change is progressing.
- **Recruiter** — uses a permission-scoped subset of the product and needs the same navigation contract without seeing or caching candidate data outside current authorization.
- **Administrator** — navigates account management and impersonation flows and must not accidentally repeat an action while the previous screen is leaving.
- **Unauthenticated visitor** — moves through login, recovery, and explicitly public profile surfaces and needs coherent loading and offline outcomes.
- **User with access needs** — may use a keyboard, screen reader, browser zoom, reduced motion, or a narrow touch viewport and needs equivalent status without disruptive motion or focus loss.

## Story Index

| ID | Feature Area | Persona | Story |
| --- | --- | --- | --- |
| US-001 | Navigation coverage | All users | Receive one loading experience for every first-party screen transition |
| US-002 | Transition lifecycle | All users | Understand normal, prolonged, failed, and superseded navigation states |
| US-003 | Offline shell | Authenticated user | Reach a safe offline outcome without persisting private content |
| US-004 | Public and authentication | Unauthenticated visitor | Receive the same loading and offline contract on non-authenticated routes |
| US-005 | Inclusive experience | User with access needs | Receive equivalent transition feedback on every device and access mode |

## Navigation Coverage

### US-001: Show one splash for every internal screen change

**As a** Master Jobs user, **I want** every accepted first-party navigation to show the same branded splash, **so that** I always know the product is changing screens rather than ignoring my action.

Acceptance criteria:

- AC-1: Given any supported role on desktop or mobile, when the user selects a destination from the global menu, then a full-screen Master Jobs splash appears and the destination replaces it when ready.
- AC-2: Given an internal contextual link, job card, action link, form redirect, URL-backed view change, or browser back/forward action, when it changes the current screen, then it follows the same transition contract.
- AC-3: Given login, recovery, public profile, candidate, recruiter, or administrator routes, when navigation stays within Master Jobs, then route visibility and permissions do not change the splash behavior.
- AC-4: Given the transition splash is visible, when the user attempts to interact with the covered application, then underlying controls do not receive the interaction; native browser controls remain available.
- AC-5: Given an external destination, theme change, modal, accordion, or disclosure interaction, when the user activates it, then the application does not misclassify it as an internal screen transition.

Edge cases:

- EC-1: Malformed or unsafe internal-looking URL → existing URL validation or routing rejects it; the splash does not conceal the rejection or navigate to an unsafe destination.
- EC-2: Destination is missing or resolves to not-found → the splash yields to the normal localized not-found outcome rather than remaining visible.
- EC-3: The user lacks permission or the session expired → the splash yields to the existing login/forbidden flow without revealing the protected destination.
- EC-4: Two navigation activations occur before the overlay blocks input → only the latest accepted destination owns the visible transition.
- EC-5: Navigation is interrupted with browser back/forward → the newly accepted history destination owns the transition and the abandoned completion cannot dismiss it.
- EC-6: The user repeats the current route or activates a link that does not change the screen → no orphan splash remains and no artificial transition is created.
- EC-7: A form redirects after an already-completed mutation → the splash covers only the screen change; it does not repeat the mutation.
- EC-8: A deep link opens directly in a new document → the existing startup splash supplies the same visual contract once, without stacking a second transition splash.
- EC-9: A URL-backed list has zero, typical, or thousands of results → the splash lifecycle depends on destination readiness, not collection size or item count.
- EC-10: An entity is closed, deleted, or changed before its destination resolves → the destination's canonical not-found/closed state appears after the splash.

## Transition Lifecycle

### US-002: Recover from slow, failed, and superseded navigation

**As a** Master Jobs user, **I want** the splash to reflect the true navigation state, **so that** fast routes do not feel artificially slow and failed routes do not leave me trapped.

Acceptance criteria:

- AC-1: Given a destination becomes ready quickly, when navigation begins, then the splash uses only a short anti-flicker minimum and does not impose the startup splash's 900 ms minimum.
- AC-2: Given navigation is still pending after three seconds, then the status changes to a localized prolonged-wait message while the splash remains visible.
- AC-3: Given navigation completes, then the splash exits with the established transition treatment and exposes the ready destination exactly once.
- AC-4: Given navigation fails for a reason other than offline connectivity, then the splash leaves, a usable screen remains or is restored, and a localized error explains the failure.
- AC-5: Given a newer navigation supersedes an older one, then only the newer navigation may dismiss or update the splash.

Edge cases:

- EC-1: A navigation API reports an unparseable failure → the user receives the generic localized navigation error without raw implementation details.
- EC-2: No prolonged-wait translation is available because of a build defect → typed locale validation fails before release; production never renders blank status text.
- EC-3: Navigation remains pending beyond ordinary limits → the splash remains truthful and the user can still use browser controls; it does not reveal stale content as current.
- EC-4: Session state changes while a route is pending → the resulting authorized login/forbidden destination wins without leaking the original route.
- EC-5: Two transitions resolve out of order → stale resolution is ignored and cannot remove the current transition state.
- EC-6: Connection drops and returns during the same transition → the final online/offline result is shown once; duplicate retry or error notices do not accumulate.
- EC-7: The user retries after a failure → a fresh transition starts with normal loading copy and no residual prolonged/error state.
- EC-8: Browser history skips across multiple entries → the final selected history entry owns the overlay and focus destination.
- EC-9: Destination has empty, normal, or very large streamed content → readiness and status remain coherent without displaying a false percentage.
- EC-10: The transition component itself encounters an unexpected error → a failsafe restores an operable route/error surface rather than leaving a permanent overlay.

## Offline Shell

### US-003: Navigate safely when connectivity disappears

**As an** authenticated user, **I want** a branded offline outcome when navigation cannot reach the server, **so that** I understand what happened without the product storing my private screens on the device.

Acceptance criteria:

- AC-1: Given the safe shell was installed while online, when an internal navigation fails offline, then the splash leads to a localized offline screen with a clear retry path.
- AC-2: Given the application starts without connectivity, then eligible static shell resources render an understandable offline outcome instead of the browser's generic network error.
- AC-3: Given any authenticated page, route payload, API response, export, or user data, then offline support never makes that content available from a service-worker cache.
- AC-4: Given connectivity returns, when the user retries, then Master Jobs performs a fresh authorized navigation and replaces the offline outcome when ready.
- AC-5: Given logout, session expiry, profile revocation, or device loss, then privacy does not depend on a future cache-cleanup action.

Edge cases:

- EC-1: A cached shell resource is malformed or outdated → the user receives a safe offline/browser failure; private route content is not substituted.
- EC-2: The device has no service-worker cache yet → offline start fails safely without exposing data or claiming content is available.
- EC-3: Storage is full or the browser refuses caching → online use continues; offline support degrades honestly rather than blocking installation or navigation.
- EC-4: A recruiter or administrator loses authorization while offline → no prior candidate or account screen remains available from cache.
- EC-5: Two offline navigations or retries occur together → one current offline/transition state is visible and repeated actions do not create stacked overlays.
- EC-6: Connectivity returns during the offline handoff → the latest accepted retry resolves normally; the offline completion cannot replace a ready online page.
- EC-7: The user reloads the offline screen repeatedly → the outcome remains idempotent and does not create or expose cached private entries.
- EC-8: Browser back/forward points to a formerly authenticated route while offline → the safe offline outcome appears, not a stored page snapshot.
- EC-9: The cache contains zero, typical, or many eligible versioned assets → private-route exclusion remains invariant and old shell caches are retired by the existing version policy.
- EC-10: A job, account, or public profile was deleted/revoked before the device reconnects → retry retrieves the current server result and never resurrects cached content.

## Public and Authentication Routes

### US-004: Keep loading coherent before authentication

**As an** unauthenticated visitor, **I want** login, recovery, and public-profile transitions to use the same feedback, **so that** the product feels coherent before I enter a protected area.

Acceptance criteria:

- AC-1: Given a login, forgot-password, reset-password, callback, or public-profile route, when a first-party screen transition occurs, then the same full-screen splash and adaptive lifecycle apply.
- AC-2: Given successful authentication or recovery redirects to an authorized route, then one continuous transition ends at the correct destination without exposing an intermediate protected page.
- AC-3: Given a public profile is not available, then navigation resolves to the existing 404 behavior rather than revealing that a private slug exists.
- AC-4: Given an offline attempt to reach a public profile, then the safe offline outcome appears; the profile is never served from cache.

Edge cases:

- EC-1: Invalid, expired, hostile, or replayed authentication token → the normal localized invalid/expired outcome replaces the splash without leaking token details.
- EC-2: Email or optional public-profile content is empty → existing validation/allowlist behavior remains authoritative after the transition.
- EC-3: A public-profile URL is extremely long or malformed → routing fails safely and the overlay cannot create horizontal overflow.
- EC-4: A signed-in user lacks the role for the redirect destination → authorization chooses the valid destination before the splash leaves.
- EC-5: Two callback/recovery navigations race → one token can complete only according to existing single-use rules; transition feedback does not replay it.
- EC-6: Connectivity fails after a token was consumed but before redirect → retry follows the canonical authentication result and does not claim the token is reusable.
- EC-7: Reloading a completed callback or reset URL → existing replay protection remains visible after normal loading.
- EC-8: Browser back returns to a consumed token route → the invalid/used-token state appears rather than a cached success page.
- EC-9: Many public-profile fields or long user-provided text are present → the destination remains responsive; the transition overlay contains no user content.
- EC-10: A public profile is revoked during navigation → the destination resolves as 404 and no cached profile is displayed.

## Inclusive Experience

### US-005: Receive accessible feedback on every device

**As a** user with access needs, **I want** loading feedback to respect my language, input method, viewport, and motion preference, **so that** navigation remains understandable without discomfort or loss of context.

Acceptance criteria:

- AC-1: Given `pt-BR` or English is active, then normal loading, prolonged loading, offline, and failure states use the active typed dictionary.
- AC-2: Given a screen reader is active, when a transition begins or changes to prolonged/offline/failure state, then the status is announced politely once without moving focus into the overlay.
- AC-3: Given `prefers-reduced-motion: reduce`, then the splash provides the same information with non-essential entrance, sweep, and fade motion removed.
- AC-4: Given desktop 1280×900 or mobile 375×812, including safe-area insets and browser zoom, then the full-screen splash remains contained, centered, legible, and free of horizontal overflow.
- AC-5: Given navigation completes, then focus follows the destination's normal accessible behavior and is not left on a removed loading node.

Edge cases:

- EC-1: A hostile or malformed localized value reaches interpolation → it renders as text and cannot inject active content.
- EC-2: Status text is unexpectedly blank → typed translation/build validation prevents release rather than presenting a silent loader.
- EC-3: Text expansion, 200% zoom, or a narrow viewport wraps the prolonged/offline message → content remains visible without clipping or horizontal scrolling.
- EC-4: A role changes which destination is allowed → accessibility feedback remains identical and never announces protected content.
- EC-5: Screen reader and visual state receive several rapid updates → duplicate announcements are coalesced so the current state is announced once.
- EC-6: Reduced-motion preference changes during a transition → the current visual honors the new preference without restarting navigation.
- EC-7: Repeated navigations after success or failure → each transition starts from the normal localized state with no stale announcement.
- EC-8: Back/forward navigation restores focus history → removed overlay nodes never become the focus target.
- EC-9: Desktop, mobile browser, and installed PWA use different safe-area values → the splash covers the visual viewport and keeps its content inside usable bounds.
- EC-10: Theme or system color mode changes while loading → semantic tokens maintain readable contrast without displaying two splash instances.
