# Test Specification: What's New Modal Redesign

Canonical test contract for the redesigned What's New modal. Companion to
`_techspec.md`; derived from `_user_stories.md` behavior and the TechSpec
components.

## Strategy

- **Frameworks and harnesses**: Vitest covers pure domain functions, release
  preparation, and static React Markdown output. Existing isolated Playwright
  E2E covers the built Next.js application, temporary SQLite database, temporary
  port, themes, locales, browser timezone, accessibility, and real layout.
- **Fixtures**: parser tests use inline Markdown; release-shell integration uses
  a temporary directory containing `package.json`, `CHANGELOG.md`, and both
  localized user changelogs; repository-coherence tests read the real files.
  Fakes exist only at clock, filesystem, Git process, and browser boundaries.
- **Execution**: targeted tests run with `pnpm vitest run tests/changelog.test.ts
  tests/release.test.ts`; the repository gate is `pnpm check`; public UI cases
  run through `pnpm test:e2e`.
- **Conventions**: unit cases name their class, pure functions receive concrete
  values, date tests inject IANA timezones, and E2E locates controls by test ID or
  accessible role rather than translated text.

## Coverage Matrix

### User stories and edge cases

| Source | Behavior | Unit | Integration | E2E |
| --- | --- | --- | --- | --- |
| US-001 | Open and scan the modal | UT-044, UT-049 | IT-011, IT-015 | E2E-001, E2E-002, E2E-003, E2E-004, E2E-021, E2E-022 |
| US-001.EC-1 | Malformed version is isolated | UT-005 | — | E2E-026 |
| US-001.EC-2 | No valid releases means no broken modal | UT-008, UT-048 | — | E2E-026 |
| US-001.EC-3 | Long version/header content reflows | — | — | E2E-019 |
| US-001.EC-4 | Changelog adds no private/technical leak | — | IT-002, IT-010 | E2E-023 |
| US-001.EC-5 | Rapid duplicate open does not duplicate dialog | UT-044 | — | E2E-024 |
| US-001.EC-6 | Already loaded modal works after network loss | — | — | E2E-024 |
| US-001.EC-7 | Repeated open/close remains deterministic | UT-047 | — | E2E-008, E2E-024 |
| US-001.EC-8 | Source order cannot override semantic version order | UT-009 | IT-001 | — |
| US-001.EC-9 | One rendered deployment stays coherent | — | IT-001, IT-011 | E2E-025 |
| US-001.EC-10 | Large history remains contained | — | — | E2E-020 |
| US-002 | Expand multiple releases independently | UT-044–UT-047 | — | E2E-005–E2E-009 |
| US-002.EC-1 | Missing controlled content does not affect siblings | UT-011, UT-049 | — | E2E-026 |
| US-002.EC-2 | Empty release does not expose empty region | UT-011 | IT-001 | E2E-026 |
| US-002.EC-3 | Long expanded release keeps close reachable | — | — | E2E-020 |
| US-002.EC-4 | Roles receive identical disclosure behavior | — | — | E2E-023 |
| US-002.EC-5 | Rapid repeated toggle ends in announced final state | UT-045, UT-046 | — | E2E-024 |
| US-002.EC-6 | Closing several open cards clears state | UT-047 | — | E2E-008 |
| US-002.EC-7 | Repeated toggle does not duplicate content | UT-045, UT-046 | — | E2E-007 |
| US-002.EC-8 | Toggle order is irrelevant | UT-045, UT-046 | — | E2E-006, E2E-007 |
| US-002.EC-9 | New newest version becomes initial expansion | UT-044 | IT-001 | E2E-005 |
| US-002.EC-10 | All releases may remain open | UT-045 | — | E2E-020 |
| US-003 | Render complete safe Markdown | UT-003, UT-004, UT-037, UT-038, UT-039, UT-040, UT-041, UT-042, UT-043 | IT-004 | E2E-010, E2E-011 |
| US-003.EC-1 | Malformed Markdown remains readable | UT-043 | — | E2E-010 |
| US-003.EC-2 | Blank block creates no empty UI | UT-011 | IT-001 | E2E-026 |
| US-003.EC-3 | Long word/URL cannot widen page | — | — | E2E-019, E2E-020 |
| US-003.EC-4 | HTML and unsafe schemes are inert | UT-040, UT-041 | IT-004 | E2E-011 |
| US-003.EC-5 | Same reviewed source renders deterministically | UT-042 | IT-001 | E2E-010 |
| US-003.EC-6 | Closing during long content remains immediate | UT-047 | — | E2E-008, E2E-020 |
| US-003.EC-7 | Reopening does not duplicate Markdown | UT-042 | — | E2E-024 |
| US-003.EC-8 | Nested block order remains intact | UT-003, UT-042 | — | E2E-010 |
| US-003.EC-9 | Deployment does not mix source editions | — | IT-011 | E2E-025 |
| US-003.EC-10 | Very large note remains reachable | — | — | E2E-020 |
| US-004 | Active locale selects the complete edition | UT-050 | IT-001, IT-012 | E2E-012, E2E-013, E2E-018 |
| US-004.EC-1 | Unsupported locale follows application fallback | — | IT-012 | E2E-018 |
| US-004.EC-2 | Missing locale edition cannot silently fall back | UT-014 | IT-006 | E2E-026 |
| US-004.EC-3 | Long translation wraps safely | — | — | E2E-019 |
| US-004.EC-4 | Localized notes contain no technical/private leak | — | IT-002, IT-010 | — |
| US-004.EC-5 | Concurrent locales do not affect each other | UT-050 | IT-001 | E2E-012, E2E-013 |
| US-004.EC-6 | Locale change produces one coherent next rendering | — | IT-012 | E2E-018 |
| US-004.EC-7 | Alternating locales never mixes editions | UT-050 | IT-001 | E2E-018 |
| US-004.EC-8 | Version/order drift fails structural validation | UT-014, UT-016 | IT-006 | — |
| US-004.EC-9 | No-user-change state is symmetric | UT-018, UT-019, UT-029 | IT-009 | — |
| US-004.EC-10 | Only active edition is sent at scale | UT-050 | IT-015 | E2E-020 |
| US-005 | Show truthful local publication value | UT-001, UT-002, UT-030, UT-031, UT-032, UT-033, UT-034, UT-035, UT-036 | IT-013 | E2E-014, E2E-015, E2E-016, E2E-017 |
| US-005.EC-1 | Malformed publication never becomes plausible | UT-006, UT-007, UT-036 | — | E2E-026 |
| US-005.EC-2 | No trustworthy publication shows no placeholder | UT-036 | — | E2E-026 |
| US-005.EC-3 | Calendar boundaries convert correctly | UT-034 | — | E2E-016 |
| US-005.EC-4 | Timestamp precision is role-independent | — | — | E2E-023 |
| US-005.EC-5 | Different device zones show one instant locally | UT-030, UT-031 | — | E2E-014–E2E-016 |
| US-005.EC-6 | Next render observes changed device timezone | UT-030 | — | E2E-016 |
| US-005.EC-7 | Repeated formatting does not drift | UT-030, UT-031 | — | E2E-024 |
| US-005.EC-8 | Localized strings never determine ordering | UT-009 | IT-001 | — |
| US-005.EC-9 | DST transition uses the valid local result | UT-035 | — | E2E-016 |
| US-005.EC-10 | Equal date/minute does not deduplicate versions | UT-010 | IT-001 | — |
| US-006 | Publish coherent bilingual release metadata | UT-013, UT-015, UT-020, UT-021, UT-022, UT-023, UT-024, UT-025, UT-026, UT-027, UT-028, UT-029 | IT-005–IT-010, IT-014 | — |
| US-006.EC-1 | Malformed release input fails before publication | UT-022–UT-024 | IT-006 | — |
| US-006.EC-2 | Blank locale edition is incomplete | UT-017 | IT-006 | — |
| US-006.EC-3 | Large source is not silently truncated | UT-003 | IT-005 | — |
| US-006.EC-4 | Modal cannot publish content | — | IT-014 | E2E-023 |
| US-006.EC-5 | Concurrent/repeated target cannot duplicate version | UT-025–UT-028 | IT-007, IT-008 | — |
| US-006.EC-6 | Interrupted preparation exposes no partial release | UT-022–UT-024 | IT-006, IT-008 | — |
| US-006.EC-7 | Retry preserves the original instant | UT-025, UT-028 | IT-007 | — |
| US-006.EC-8 | Metadata cannot publish before both locales | UT-014, UT-017 | IT-006 | — |
| US-006.EC-9 | Translation correction preserves identity/time | UT-013, UT-028 | IT-001 | — |
| US-006.EC-10 | Parity compares complete history | UT-013–UT-019 | IT-001 | — |

