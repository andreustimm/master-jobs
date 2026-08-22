# Technical Specification: What's New Modal Redesign

## Executive Summary

The redesign keeps the existing server-first changelog boundary while adding a
small client island for the behavior that only a browser can supply. The root
layout resolves the active locale; `app/footer.tsx` reads and parses only that
locale's canonical Markdown file; and `app/changelog-modal.tsx` owns native
dialog lifecycle, independent expansion state, focus restoration, and
device-local timestamp formatting. The rest of the application remains a Server
Component tree.

The content pipeline moves from one Portuguese line parser to two canonical
locale documents, complete-version-body parsing, structural parity validation,
and safe `react-markdown` rendering. Release creation captures one UTC instant
during `dev → staging`, stamps both user changelogs with that same value, and
keeps date-only history explicitly distinct. The main trade-offs are one small
hydrated global component, a production Markdown dependency, and mandatory
bilingual editorial maintenance in exchange for exact interaction, security,
and localization behavior.

## System Architecture

### Component Overview

1. **Localized changelog files** — `USER_CHANGELOG.pt-BR.md` and
   `USER_CHANGELOG.en.md` are the two canonical user-facing editorial sources.
   They share visible version identifiers and publication metadata but contain
   idiomatic locale-specific prose.
2. **Changelog domain** — `src/core/changelog.ts` parses complete version bodies,
   models publication precision, orders valid semantic versions, reports
   isolated malformed entries, and validates cross-locale parity. It performs
   no disk, React, clock, or network work.
3. **Release domain** — `src/core/release.ts` prepares one coherent release from
   the technical changelog and two localized user changelogs. It validates all
   inputs before returning transformed outputs and preserves idempotency.
4. **Release shell** — `scripts/release/versionar.ts` reads Git and files,
   captures one UTC instant, invokes the pure release domain, writes returned
   outputs, and performs the existing final consistency check.
5. **Footer server adapter** — `app/footer.tsx` selects the active locale file,
   reads it at runtime, parses it, resolves typed labels, and passes serializable
   data to the modal. Missing or unreadable active content removes the trigger
   rather than opening an empty modal or falling back to another language.
6. **What's New client modal** — `app/changelog-modal.tsx` renders the footer
   trigger and native `<dialog>`, initializes the newest-only expansion set on
   every `showModal()`, toggles release cards independently, manages dismissal
   and focus, and delegates content and publication rendering.
7. **Markdown adapter** — `app/changelog-markdown.tsx` wraps `react-markdown`,
   omits raw-HTML support, restricts link destinations, and maps supported
   elements to semantic design-system styling.
8. **Publication formatter** — a pure helper in `src/core/changelog.ts` or a
   focused adjacent module assembles exact locale output from
   `Intl.DateTimeFormat.formatToParts`. The client supplies the device timezone
   implicitly; unit tests inject an explicit timezone.
9. **Build tracing and tests** — `next.config.ts` traces both locale files.
   Vitest covers pure contracts and rendered Markdown; the existing isolated
   Playwright harness covers dialog behavior, locale/timezone, themes, mobile,
   and accessibility.

### Data Flow

**Render path:** root locale resolution → `Footer(locale, labels)` → read one
localized Markdown file → `parseUserChangelog` → serializable `UserRelease[]` →
`ChangelogModal` → client expansion and local-time formatting →
`ChangelogMarkdown`.

**Release path:** commit classification → next version → capture one `Date` →
read `CHANGELOG.md` and both localized documents → strict parity/precondition
validation → prepare all transformed contents → write files and package version
→ final consistency check → workflow commit/tag.

### Story-to-Component Mapping

| Story | Primary components | Supporting components |
| --- | --- | --- |
| US-001 | `ChangelogModal`, `Footer` | design tokens, Playwright UI harness |
| US-002 | `ChangelogModal`, expansion-state helpers | native dialog and disclosure semantics |
| US-003 | `ChangelogMarkdown`, complete-body parser | safe URL transform, theme styles |
| US-004 | locale file selector, localized Markdown files | typed i18n labels, parity validator |
| US-005 | `Publication`, local publication formatter | client modal, historical parser |
| US-006 | release preparation domain, `versionar.ts` | parity validator, output tracing, real-file tests |

## Implementation Design

### Core Interfaces

