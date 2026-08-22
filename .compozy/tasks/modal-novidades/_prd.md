# Product Requirements Document: What's New Modal Redesign

## Overview

Master Jobs currently presents its user-facing changelog as a dense, continuously
expanded block. Versions have little visual separation, content has insufficient
interior spacing, multiline items are truncated, and Markdown markers such as
`**bold**` appear literally. The result is difficult to scan and can omit part
of the information a release maintainer intended users to read.

This feature redesigns the existing footer-triggered What's New modal for every
Master Jobs user, including candidates, recruiters, and administrators. It
adopts the scan-first hierarchy demonstrated by the supplied Zorbit reference:
a stable header, a current-version badge, individually bordered release cards,
and independently expandable descriptions. It also turns the changelog into a
truthful localized product surface by rendering safe editorial Markdown,
providing equivalent Portuguese and English notes, and presenting release
instants in the viewer's local timezone.

The redesign is valuable because users can quickly identify what changed,
compare multiple releases when needed, and trust that the content and time they
see are complete rather than a lossy interpretation of the source document.

## Goals

- Users can scan version, publication information, and expansion state without reading every release description.
- Users can keep any number of release descriptions open simultaneously for comparison.
- Every modal opening starts predictably with only the newest release expanded.
- Valid editorial Markdown renders semantically, including multiline content, without exposing formatting delimiters or executing raw HTML.
- Portuguese and English users receive equivalent release-note content in the active interface language.
- New release timestamps represent real UTC publication instants and display in the device's local timezone using the active locale's exact format.
- Historical releases use a recovered real publication instant when trustworthy evidence exists and otherwise remain honestly date-only.
- The redesigned modal remains readable and fully operable across all supported themes, narrow viewports, browser zoom, keyboard navigation, and screen readers.

## User Stories

- `US-001`: modal presentation and scan-first release history.
- `US-002`: independent multi-release disclosure and reset behavior.
- `US-003`: complete and safe editorial Markdown rendering.
- `US-004`: equivalent Portuguese and English release-note editions.
- `US-005`: truthful locale- and timezone-aware publication display.
- `US-006`: coherent bilingual release publication and historical recovery.

[Full user stories](_user_stories.md)

## Core Features

### 1. Scan-first modal presentation

The existing footer entry point continues to open a modal over the current page.
The modal presents a stable header with the localized What's New title, the
current application version as a badge, and an explicit close control. The old
continuous document becomes a vertically spaced collection of distinct,
bordered release cards. The collection scrolls inside the modal while the
header remains available.

Each collapsed card still communicates its release identity through an
always-visible row containing a disclosure indicator, a version badge, and its
localized publication value. The visual direction should be similar to the
supplied Zorbit reference in hierarchy and spacing, while Master Jobs typography,
colors, radii, and semantic theme tokens remain authoritative.

### 2. Independent release disclosure

Only the newest visible release is expanded whenever the modal opens. Users can
open or close each release without altering any other card, including keeping
two or more releases expanded at once. Closing the modal clears those choices;
the next opening restores the newest-only default.

The whole release header row acts as the disclosure control. Its visible and
announced state must remain synchronized, and keyboard users can activate it
with standard controls.

### 3. Safe editorial Markdown

Release descriptions support paragraphs, headings, ordered and unordered lists,
bold, italic, inline and fenced code, block quotes, thematic breaks, and safe
links. Valid syntax renders as structure rather than literal markers. Physical
line wrapping in the source does not truncate or split paragraphs and list
items.

Raw HTML never executes or injects arbitrary interface elements. Unsafe link
destinations do not become actionable. Malformed Markdown degrades to readable
content without breaking the release card or the wider modal.

### 4. Complete content localization

The active Master Jobs interface locale selects the entire modal edition,
including controls, section labels, descriptions, and date formatting.
Portuguese users receive Brazilian Portuguese notes; English users receive
equivalent idiomatic English notes. A single rendering does not mix the two
languages or silently substitute the other locale when content is missing.

This requirement covers the visible historical versions as well as every future
release. The Portuguese and English histories must agree on which versions have
user-visible changes and on the changes described for each version.

### 5. Truthful local publication time

Every future release preserves its real publication instant in UTC. The modal
converts that instant to the viewer device's local timezone and formats it
according to the active interface language:

- `pt-BR`: `dd/mm/yyyy HH:mm`.
- `en`: `mm/dd/yyyy HH:mm`.

Both formats use zero-padded fields and a 24-hour clock. Locale determines the
presentation order; it does not determine the timezone.

Historical releases use a real recovered publication instant when reliable
release evidence provides one. If the product knows only a calendar date, the
card shows only `dd/mm/yyyy` in Portuguese or `mm/dd/yyyy` in English. It never
adds `00:00`, guesses a timezone, or changes the day by pretending that a
date-only record is a UTC instant.

### 6. Coherent release publication

A new user-visible version is complete only when it has equivalent Portuguese
and English editions plus an unambiguous UTC publication instant. A version
with no user-visible changes may remain absent from the user histories, but it
must be absent consistently in both locales. Technical changelog content remains
separate and does not automatically become visible to product users.

Publication and retry behavior must not expose a half-published locale, duplicate
a version, or replace an original publication instant. Existing Portuguese
history receives equivalent English content, and trustworthy historical
publication evidence is recovered as part of this feature.

## Business Rules