### Technical components and interfaces

| Source | Responsibility | Unit | Integration | E2E |
| --- | --- | --- | --- | --- |
| `parseUserChangelog` | Full-body parse, issues, ordering | UT-001–UT-012 | IT-001, IT-002 | E2E-026 |
| `validateLocalizedChangelogs` | Locale version/publication parity | UT-013–UT-019 | IT-001, IT-006, IT-009 | — |
| `prepareRelease` | Coherent stamp and idempotency | UT-020–UT-029 | IT-005–IT-009 | — |
| `formatPublication` | Exact locale and timezone output | UT-030–UT-036 | — | E2E-014–E2E-017 |
| Markdown URL/renderer | Safe semantic React output | UT-037–UT-043 | IT-004 | E2E-010, E2E-011 |
| Modal state/dialog | Open lifecycle and disclosures | UT-044–UT-049 | IT-015 | E2E-001–E2E-009 |
| Locale file selector | Total locale-to-file mapping | UT-050 | IT-001, IT-011, IT-012 | E2E-012, E2E-013 |
| Runtime diagnostics | Useful errors without prose leakage | UT-051 | IT-002 | E2E-025 |
| `versaoAtual` | Current-version fallback contract | UT-052 | IT-001 | E2E-001 |
| `versionar.ts` shell | Clock/files/Git wiring | — | IT-005–IT-009, IT-014 | — |
| Next.js standalone tracing | Ships both runtime files | — | IT-003, IT-011 | E2E-012, E2E-013 |