The changelog parser exposes precision and parse issues explicitly:

```ts
export type Publication =
  | { kind: "instant"; value: string }
  | { kind: "date"; value: string };

export type UserRelease = {
  version: string;
  publication: Publication;
  markdown: string;
};

export type ChangelogParseResult = {
  releases: UserRelease[];
  issues: ChangelogIssue[];
};
```

The pure parser and parity gate form the canonical content contract:

```ts
export function parseUserChangelog(
  markdown: string,
): ChangelogParseResult;

export function validateLocalizedChangelogs(
  ptBR: ChangelogParseResult,
  en: ChangelogParseResult,
): void;

export function formatPublication(
  publication: Publication,
  locale: "pt-BR" | "en",
  timeZone?: string,
): string | null;
```

Release preparation validates before returning any output:

```ts
export type ReleaseDocuments = {
  technical: string;
  ptBR: string;
  en: string;
};

export function prepareRelease(input: {
  documents: ReleaseDocuments;
  version: string;
  publishedAt: Date;
}): ReleaseDocuments;
```

The Client Component receives only values that cross the React server/client
boundary safely:

```ts
export type ChangelogModalProps = {
  currentVersion: string;
  locale: "pt-BR" | "en";
  releases: UserRelease[];
  labels: {
    open: string;
    title: string;
    close: string;
  };
};
```

### Error Conventions

- Runtime parsing is tolerant at the release-entry boundary. It returns valid
  releases plus typed issues such as `invalid_version`, `invalid_publication`,
  `duplicate_version`, and `empty_body`; one bad entry cannot break the footer.
- If no valid releases remain, `Footer` renders only the application version and
  omits the What's New trigger.
- Release preparation is strict. Any parse issue, missing locale version,
  publication mismatch, blank visible release, or partial pre-existing target
  version throws a domain error before transformed outputs are written.
- Runtime server warnings contain only issue code, locale, and version token.
  They never log release prose, user data, secrets, or technical changelog text.
- `formatPublication` returns `null` for invalid data that bypasses parsing; it
  never returns a plausible fallback date.

### Data Models

#### Publication

- `instant` accepts a valid ISO-8601 UTC value ending in `Z`. New release values
  come from one `Date.toISOString()` call and include seconds and milliseconds,
  although display omits both.
- `date` accepts an exact valid Gregorian `YYYY-MM-DD` token and never enters a
  JavaScript `Date` timezone conversion.

#### UserRelease

- `version` is a normalized `MAJOR.MINOR.PATCH` value without the display `v`.
- `publication` preserves source precision.
- `markdown` is the complete source slice between the version header and the
  next level-two version header, trimmed only at outer boundaries. Internal line
  breaks, indentation, and block order remain intact.

#### ChangelogIssue

`ChangelogIssue` contains a stable code, optional source line, and optional
version token. It is diagnostic metadata only and never crosses to the client.

#### Source Header Grammar

Localized files retain the current human-readable convention:

```markdown
## [1.2.0] - 2026-08-22T18:42:10.123Z
```

Historical date-only entries remain valid:

```markdown
## [1.1.0] - 2026-08-21
```

`## [Unreleased]` remains the only publication placeholder. Comments marking a
release as having no user-visible change remain editorial metadata and must be
consistent in both locale documents.

### Changelog Parsing and Ordering

The parser scans level-two headers rather than list-item lines. For every valid
version header, it captures the untouched body until the next level-two header.
It validates publication shape and actual calendar validity, excludes blank or
malformed releases with a typed issue, and deduplicates by normalized version.
Valid releases sort by numeric semantic-version parts, newest first; localized
display strings never participate in ordering.

The strict parity validator compares the visible normalized version sequence,
publication kind, and publication value across both locales. It also rejects a
visible release that has a blank body in either locale. Semantic translation
equivalence remains a human review responsibility because code cannot prove two
different languages mean the same thing.

### Markdown Rendering

`ChangelogMarkdown` passes each complete body to `react-markdown`. No
`rehype-raw` or equivalent raw-HTML plugin is installed. Component mappings
cover paragraphs, `h1`–`h6`, ordered and unordered lists, list items, strong,
emphasis, inline code, fenced code, block quotes, thematic breaks, and anchors.
They use only semantic theme tokens, existing type classes, and design-system
spacing/radii.

