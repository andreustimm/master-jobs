# User Stories: What's New Modal Redesign

Canonical behavior catalog for the redesigned What's New modal. Companion to
`_prd.md`; consumed by `_techspec.md` for component mapping and `_tests.md` for
its coverage matrix.

## Personas

- **Master Jobs user** — a candidate, recruiter, or administrator who needs to understand product changes without reading technical release material. All roles receive the same changelog behavior.
- **Mobile or assistive-technology user** — a Master Jobs user who reads updates on a narrow viewport, at browser zoom, with a keyboard, or with a screen reader and needs the full interaction without loss of content or context.
- **Release maintainer** — the person preparing a Master Jobs release who must publish truthful, equivalent, user-facing notes in Portuguese and English.

## Story Index

| ID | Feature Area | Persona | Story |
| --- | --- | --- | --- |
| US-001 | Modal presentation | Master Jobs user | Open a spacious, scannable history of product changes |
| US-002 | Release disclosure | Master Jobs user | Expand and compare any number of releases |
| US-003 | Markdown content | Master Jobs user | Read complete, safely formatted release descriptions |
| US-004 | Content localization | Master Jobs user | Read release notes in the active interface language |
| US-005 | Publication time | Master Jobs user | See truthful publication dates and times in local time |
| US-006 | Release publishing | Release maintainer | Publish complete bilingual notes with trustworthy time metadata |

## Modal presentation

### US-001: Open a scannable release history

**As a** Master Jobs user, **I want** the What's New history to open in a clear,
spacious modal, **so that** I can identify the current version and scan older
versions before choosing what to read.

Acceptance criteria:

- AC-1: Given the footer exposes the What's New entry point, when the user activates it, then a modal opens above the current page without navigating away.
- AC-2: Given the modal is open, then its stable header shows the localized title, the current application version, and a visible close control.
- AC-3: Given at least one visible release exists, then each release appears as a distinct bordered card with an always-visible disclosure indicator, version badge, and localized publication value.
- AC-4: Given the card collection exceeds the available height, then the cards scroll within the modal while the header and close control remain available.
- AC-5: Given any supported theme and light or dark mode, then the modal uses the product design system and all text and controls remain readable.
- AC-6: Given a 375 px viewport or browser zoom, then the modal remains operable without horizontal page scrolling, clipped controls, or hidden content.
- AC-7: Given keyboard or screen-reader use, then focus enters the modal, remains within it while open, identifies it as modal content, and returns to the trigger after dismissal.
- AC-8: Given the modal is open, when the user activates the close control, presses Escape, or uses the supported outside-dismiss behavior, then the modal closes.

Edge cases:

- EC-1: A malformed release lacks a valid version identity → it is not presented as a normal release card, and the rest of the history remains usable.
- EC-2: No visible releases exist or the localized changelog is unavailable → the footer does not open an empty or broken modal.
- EC-3: A version label or localized date is unusually long → the card header wraps or reflows without overlapping the chevron or close control.
- EC-4: A signed-out, expired-session, or lower-privilege visitor reaches a surface where the existing footer is visible → the changelog itself reveals no private candidate, application, configuration, or technical data and does not add a new authorization bypass.
- EC-5: The open trigger is activated twice rapidly → only one modal instance is visible and focus behavior remains valid.
- EC-6: The page loses connectivity while the already-rendered modal is open → available release content remains readable and the modal can still close.
- EC-7: The user repeatedly opens and closes the modal → every cycle has the same stable header, dismissal behavior, and initial release state.
- EC-8: Source release entries are unordered → the visible history is still presented newest first using trustworthy release order rather than arbitrary display order.
- EC-9: A new deployment becomes available while an older page is already open → the current modal remains internally consistent; the next refreshed page shows one coherent newer release history.
- EC-10: The history grows to 100 times its current release count → the modal remains contained and dismissible, and the page behind it does not acquire horizontal overflow.

## Release disclosure

### US-002: Expand and compare releases independently

**As a** Master Jobs user, **I want** to open and close each release independently,
**so that** I can compare two or more versions without repeatedly losing context.

Acceptance criteria:

- AC-1: Given the modal has just opened, then only the newest release is expanded.
- AC-2: Given any collapsed release, when the user activates its header row, then that release expands without changing the state of any other release.
- AC-3: Given any expanded release, when the user activates its header row, then that release collapses without changing the state of any other release.
- AC-4: Given two or more releases, then the user can keep any number of them expanded simultaneously.
- AC-5: Given expanded states were changed, when the modal closes and later reopens, then only the newest release is expanded again.
- AC-6: Given keyboard use, then each release header is reachable and Enter or Space toggles the associated content.
- AC-7: Given screen-reader use, then each release header announces whether it is expanded and identifies the content it controls.

Edge cases:

