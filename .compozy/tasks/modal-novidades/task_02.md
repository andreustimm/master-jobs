---
status: pending
title: Safe Markdown client modal and full browser integration
type: frontend
complexity: high
---

# Task 2: Safe Markdown client modal and full browser integration

## Overview

Deliver the complete browser experience for the localized changelog contract
created in Task 1. The footer remains a server adapter, while a narrow Client
Component owns native-dialog lifecycle, independent disclosures, device-local
publication display, and safe semantic Markdown inside a responsive,
theme-compatible design.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- `app/footer.tsx` MUST remain a Server Component that resolves only the active locale file and passes serializable values to a narrow client modal; it MUST omit the trigger if no valid active-locale release remains.
- The modal MUST use native `<dialog>` semantics with a visible close control, Escape and backdrop dismissal, focus containment/restoration, stable accessible labels, and no duplicate dialog under rapid interaction.
- Every open cycle MUST initialize exactly the newest release as expanded, and disclosure state MUST allow zero, one, several, or all releases to remain open independently; closing and reopening MUST reset to newest-only.
- Release-card headers MUST be real buttons with synchronized `aria-expanded`, `aria-controls`, stable controlled-region IDs, keyboard operation, and decorative chevrons.
- Instant publication text MUST be formatted after hydration in the device's current timezone and active locale while retaining the UTC source in `<time dateTime>`; date-only publication MUST never enter timezone conversion.
- Markdown rendering MUST support the complete editorial element set, omit raw-HTML interpretation, allow only approved relative/HTTP/HTTPS/mailto destinations, and keep malformed input readable and inert.
- Interface labels MUST come from the typed `pt-BR` and `en` dictionaries; the active release prose MUST come only from the matching localized source with no silent cross-locale fallback.
- Styling MUST use existing semantic design tokens, typography classes, spacing/radii, and explicit responsive widths; it MUST work at 375 px, across HP/Huly/Graphy light and dark modes, at browser zoom, and with large histories.
- The public interaction MUST be role-independent, work offline after initial load, avoid runtime changelog fetches, and produce no hydration, console, key, or accessibility errors.
</requirements>

## Subtasks

- [ ] 2.1 Add the safe Markdown rendering adapter and production dependency with semantic element mappings and restricted URL destinations.
- [ ] 2.2 Add reusable, deterministic modal expansion and identifier behavior for newest-only initialization, independent toggles, and close-cycle reset.
- [ ] 2.3 Implement the native dialog lifecycle, focus behavior, dismissal paths, disclosure semantics, internal scrolling, and responsive card presentation.
- [ ] 2.4 Convert the footer into the active-locale server adapter and pass only serializable labels, version, locale, and release data to the client boundary.
- [ ] 2.5 Wire root locale propagation and complete typed Portuguese/English interface labels without JSX literals or duplicate dictionary keys.
- [ ] 2.6 Integrate client-local instant formatting and stable date-only display into semantic `<time>` elements.
- [ ] 2.7 Cover safe Markdown, modal state, locale selection, and the Server-to-Client boundary with the assigned unit and integration cases.
- [ ] 2.8 Extend the isolated Playwright journey across lifecycle, disclosures, locales, timezones, themes, mobile, zoom, roles, offline behavior, malformed content, and large histories.

## Implementation Details

Follow `_techspec.md` sections **Markdown Rendering**, **Client Modal State**,
**Local Publication Formatting**, and **Localized File Selection**. Reuse the
native-dialog conventions already proven by `app/candidate/versions.tsx`, but
keep changelog-specific state and styling inside focused files. Consult
`DESIGN.md` before UI edits and the repository-local Next.js documentation
before changing Server/Client boundaries.

### Relevant Files

- `app/footer.tsx` — existing popover implementation to replace with a locale-aware server adapter and client trigger.
- `app/changelog-modal.tsx` — focused Client Component to create for dialog and disclosure state.
- `app/changelog-markdown.tsx` — safe semantic `react-markdown` adapter to create.
- `app/layout.tsx` — existing locale resolution and footer composition point.
- `app/candidate/versions.tsx` — established native `<dialog>` lifecycle and focus pattern.
- `src/core/changelog.ts` — Task 1's serializable releases, publication formatter, and locale selector contracts.
- `src/core/i18n/pt-BR.ts` — typed source dictionary for all changelog controls and accessible labels.
- `src/core/i18n/en.ts` — English dictionary required to satisfy the Portuguese key contract.
- `src/core/i18n/index.ts` — translator and locale typing boundary.
- `app/design-tokens.css` — canonical visual scale and tokens.
- `app/themes.css` — HP, Huly, and Graphy theme mappings consumed through semantic tokens.
- `app/globals.css` — shared Tailwind/token utilities and layout constraints.
- `package.json` — production `react-markdown` dependency.
- `pnpm-lock.yaml` — reproducible dependency graph.
- `tests/changelog.test.ts` — static Markdown, URL, state, locale-selector, and boundary coverage.
- `tests/e2e/ui.mjs` — public browser interaction, layout, locale, theme, role, and accessibility journey.
- `tests/e2e/run-isolated.mjs` — isolated build, timezone, fixture, database, and port harness.