The URL transform accepts relative application URLs and the explicit schemes
`http:`, `https:`, and `mailto:`. It returns an empty destination for malformed
URLs and protocols such as `javascript:`, `data:`, `file:`, and `vbscript:`.
Code blocks may scroll within their own boundary; no Markdown element may widen
the dialog or page.

### Client Modal State

`ChangelogModal` holds a dialog ref, trigger ref, and `Set<string>` of expanded
versions. `openModal()` replaces the set with the first release version and then
calls `showModal()`. `closeModal()` calls `close()`. The dialog `close` handler
clears state and returns focus to the trigger. The `cancel` event permits Escape
and follows the same reset path. A pointer event whose target is the dialog
backdrop closes it; events inside the dialog do not.

Each card header is a real button with `aria-expanded` and `aria-controls`.
Content uses a stable version-derived ID and the `hidden` attribute while
collapsed. The chevron is decorative. State updates clone the `Set`, toggle only
the selected version, and impose no cardinality limit.

The dialog has `aria-labelledby`, a visible close button, and an initial focus
target. Native `showModal()` supplies top-layer placement and background
inertness. The card collection owns vertical scrolling; the header remains
sticky. The implementation follows existing tokens and explicit responsive
widths, never Tailwind size aliases prohibited by the repository.

### Local Publication Formatting

Instant formatting runs only in the client after hydration. The modal is closed
until the hydrated trigger can call `showModal()`, so no visible server-timezone
placeholder is needed. The `<time>` element retains the ISO UTC value in
`dateTime`; its text is assembled from `Intl.DateTimeFormat.formatToParts` with
`hourCycle: "h23"`, two-digit date/time fields, the active locale, and no
production `timeZone` override. This yields exact `dd/mm/yyyy HH:mm` or
`mm/dd/yyyy HH:mm` output without locale-added punctuation.

Date-only values are split and validated as calendar components, then reordered
for the active locale. They never pass through `Date`, preventing local-day
drift. Tests pass explicit IANA timezone names to the pure formatter to cover
boundaries deterministically.

### Localized File Selection

The existing root locale is passed from `app/layout.tsx` to `Footer` alongside
the translator. A total locale-to-file map selects either
`USER_CHANGELOG.pt-BR.md` or `USER_CHANGELOG.en.md`; it does not accept arbitrary
paths. Footer resolves the small label object before the client boundary. Both
files are declared in `next.config.ts.outputFileTracingIncludes`.

### Release Preparation and Idempotency

`versionar.ts` captures `const publishedAt = new Date()` exactly once after it
has selected a bump and before preparation. `prepareRelease`:

1. parses all three documents and checks exactly one `Unreleased` section where required;
2. validates both locale documents are structurally publishable;
3. stamps the technical changelog with the UTC date and both user changelogs with the same full ISO UTC instant;
4. parses the candidate outputs and validates locale version/publication parity;
5. returns all strings only after every check passes.

The shell updates files and `package.json` only from that successful result. If
the target version already exists coherently in the package and all three
documents, the rerun reports `already-released` without modifying timestamp or
content. If it exists in only a subset or metadata differs, the operation fails
instead of declaring success. Workflow publication continues only after the
script exits successfully, so a failed local write cannot reach users.

### Historical Migration

The existing `USER_CHANGELOG.md` is renamed to the Portuguese locale file and
translated into the English locale file without changing user-visible meaning.
The current lightweight tags do not contain tagger timestamps. Historical
release commit times may inform an evidence audit, but they are not
automatically treated as tag-creation instants. Each existing release remains
date-only unless workflow or hosting evidence proves its actual version-creation
instant; any proven instant is normalized to UTC and copied identically to both
locale headers.

### API Endpoints

No API endpoint is added. Changelog content remains a server-side file adapter,
and interaction remains local to the rendered page. Adding a fetch route would
create an unnecessary public surface and a duplicate authorization boundary.

## Integration Points

There is no new runtime external service. The design integrates only with the
existing Git/release workflow and Next.js standalone output:

- **Git and release workflow** — the serialized `dev → staging` job remains the
  version-creation authority. Existing workflow credentials and retry behavior
  remain unchanged.
- **Next.js output tracing** — both localized Markdown files must ship with the
  runtime because `Footer` reads them by a computed path.