## Unit Tests

### Changelog parser (TechSpec: Changelog Parsing and Ordering)

- **UT-001** (happy): `parseUserChangelog` receives `## [1.2.0] - 2026-08-22T11:46:00.000Z` and returns version `1.2.0` with `publication={kind:"instant",value:"2026-08-22T11:46:00.000Z"}`.
- **UT-002** (happy): the parser receives `## [1.1.0] - 2026-08-21` and returns `publication={kind:"date",value:"2026-08-21"}` without constructing an instant.
- **UT-003** (boundary): wrapped text, a linked level-two heading, fenced code, and header/omission examples inside that fence remain byte-for-byte inside one release's returned `markdown` body.
- **UT-004** (ordering): two actual version headers delimit two complete bodies; the first body contains no bytes from the second and ordinary level-two headings do not delimit releases.
- **UT-005** (error): header `## [v1.2] - 2026-08-22` or the missing-bracket form `## 1.2.0 - 2026-08-22` produces `invalid_version`, excludes that entry, and preserves the following valid release.
- **UT-006** (error): dates `2026-02-30` and `2026-13-01` produce `invalid_publication` and no fabricated release date.
- **UT-007** (error): timestamp `2026-08-22T11:46:00-03:00` produces `invalid_publication` because canonical stored instants must end in `Z`.
- **UT-008** (boundary): empty input and a title-only document return `releases=[]` without throwing.
- **UT-009** (ordering): source versions `1.2.0`, `2.0.0`, `1.10.0` return in numeric order `2.0.0`, `1.10.0`, `1.2.0`, and distinct arbitrary-length numeric components retain exact ordering beyond `Number.MAX_SAFE_INTEGER`.
- **UT-010** (error): duplicate `1.2.0` headers produce `duplicate_version` and only one normal release identity.
- **UT-011** (error): a valid version header with whitespace/comments but no user content produces `empty_body` and no visible release.
- **UT-012** (state): a populated `## [Unreleased]` section is excluded from runtime releases and preserved for release preparation.