- EC-1: A toggle points to missing or malformed release content → activating it does not open unrelated content or break other cards.
- EC-2: A valid release has no user-visible description → it does not present an empty expanded region as though content failed to load.
- EC-3: One release contains an extremely long description → opening it grows the internal scroll region without pushing the close control out of reach.
- EC-4: Different account roles use the modal → candidate, recruiter, and administrator receive the same disclosure capabilities; impersonation does not change release content.
- EC-5: The same release header is activated rapidly more than once → its final announced state matches its final visible state.
- EC-6: The modal closes while several cards are expanded → no expansion state leaks into the next opening.
- EC-7: The user expands and collapses one card repeatedly → sibling cards keep their states and content without duplication.
- EC-8: An older card is expanded before the newest card is collapsed → both actions remain independent and no sequence is required.
- EC-9: The application version changes after a refresh → the new newest release becomes the sole initially expanded card.
- EC-10: All releases are expanded in a large history → every expanded card remains reachable through the modal's internal scroll and no artificial maximum silently closes another card.

## Markdown content

### US-003: Read complete, safe Markdown descriptions

**As a** Master Jobs user, **I want** release descriptions to preserve their
intended formatting, **so that** emphasis and structure help me understand each
change instead of exposing Markdown symbols or dropping text.

Acceptance criteria:

- AC-1: Given valid editorial Markdown, then paragraphs, headings, ordered and unordered lists, bold, italic, inline and fenced code, block quotes, thematic breaks, and links render with their intended semantic structure.
- AC-2: Given `**important text**` or equivalent valid emphasis, then the user sees emphasized text without literal delimiter characters.
- AC-3: Given a paragraph or list item wraps across multiple source lines, then every line remains part of the rendered content in the correct order.
- AC-4: Given raw HTML in a note, then it never executes or introduces arbitrary interface elements.
- AC-5: Given a link with a safe destination, then it is identifiable and operable; given an unsafe destination, then it does not become an actionable unsafe link.
- AC-6: Given Markdown content in any supported theme or viewport, then it uses product typography, spacing, colors, and wrapping without clipping or horizontal page overflow.

Edge cases:

- EC-1: Markdown is malformed or contains unmatched delimiters → the modal remains usable and presents readable text rather than crashing or dropping the whole release.
- EC-2: A Markdown block is blank → no empty heading, bullet, or unexplained gap is rendered.
- EC-3: A single word, URL, or code span exceeds the card width → it wraps or scrolls within its content boundary without widening the page.
- EC-4: Content includes scripts, event attributes, embedded HTML, or unsafe URL schemes → none execute, load privileged content, or become unsafe actions.
- EC-5: The same release content is rendered during simultaneous user sessions → every user sees the same reviewed source for the selected locale.
- EC-6: The user closes the modal midway through a long code block or list → closing remains immediate and reopening restores the release-state default without corrupting content.
- EC-7: The modal is reopened repeatedly → Markdown renders deterministically without duplicated paragraphs, list items, or formatting.
- EC-8: Nested lists, quotes, and paragraphs occur in sequence → their source order and nesting remain understandable rather than being flattened into unrelated lines.
- EC-9: A deployment replaces the source note while an old page is open → the open page remains coherent and a refresh obtains the complete new edition.
- EC-10: A release contains 100 times the typical note length → all content remains reachable within the modal and neither parsing nor presentation silently truncates it.

## Content localization

### US-004: Read notes in the active interface language

**As a** Master Jobs user, **I want** the entire What's New experience in my
active interface language, **so that** I do not have to interpret Portuguese
product notes while using the application in English or vice versa.

Acceptance criteria:

- AC-1: Given the active locale is `pt-BR`, then the modal controls, section labels, and release descriptions appear in Brazilian Portuguese.
- AC-2: Given the active locale is `en`, then the modal controls, section labels, and release descriptions appear in English.
- AC-3: Given a release is visible in both locales, then both editions describe the same user-visible changes even when phrasing is idiomatic rather than literal.
- AC-4: Given the locale changes through the existing language control, then the next modal opening uses the newly active locale consistently throughout.
- AC-5: Given existing historical releases are visible, then they follow the same bilingual contract as newly published releases.

Edge cases:

- EC-1: The active locale value is malformed or unsupported → the existing application locale fallback governs the entire modal; languages are not mixed within one rendering.
- EC-2: One locale edition is missing for a visible release → the product does not silently show the other language as though it were localized; the inconsistency is treated as invalid release content.
- EC-3: A translation is substantially longer than its counterpart → cards grow and wrap naturally without clipping, overlap, or horizontal page overflow.
- EC-4: A localized note accidentally contains technical internals or private data → it is not considered an acceptable user-facing edition merely because a translation exists.
- EC-5: Two users with different active locales open the same version concurrently → each receives the complete edition for their locale without altering the other's experience.
- EC-6: The locale changes while the modal is open through an external page or session event → the open modal stays internally consistent; the next normal locale-rendering cycle uses the new language.
- EC-7: The user alternates locales and reopens the modal → each opening uses one complete locale and the newest-only expansion default.
- EC-8: Locale editions list changes or sections in a different order → publication validation treats the mismatch as content drift rather than presenting contradictory histories.
- EC-9: A release is explicitly marked as having no user-visible change → it is absent from both localized histories rather than appearing in only one.
- EC-10: The bilingual history grows to 100 times its current size → each user receives only the active edition in the modal and can still scan and dismiss the history.