- **Browser platform** — native dialog, `Intl.DateTimeFormat`, and device
  timezone are required. Supported browsers are the same browsers already
  accepted by the application and Playwright suite.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `USER_CHANGELOG.md` | deprecated/renamed | Existing Portuguese source path disappears | Rename to locale-specific path and update references |
| `USER_CHANGELOG.pt-BR.md` | new | Canonical Portuguese user history | Preserve and migrate current content |
| `USER_CHANGELOG.en.md` | new | Canonical English user history | Add reviewed equivalent history |
| `src/core/changelog.ts` | modified | Parser contract changes from line items to complete bodies; medium compatibility risk | Add discriminated publication model, issues, ordering, parity, formatter |
| `src/core/release.ts` | modified | Release transform becomes multi-document; high release-pipeline risk | Add atomic preparation and coherent retry rules |
| `scripts/release/versionar.ts` | modified | Captures full UTC instant and writes two locale files; high workflow risk | Wire pure preparation and final validation |
| `app/footer.tsx` | modified | Becomes server adapter for a serializable client boundary | Pass locale, labels, current version, releases |
| `app/changelog-modal.tsx` | new | Owns dialog lifecycle, disclosure state, local time | Implement narrow Client Component |
| `app/changelog-markdown.tsx` | new | Security-sensitive Markdown presentation | Use `react-markdown`, safe URL transform, semantic tokens |
| `app/layout.tsx` | modified | Supplies locale to footer | Extend footer props without duplicating locale resolution |
| i18n dictionaries | modified | Disclosure/accessibility labels may be added | Add keys first to Portuguese contract, then English |
| `next.config.ts` | modified | Computed runtime files must be traced | Replace old path with both locale files |
| `package.json` / lockfile | modified | Adds production Markdown renderer | Add `react-markdown` through pnpm |
| changelog/release tests | modified | Existing contracts and real-file paths change | Replace line-item assertions and add parity/precision cases |
| E2E UI fixtures | modified | New client interaction and timezone behavior | Add dialog, disclosure, locale, theme, mobile, hydration cases |
| release workflows | inspected/possibly modified | File staging lists may name `USER_CHANGELOG.md` explicitly | Update only references that enumerate the old file |

## Testing Approach

- **Frameworks and fixtures** — continue with Vitest for pure/domain and static
  React rendering tests. Use inline Markdown strings for parser boundaries,
  temporary filesystem fixtures only at the release-shell boundary, and real
  localized repository files for coherence tests. Fake only the filesystem,
  clock, and Git process boundaries; do not mock pure functions.
- **Unit level** — cover every parser issue, complete Markdown preservation,
  semantic ordering, locale parity, publication precision, exact formatter
  output, release preparation failure/idempotency, safe URLs, raw HTML behavior,
  and pure modal-state transitions.
- **Integration level** — exercise real locale files with `package.json`, output
  tracing, multi-document release preparation, technical-content separation,
  production dependency presence, and interrupted/partial release protection.
- **End-to-end level** — use the existing isolated Playwright build/database/port
  harness. Cover public footer interaction, native dialog focus and dismissal,
  multi-open and reset state, both locales, browser timezone overrides, Markdown
  semantics and safety, long/narrow layouts, all six theme/mode combinations,
  authorization-role equivalence, offline-after-load behavior, and hydration or
  console errors.
- **Execution** — implementation work runs targeted Vitest files first, then
  `pnpm check`, followed by `pnpm test:e2e` because the latter builds an isolated
  application and validates real browser layout.

Every concrete case and its stable ID is defined in [_tests.md](_tests.md).

## Development Sequencing

### Build Order

1. **Localized domain contract** — add `Publication`, complete-body parsing,
   semantic ordering, issue reporting, exact formatting, and parity validation.
   No new UI dependency.
2. **Bilingual source migration** — rename the Portuguese document, add the
   reviewed English edition, update real-file tests, and trace both files.
   Depends on step 1's parser/parity contract.
3. **Release preparation** — extend the pure release domain and version shell to
   stamp one UTC instant atomically across both localized files while preserving
   technical date output and retry semantics. Depends on steps 1 and 2.
4. **Safe Markdown adapter** — add `react-markdown`, safe URL rules, and semantic
   component mappings. Can begin after step 1 and does not depend on release
   shell changes.