### Locale parity validator (TechSpec: Changelog Parsing and Ordering)

- **UT-013** (happy): Portuguese and English parses with versions `1.2.0`, `1.1.0` and identical publication metadata pass validation despite different prose.
- **UT-014** (error): English missing `1.1.0` throws `localized_version_mismatch` naming only the missing version and locale.
- **UT-015** (error): `instant` in Portuguese versus `date` in English for `1.1.0` throws `localized_publication_mismatch`.
- **UT-016** (error): different UTC instant values for the same version throw `localized_publication_mismatch`.
- **UT-017** (error): one locale's visible release body is blank while the counterpart is populated throws `localized_content_missing`.
- **UT-018** (happy): both locale sources consistently mark a release as having no user-visible change and omit it from visible parity.
- **UT-019** (error): a no-user-change marker in one locale paired with a visible version in the other throws `localized_visibility_mismatch`.

### Release preparation (TechSpec: Release Preparation and Idempotency)

- **UT-020** (happy): `prepareRelease` given version `1.2.0`, `publishedAt=2026-08-22T11:46:00.000Z`, and three valid `Unreleased` sections returns all three stamped documents.
- **UT-021** (state): the prepared technical header contains `2026-08-22`, while both localized headers contain the exact full value `2026-08-22T11:46:00.000Z`.
- **UT-022** (error): any required document with zero `Unreleased` sections throws `missing_unreleased` before returning outputs.
- **UT-023** (error): any required document with two `Unreleased` sections throws `duplicate_unreleased`.
- **UT-024** (error): a localized candidate output with malformed version/publication metadata throws its strict domain error instead of returning partial output.
- **UT-025** (idempotency): coherent inputs already containing target `1.2.0` in all documents return the `already-released` result without changing any bytes.
- **UT-026** (error): target `1.2.0` present only in the technical document throws `partial_existing_release`.
- **UT-027** (state): one captured `Date` produces identical UTC instant bytes in Portuguese and English outputs.
- **UT-028** (idempotency): retry with a later injected clock preserves the original `1.2.0` timestamp rather than overwriting it.
- **UT-029** (state): matching no-user-change `Unreleased` sources publish no empty user card in either locale while the technical release still advances.

### Publication formatter (TechSpec: Local Publication Formatting)

- **UT-030** (happy): instant `2026-08-22T11:46:00.000Z`, locale `pt-BR`, timezone `America/Sao_Paulo` returns exactly `22/08/2026 08:46`.
- **UT-031** (happy): the same instant, locale `en`, timezone `America/Sao_Paulo` returns exactly `08/22/2026 08:46`.
- **UT-032** (happy): date `{kind:"date",value:"2026-08-21"}` with `pt-BR` returns exactly `21/08/2026`.
- **UT-033** (happy): the same date with `en` returns exactly `08/21/2026`.
- **UT-034** (boundary): `2027-01-01T01:30:00.000Z` in `America/Sao_Paulo` returns calendar day `31/12/2026` for `pt-BR`.
- **UT-035** (boundary): instants on both sides of a documented `America/New_York` DST transition return the `Intl`-defined local hour with `h23` formatting.
- **UT-036** (error): an impossible date or non-UTC instant passed through an unsafe cast returns `null`, not a formatted fallback.

### Safe Markdown renderer (TechSpec: Markdown Rendering)

- **UT-037** (happy): `safeChangelogUrl("https://example.com/a")` and the HTTP equivalent return unchanged.
- **UT-038** (happy): relative paths `/jobs/1`, `./details`, and `#section` remain actionable.
- **UT-039** (happy): `mailto:person@example.com` remains actionable.
- **UT-040** (error): `javascript:`, `data:`, `file:`, `vbscript:`, and malformed destinations return an empty destination.
- **UT-041** (error): static rendering of `<script>alert(1)</script>` shows no script element and never interprets the source as HTML.
- **UT-042** (happy): one fixture containing paragraph, headings, ordered/unordered lists, strong, emphasis, inline/fenced code, quote, rule, and safe link renders the corresponding semantic elements with mapped classes.
- **UT-043** (boundary): unmatched emphasis and an incomplete fence render readable text without throwing or dropping the release body.