1. The visible release order is newest to oldest.
2. Exactly the newest visible release starts expanded on every modal opening.
3. Expanding or collapsing one release never changes another release's state.
4. There is no maximum number of simultaneously expanded releases.
5. Closing the modal discards all release expansion changes.
6. Every card always exposes its version identity and publication value while collapsed.
7. The current application version appears in the stable modal header.
8. A complete UTC instant displays in the device's local timezone, not a fixed application timezone.
9. Portuguese complete timestamps use `dd/mm/yyyy HH:mm`; English complete timestamps use `mm/dd/yyyy HH:mm`.
10. Both supported locales use a zero-padded 24-hour clock without seconds.
11. A trustworthy date with no trustworthy time displays as a localized date only.
12. The product never converts a date-only value as though it were a UTC instant and never fabricates `00:00`.
13. A visible version has equivalent Brazilian Portuguese and English user-facing editions.
14. Missing locale content is invalid release content, not permission to fall back silently to the other language.
15. A version classified as having no user-visible changes produces no empty card and remains consistently absent from both locale histories.
16. User-facing notes describe observable effects and do not expose technical implementation details, secrets, private account data, candidate data, applications, or configuration.
17. Wrapped Markdown lines remain part of their containing block and cannot be silently discarded.
18. Raw HTML never executes, and unsafe links never become actionable.
19. Malformed individual release content cannot make the footer or the surrounding page unusable.
20. Candidates, recruiters, and administrators receive the same changelog content and interaction; impersonation does not grant a different edition.

## User Experience

### Primary flow

1. The user activates the existing What's New link in the footer.
2. A modal opens over the current page, focus moves into it, and the stable header identifies What's New and the current application version.
3. The newest release is open. All older releases appear as compact cards showing their chevron, version, and localized publication value.
4. The user reads the newest description with its Markdown formatting intact.
5. The user opens one or more older cards. Previously opened cards remain open so changes can be compared.
6. The user closes any card independently or dismisses the modal through its close control, Escape, or supported outside-dismiss behavior.
7. Focus returns to the footer trigger. Reopening the modal again shows only the newest release expanded.

### Locale and timezone flow

1. The current application locale selects either the complete Brazilian Portuguese or English modal edition.
2. For releases with full timestamps, the same stored publication instant converts to the device's current local timezone.
3. The active locale formats the converted result using the required day/month or month/day order.
4. A historical release without reliable time displays a localized date only, with no misleading placeholder.
5. After the user changes the application language, the next modal opening consistently uses the newly active edition.

### UI and accessibility requirements

- Use the Zorbit screenshot as a hierarchy and spacing reference, not as a source of foreign colors, typography, or component tokens.
- Preserve generous separation between modal boundaries, header content, release cards, card headers, and expanded Markdown.
- Keep the title and close action available while long release collections scroll internally.
- Make the entire release header row the disclosure target; do not require precision clicking on the chevron.
- Every disclosure communicates its accessible name, expanded state, and controlled content relationship.
- Focus enters and remains within the modal, Escape dismisses it, and dismissal restores focus to the trigger.
- The interface remains usable at 375 px width, with touch targets, wrapping, and no horizontal page overflow.
- Browser zoom does not hide controls or make content unreachable.
- Every text style meets the product's contrast requirements across HP, Huly, and Graphy in light and dark modes.
- User-visible interface strings come from the typed locale contract rather than hard-coded component text.

## High-Level Technical Constraints

- The existing footer remains the user entry point, and the redesigned modal remains a global UI surface rather than a duplicate changelog page.
- The UI remains an adapter over the canonical user-facing release content; it must not introduce a third manually maintained copy of either locale edition.
- The technical changelog and user-facing localized notes remain separate sources with different audiences.
- Release metadata must distinguish a complete UTC instant from a date-only historical value so the display cannot invent precision.
- Historical time recovery must use trustworthy release evidence. An estimate based only on a calendar date is not trustworthy evidence.
- The feature must follow the existing typed i18n contract for `pt-BR` and `en`.
- The feature must follow the existing design-token, theme, responsive, and mobile constraints in `DESIGN.md` and project instructions.
- The feature must retain the project's safe-by-default security posture and may not execute raw changelog HTML.
- The feature must preserve the current page when opened and avoid exposing technical or private information to any viewer of the changelog.

## Non-Goals (Out of Scope)

- Replacing the technical `CHANGELOG.md` or showing technical release notes to product users.
- Adding search, filters, pagination, categories-as-filters, or a dedicated release-history route.
- Adding unread counters, automatic post-upgrade popups, notifications, or per-user read tracking.
- Persisting expanded releases between modal openings, page loads, devices, or sessions.
- Restricting the accordion to a single open card.
- Supporting executable raw HTML, embedded scripts, arbitrary widgets, or unsafe link protocols in notes.
- Guaranteeing advanced GFM extensions such as tables, task lists, footnotes, or embedded rich media.
- Guessing or synthesizing historical publication times when no reliable instant exists.
- Changing the application language or timezone controls outside the modal.

## Architecture Decision Records

- [ADR-001: Present releases as independently expandable cards](adrs/adr-001.md) — Uses scan-first release cards, newest-only initial state, independent multi-open disclosure, and reset on close.
- [ADR-002: Localize release instants without inventing historical time](adrs/adr-002.md) — Converts real UTC instants to device-local time and keeps unrecoverable history honestly date-only.
- [ADR-003: Publish equivalent localized notes in safe editorial Markdown](adrs/adr-003.md) — Requires bilingual user-facing notes and renders a safe, multiline editorial Markdown subset.

## Open Questions

None. The product decisions required for the TechSpec are resolved.