5. **Client modal integration** — add native dialog lifecycle, disclosure state,
   local publication display, responsive styling, and server/client footer
   wiring. Depends on steps 1, 2, and 4.
6. **Cross-surface verification** — complete integration and E2E coverage, then
   run full checks. Depends on all previous steps.

### Technical Dependencies

- Add `react-markdown` as a production dependency and update the pnpm lockfile.
- Both localized histories must be reviewed before the strict parity gate can be
  enabled on the real repository files.
- No database migration, API credential, external translation service, queue,
  or new deployment service is required.
- Historical times require trustworthy workflow/hosting evidence; the feature
  remains complete when unproven entries stay date-only.

## Monitoring and Observability

No new runtime metric or alerting service is warranted for a file-backed global
modal. Operational visibility uses existing build/release signals plus narrowly
scoped diagnostics:

- Release preparation exits non-zero with a stable domain error code for locale
  mismatch, malformed publication, partial pre-existing version, or missing
  `Unreleased` section; the existing workflow surfaces the failing step.
- Runtime parsing emits one server warning per isolated invalid release with
  locale and issue code, never the Markdown body.
- E2E fails on browser console errors, hydration errors, missing localized
  content, horizontal overflow, inaccessible disclosures, or contrast failures.
- A missing active changelog file results in no trigger and a server warning;
  build integration tests prevent that silent degradation from reaching a
  verified artifact.

## Technical Considerations

### Key Decisions

- **Narrow Client Component with native dialog** — chosen because browser state,
  focus lifecycle, and device timezone belong together. It gives up the current
  zero-JavaScript footer interaction while avoiding hydration of the full footer.
- **Two locale Markdown files** — chosen for reviewability and parity validation.
  It gives up single-file authoring and requires bilingual release discipline.
- **`react-markdown` without raw HTML** — chosen for mature CommonMark block
  parsing and React-node output. It adds bundle weight but avoids maintaining a
  security-sensitive bespoke parser.
- **Discriminated publication precision** — chosen so TypeScript prevents
  date-only timezone conversion. It adds a small domain type instead of generic
  string convenience.
- **Version/tag creation timestamp** — chosen because `dev → staging` is the
  serialized event that creates the version. It intentionally does not claim to
  be production deployment time.
- **No API or database storage** — chosen because canonical Markdown is already
  the correct authoring and runtime source. An endpoint or table would add a
  second mutable truth without a real variation boundary.

### Known Risks

- **Release-pipeline regression, medium likelihood/high impact** — mitigate with
  pure multi-document preparation, real-file integration tests, coherent retry
  tests, and full workflow file-reference inspection.
- **Hydration or timezone mismatch, medium likelihood/medium impact** — format
  instants only after client hydration and assert no console/hydration errors in
  multiple browser timezones.
- **Markdown link or HTML injection, low likelihood/high impact** — omit raw-HTML
  plugins, allowlist link schemes, and test static output plus real browser
  behavior.
- **Locale semantic drift, medium likelihood/medium impact** — enforce version
  and metadata parity automatically and require human review for meaning.
- **Global dialog accessibility regression, medium likelihood/high impact** —
  use native modal dialog semantics and verify focus, Escape, backdrop, keyboard
  disclosure, labels, zoom, mobile, and themes through the public UI.
- **Historical timestamp overclaim, medium likelihood/medium impact** — never
  infer a tag-creation instant from a lightweight tag's commit time without
  corroboration; preserve date-only precision by default.

## Architecture Decision Records

- [ADR-001: Present releases as independently expandable cards](adrs/adr-001.md) — Product interaction and reset behavior.
- [ADR-002: Localize release instants without inventing historical time](adrs/adr-002.md) — Product timezone and historical-precision rules.
- [ADR-003: Publish equivalent localized notes in safe editorial Markdown](adrs/adr-003.md) — Product localization and Markdown contract.
- [ADR-004: Isolate browser-only behavior in a client modal](adrs/adr-004.md) — Narrow Client Component with native dialog.
- [ADR-005: Store locale editions separately and render with react-markdown](adrs/adr-005.md) — Locale-per-file content and proven safe renderer.
- [ADR-006: Model publication precision explicitly and stamp at version creation](adrs/adr-006.md) — UTC tag-time stamping and date-only type safety.