## Publication time

### US-005: See publication time in local time

**As a** Master Jobs user, **I want** each release's real publication instant
shown in my device's local timezone and my active language's format, **so that**
I can understand when a change became available without manually converting UTC.

Acceptance criteria:

- AC-1: Given a release has a trustworthy UTC publication instant, then the visible date and time represent that same instant converted to the device's local timezone.
- AC-2: Given active locale `pt-BR`, then a complete timestamp uses `dd/mm/yyyy HH:mm` with zero-padded values and a 24-hour clock.
- AC-3: Given active locale `en`, then a complete timestamp uses `mm/dd/yyyy HH:mm` with zero-padded values and a 24-hour clock.
- AC-4: Given a historical release has only a trustworthy calendar date and no recoverable instant, then the card displays only `dd/mm/yyyy` in Portuguese or `mm/dd/yyyy` in English.
- AC-5: Given reliable release evidence can recover a historical publication instant, then that instant follows the same local-time conversion and locale formatting as a new release.
- AC-6: Given a release lacks a trustworthy time, then the modal never appends a fabricated `00:00`, guesses a timezone, or displays an invented local day.

Edge cases:

- EC-1: A publication value is malformed or impossible → it is not formatted into a plausible but false date; the release remains readable without a fabricated timestamp.
- EC-2: A historical record has neither a trustworthy date nor instant → no empty time placeholder or invented date appears.
- EC-3: The local conversion crosses midnight, month end, year end, or a leap day → the displayed calendar date reflects the actual local instant.
- EC-4: Different account roles view the same release → timestamp visibility and precision do not vary by role or expose internal deployment metadata beyond the publication instant.
- EC-5: Two users in different device timezones view the same release concurrently → each sees a different local representation of the same UTC instant.
- EC-6: The device timezone changes while the rendered modal is open → the current display remains coherent; the next rendering reflects the device's current timezone.
- EC-7: The modal is opened repeatedly without locale or timezone changes → the timestamp remains stable and does not drift through repeated conversion.
- EC-8: Release source entries are out of order → display ordering follows the actual release sequence and does not use localized strings for chronological comparison.
- EC-9: A publication instant falls within a daylight-saving transition, repeated hour, or skipped hour → the display uses the timezone's valid local result for that instant.
- EC-10: Hundreds of releases share the same calendar date or minute → every card retains its own version identity and publication precision without deduplication.

## Release publishing

### US-006: Publish complete bilingual release information

**As a** release maintainer, **I want** publication to require complete,
equivalent localized notes and a trustworthy release instant, **so that** users
never receive a partial language experience or fabricated chronology.

Acceptance criteria:

- AC-1: Given a release has user-visible changes, when it is published, then equivalent Portuguese and English editions exist for that version.
- AC-2: Given a release has no user-visible changes, then both localized histories consistently omit it or mark it as non-visible without creating an empty card.
- AC-3: Given a new release is published, then its metadata preserves one unambiguous UTC publication instant suitable for local conversion.
- AC-4: Given one locale edition is missing or the locale histories disagree on visible versions, then publication does not present the release as complete to end users.
- AC-5: Given valid multiline editorial Markdown, then publication preserves the full blocks and their order rather than reducing notes to physical lines.
- AC-6: Given historical releases included in the modal, then reliable publication evidence is used where available and both locale editions cover the same visible history.
- AC-7: Given technical release notes contain implementation details, then those details do not automatically become user-facing content in either locale.

Edge cases:

- EC-1: A version, timestamp, locale identity, or Markdown document is malformed → publication rejects or isolates the invalid release instead of generating plausible but incorrect user content.
- EC-2: Either localized edition is blank or contains only empty sections → the release is not treated as a complete user-visible version.
- EC-3: A release note is exceptionally large → completeness checks do not silently truncate it, and maintainers receive a clear failure if a documented product limit is exceeded.
- EC-4: A person without release authority edits or supplies notes → those changes do not become a published user-facing release through the modal alone.
- EC-5: Two publication attempts for the same version run concurrently → users receive one coherent version and timestamp, not duplicated or mismatched locale cards.
- EC-6: Publication stops after one locale or one metadata artifact is prepared → users continue to receive the previous coherent history rather than a partial new release.
- EC-7: The same publication is retried after success → it remains idempotent and does not duplicate the version or alter its original publication instant.
- EC-8: Version metadata is prepared before both locale editions → the release does not become user-visible until all required user-facing information is coherent.
- EC-9: A published release later receives a corrected translation → both locale histories continue to identify the same version and publication instant while the corrected wording becomes visible together.
- EC-10: The release history grows to 100 times its current size → completeness checks still compare the full visible-version set across locales rather than only the newest entries.