### Modal state and identifiers (TechSpec: Client Modal State)

- **UT-044** (state): `initialExpanded(["1.2.0","1.1.0"])` returns only `1.2.0`.
- **UT-045** (state): toggling collapsed `1.1.0` adds it while preserving expanded `1.2.0`.
- **UT-046** (state): toggling expanded `1.2.0` removes only it and preserves `1.1.0`.
- **UT-047** (state): close followed by open replaces any prior set with newest-only state.
- **UT-048** (boundary): initial state for `[]` is empty and does not create an invalid identifier.
- **UT-049** (happy): version `1.2.0` maps deterministically to distinct header/content IDs without unsafe characters.

### Locale loader and diagnostics

- **UT-050** (happy): the locale selector maps only `pt-BR` to `USER_CHANGELOG.pt-BR.md` and `en` to `USER_CHANGELOG.en.md`, returning no arbitrary path for an unsafe cast.
- **UT-051** (error): formatting an `invalid_publication` diagnostic includes issue code, locale, and version token but excludes the Markdown body and surrounding source text; invalid release/package versions are also control-free and bounded before reaching workflow logs.
- **UT-052** (boundary): `versaoAtual` returns a non-empty package version and falls back to `0.0.0` for absent, blank, null, and non-string values.

## Integration Tests

### Canonical localized content

- **IT-001**: parse both real localized files, validate parity, and compare the current package version's disposition; expect no issues, equal visible metadata, and the package version either visible in both locales or explicitly omitted in both.
- **IT-002**: inspect the complete real Markdown bodies for both locales; expect none of `src/`, `app/`, `.ts`, `libsql://`, `auth_user`, `job_score`, `TURSO_`, or `process.env` in user-facing release content.
- **IT-003**: read real `next.config.ts`; expect output tracing to include both localized paths and no reference to the deprecated single path.
- **IT-004**: inspect production dependencies and statically render hostile Markdown; expect `react-markdown` declared, no raw-HTML plugin declared, no script or image element, and no actionable unsafe protocol or same-origin request vector.

### Release pipeline boundary

- **IT-005**: in a temporary release fixture, run preparation/wiring for `1.2.0` at `2026-08-22T11:46:00.000Z`; expect technical date, identical localized instants, updated package version, and preserved multiline bodies.
- **IT-006**: remove or blank the English `Unreleased` content in a temporary fixture and run the release command; expect non-zero exit and all fixture files byte-identical to their pre-run state.
- **IT-007**: run the same successful temporary release command twice with different clocks; expect one `1.2.0` entry and the original instant after the second run.
- **IT-008**: seed a temporary fixture with `1.2.0` in only one document; expect `partial_existing_release`, non-zero exit, and no additional writes.
- **IT-009**: prepare matching no-user-change locale fixtures; expect no visible `1.2.0` user release in either parse and a valid technical/package advance.
- **IT-010**: seed implementation terms only in technical `CHANGELOG.md`; expect release preparation to preserve them there and never copy them into either localized document.

### Next.js and workflow wiring

- **IT-011**: build the standalone application and inspect traced output; expect both locale Markdown files present at their runtime paths and the footer loader able to read each.
- **IT-012**: typecheck the Portuguese and English changelog label dictionaries and exercise existing locale normalization; expect identical key contracts and the existing fallback for unsupported locale input.
- **IT-013**: inspect real historical headers plus available tag metadata; expect a historical value to remain `kind:"date"` unless checked-in evidence records the actual version-creation instant.
- **IT-014**: inspect the exact release staging commands in both version-authority workflows and the release shell file lists; expect both locale files and the technical changelog included wherever release outputs are staged or validated.
- **IT-015**: build/typecheck the Server-to-Client boundary; expect `ChangelogModalProps` to contain only serializable strings, arrays, and discriminated records, with no translator or filesystem function.