### Dependent Files

- `USER_CHANGELOG.pt-BR.md` — active Portuguese prose fixture and runtime source produced by Task 1.
- `USER_CHANGELOG.en.md` — active English prose fixture and runtime source produced by Task 1.
- `next.config.ts` — must keep both files present in standalone output from Task 1.
- `tests/i18n.test.ts` — may enforce typed dictionary parity and absence of hard-coded translated UI text.
- `tests/mobile.test.ts` — may enforce prohibited width aliases and real 375 px overflow constraints.
- `DESIGN.md` — source of truth for modal spacing, typography, radii, and responsive composition.

### Related ADRs

- [ADR-001: Present releases as independently expandable cards](adrs/adr-001.md) — Defines newest-only initialization, multi-open behavior, and reset semantics.
- [ADR-002: Localize release instants without inventing historical time](adrs/adr-002.md) — Defines device-local formatting and date-only presentation.
- [ADR-003: Publish equivalent localized notes in safe editorial Markdown](adrs/adr-003.md) — Defines supported editorial Markdown and security boundaries.
- [ADR-004: Isolate browser-only behavior in a client modal](adrs/adr-004.md) — Defines the narrow Client Component and native dialog lifecycle.
- [ADR-005: Store locale editions separately and render with react-markdown](adrs/adr-005.md) — Defines active-locale selection and the renderer choice.

## Deliverables

- Locale-aware server footer adapter and focused native-dialog Client Component with deterministic independent disclosures.
- Safe semantic Markdown renderer with explicit URL policy and no raw HTML execution.
- Exact device-local publication display and stable historical date rendering in both supported locales.
- Responsive Zorbit-inspired card presentation using only the existing design system across every supported theme/mode.
- Full unit, integration, and isolated-browser coverage for the public changelog experience.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**.

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-037, UT-038, UT-039, UT-040, UT-041, UT-042, UT-043 — safe URL policy, raw-HTML inertness, complete semantic Markdown, and malformed-source readability.
- [ ] UT-044, UT-045, UT-046, UT-047, UT-048, UT-049 — newest-only initialization, independent disclosure toggles, reset lifecycle, and stable accessible identifiers.
- [ ] UT-050 — total active-locale file selection without arbitrary paths or silent cross-locale fallback.
- [ ] IT-004 — production renderer dependency and hostile Markdown static-output boundary.
- [ ] IT-011, IT-012, IT-015 — standalone locale delivery, typed locale/fallback contract, and serializable Server-to-Client props.
- [ ] E2E-001, E2E-002, E2E-003, E2E-004, E2E-005, E2E-006, E2E-007, E2E-008, E2E-009 — modal open/close/focus/dismissal and accessible multi-disclosure lifecycle.
- [ ] E2E-010, E2E-011 — complete Markdown semantics and hostile-content safety.
- [ ] E2E-012, E2E-013, E2E-014, E2E-015, E2E-016, E2E-017, E2E-018 — active-locale prose, exact local-time display, date-only stability, timezone boundaries, and locale switching.
- [ ] E2E-019, E2E-020, E2E-021, E2E-022 — narrow/large-content containment, all theme/mode variants, keyboard access, contrast, and zoom.
- [ ] E2E-023, E2E-024, E2E-025, E2E-026 — role equivalence, offline/rapid interaction, hydration/runtime cleanliness, and malformed-or-empty source degradation.

## Success Criteria

- Every assigned test case implemented and passing.
- Opening the modal always shows exactly the newest release initially, while users can independently keep any number of release cards expanded until the modal closes.
- The active locale controls every label, prose body, and exact date/time shape; UTC instants reflect the viewer's current timezone and historical dates remain time-free.
- Supported Markdown renders semantically without literal formatting markers, while raw HTML and unsafe protocols remain inert.
- The modal remains reachable, contained, readable, and accessible at 375 px, browser zoom, large histories, all six theme/mode combinations, and every authorized role.
- Repeated or offline-after-load interaction creates one coherent dialog with no duplicate content, failed fetch, hydration mismatch, console error, or accessibility-state drift.