## End-to-End Tests

### Modal lifecycle and release comparison (US-001, US-002)

- **E2E-001**: activate the footer trigger → native modal dialog opens → localized title and current `v<package.version>` badge are visible without navigation.
- **E2E-002**: open dialog → activate visible close button → dialog closes and focus returns to the footer trigger.
- **E2E-003**: open dialog → press Escape → dialog closes and focus returns to the trigger.
- **E2E-004**: open dialog → click the rendered backdrop outside its panel → dialog closes; clicking inside the panel does not close it.
- **E2E-005**: open a fixture with at least three releases → exactly the newest card has `aria-expanded=true`.
- **E2E-006**: expand two older releases → all three selected cards remain expanded and their content is visible.
- **E2E-007**: collapse the middle expanded release → newest and oldest remain open and no content is duplicated.
- **E2E-008**: open multiple cards → close modal → reopen → only the newest card is expanded.
- **E2E-009**: focus each card header and use Enter/Space → `aria-expanded`, `aria-controls`, controlled-region visibility, and decorative chevron state stay synchronized.

### Markdown security and semantics (US-003)

- **E2E-010**: open the Markdown fixture release → paragraphs, headings, lists, bold, italic, inline/fenced code, quote, rule, and safe link are semantic elements; literal `**` is absent from bold text and wrapped source lines are complete.
- **E2E-011**: open hostile Markdown fixture → no script executes, no raw HTML or image element appears, `javascript:`/`data:` links are not actionable, and no authenticated same-origin request is issued from hostile Markdown.

### Locale and publication display (US-004, US-005)

- **E2E-012**: use `pt-BR` → open modal → controls, headings, and release prose are Portuguese with no English-edition body mixed in.
- **E2E-013**: use `en` → open modal → controls, headings, and release prose are English with no Portuguese-edition body mixed in.
- **E2E-014**: set browser timezone `America/Sao_Paulo`, locale `pt-BR`, and instant `2026-08-22T11:46:00.000Z` → card shows exactly `22/08/2026 08:46`.
- **E2E-015**: use the same timezone/instant with locale `en` → card shows exactly `08/22/2026 08:46`.
- **E2E-016**: render one instant under two browser timezone overrides, including a day or DST boundary → each display matches that zone and retains one ISO `dateTime` value.
- **E2E-017**: render historical date-only `2026-08-21` in both locales → cards show `21/08/2026` and `08/21/2026` without time or day drift.
- **E2E-018**: switch locale through the existing control and reopen → the entire modal uses the new edition and newest-only expansion state.

### Responsive, themed, authorized, and failure behavior

- **E2E-019**: at 375 px with an unusually long semantic-version token, long safe link, and long fenced-code line → no page horizontal overflow, temporal text retains its exact fixed-width locale format, card header controls remain reachable, and content wraps or scrolls only within permitted boundaries.
- **E2E-020**: use a 100-release/long-body fixture → modal header remains visible, body scroll remains internal, close remains reachable, and all releases can be expanded without forced closure.
- **E2E-021**: render the modal in HP, Huly, and Graphy light/dark combinations → computed release text/control contrast meets the repository thresholds and no component color bypasses semantic tokens.
- **E2E-022**: with keyboard-only navigation and browser zoom → focus remains inside the open modal, every control is reachable, and no zoom level hides the close action or release content.
- **E2E-023**: candidate, recruiter, administrator, and impersonated sessions open the same build → release identities, content, precision, and disclosure capabilities are identical and contain no private record data.
- **E2E-024**: after initial page load, go offline and rapidly repeat open/close/toggle actions → rendered content remains readable, one dialog exists, and final visible/announced states agree.
- **E2E-025**: open and interact in both locales/timezones while collecting browser console output → no hydration mismatch, React key warning, uncaught exception, or failed runtime changelog fetch occurs.
- **E2E-026**: build with one malformed release plus one valid release, then with no valid releases, then remove the active localized file from the standalone artifact → the first run isolates the malformed entry and shows the valid card; the latter runs keep the page available and omit the What's New trigger instead of opening an empty or broken dialog.
