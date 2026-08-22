---
status: completed
title: Localized changelog domain and coherent bilingual release pipeline
type: backend
complexity: high
---

# Task 1: Localized changelog domain and coherent bilingual release pipeline

## Overview

Deliver the pure changelog and release contracts that make localized release
notes trustworthy before the UI consumes them. This slice migrates the
user-facing history to two coherent locale editions, preserves historical
precision, and makes version creation a coherent, idempotent operation across
the technical changelog, both user changelogs, and `package.json`.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- The changelog domain MUST parse complete Markdown release bodies, preserve publication precision as `instant` or `date`, isolate malformed entries, and sort valid versions semantically.
- Portuguese and English user changelogs MUST contain the same visible versions and identical publication metadata while allowing idiomatic locale-specific prose.
- Historical date-only entries MUST remain date-only unless trustworthy evidence proves an actual version-creation instant; no synthetic time may be inferred.
- Publication formatting MUST convert stored UTC instants to the viewer's local timezone and produce exact `dd/mm/yyyy HH:mm` for `pt-BR` and `mm/dd/yyyy HH:mm` for `en`; date-only values MUST omit the time.
- Release preparation MUST validate every input before returning any transformed output and MUST stamp both localized files with one captured UTC instant while retaining the technical changelog's UTC date.
- Repeated release attempts MUST be coherent and idempotent: complete retries preserve the original identity and instant, while validation and partial pre-existing-release failures occur before writes. An operating-system I/O failure may leave only the ephemeral checkout dirty; the command exits non-zero so no commit, push, or tag can publish that state and a retry starts from a clean checkout.
- Runtime diagnostics MUST identify issue code, locale, and version when available without exposing release prose, secrets, user data, or technical changelog content.
- Runtime and release wiring MUST ship, stage, and validate both locale files and MUST not retain a live dependency on the deprecated `USER_CHANGELOG.md` path.
- The implementation MUST use erasable TypeScript syntax, explicit `.ts` relative imports, pure domain functions, and existing repository conventions.
</requirements>

## Subtasks

- [x] 1.1 Establish the discriminated publication, release, parse-result, issue, parity, semantic-ordering, and exact-formatting contracts in the pure changelog domain.
- [x] 1.2 Migrate the Portuguese user changelog to its locale-specific source and add a reviewed English edition with equivalent visible history and metadata.
- [x] 1.3 Preserve current historical date precision and document any evidence-backed instant without treating lightweight tag commit time as tag-creation time.
- [x] 1.4 Extend the pure release domain to prepare and validate the technical and two localized documents as one coherent result.
- [x] 1.5 Wire the release shell to capture one UTC instant, update every required output only after successful preparation, and preserve retry/idempotency guarantees.
- [x] 1.6 Update promotion and synchronization workflow file lists, release checks, and standalone tracing for both localized sources.
- [x] 1.7 Add safe, prose-free diagnostics and the current-version fallback contract required by the runtime adapter.
- [x] 1.8 Implement the assigned unit and integration contract cases, including real-file coherence and temporary release-fixture coverage.

## Implementation Details

Follow `_techspec.md` sections **Changelog Parsing and Ordering**, **Local
Publication Formatting**, **Release Preparation and Idempotency**, and
**Historical Migration**. Keep filesystem, Git, and clock work in the existing
release shell; parsing, parity, formatting, and multi-document preparation stay
pure. Start from the current `dev` behavior in `src/core/release.ts` and
`scripts/release/versionar.ts`: reconcile any concurrently landed
`[Unreleased]` recreation behavior instead of reverting it.

### Relevant Files

- `USER_CHANGELOG.md` — current Portuguese source to migrate without losing validated user-facing history.
- `USER_CHANGELOG.pt-BR.md` — canonical Portuguese user changelog to create.
- `USER_CHANGELOG.en.md` — canonical reviewed English user changelog to create.
- `CHANGELOG.md` — technical release source that keeps date-only release headers.
- `src/core/changelog.ts` — pure parser, publication model, parity validation, diagnostics, semantic ordering, formatter, and version fallback.
- `src/core/release.ts` — pure multi-document preparation and idempotency boundary.
- `scripts/release/versionar.ts` — filesystem, Git, package-version, and single-clock orchestration.
- `next.config.ts` — standalone output tracing for both locale sources.
- `.github/workflows/promover-para-staging.yml` — version-creation authority and release-output staging.
- `.github/workflows/sincronizar-apos-main.yml` — post-main synchronization file list.
- `tests/changelog.test.ts` — domain, real-file parity, precision, and diagnostics coverage.
- `tests/release.test.ts` — pure and shell-boundary release coverage.

### Dependent Files

- `package.json` — current version participates in coherence and retry decisions.
- `pnpm-lock.yaml` — remains coherent if release/test dependencies change during implementation.
- `app/footer.tsx` — consumes the new serializable release contract in Task 2.
- `app/layout.tsx` — continues to consume the current-version fallback and later supplies locale to the footer.
- `tests/workflows.test.ts` — update if it asserts release workflow file lists or wording.
- `docs/operations.md` — update only if the bilingual release authoring procedure is documented there today.

### Related ADRs

- [ADR-002: Localize release instants without inventing historical time](adrs/adr-002.md) — Defines local timezone conversion and truthful legacy precision.
- [ADR-003: Publish equivalent localized notes in safe editorial Markdown](adrs/adr-003.md) — Defines equivalent Portuguese and English editorial content.
- [ADR-005: Store locale editions separately and render with react-markdown](adrs/adr-005.md) — Establishes two canonical locale files and their parity obligation.
- [ADR-006: Model publication precision explicitly and stamp at version creation](adrs/adr-006.md) — Defines the discriminated type, UTC authority, and coherent preparation rules.

## Deliverables

- Pure localized changelog domain with explicit precision, safe diagnostics, complete-body parsing, semantic ordering, parity validation, and exact locale/timezone formatting.
- Canonical, reviewed `pt-BR` and `en` user changelogs with coherent visible history and publication metadata.
- Coherent and idempotent release preparation wired into the version shell and both release workflows.
- Standalone tracing and repository checks updated for both localized runtime files.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**.

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-001, UT-002, UT-003, UT-004, UT-005, UT-006, UT-007, UT-008, UT-009, UT-010, UT-011, UT-012 — complete-body parsing, publication validation, issue isolation, semantic ordering, and `Unreleased` preservation.
- [x] UT-013, UT-014, UT-015, UT-016, UT-017, UT-018, UT-019 — cross-locale version, publication, visibility, and content parity.
- [x] UT-020, UT-021, UT-022, UT-023, UT-024, UT-025, UT-026, UT-027, UT-028, UT-029 — coherent preparation, preconditions, partial-state failure, no-user-change handling, and idempotent retry.
- [x] UT-030, UT-031, UT-032, UT-033, UT-034, UT-035, UT-036 — exact locale formatting, device timezone conversion, date-only stability, calendar/DST boundaries, and invalid-input refusal.
- [x] UT-051, UT-052 — prose-free runtime diagnostics and current-version fallback.
- [x] IT-001, IT-002, IT-003 — real localized-file coherence, content boundary, and standalone tracing.
- [x] IT-005, IT-006, IT-007, IT-008, IT-009, IT-010 — successful, failed, retried, partial, no-user-change, and technical-content release fixtures.
- [x] IT-013, IT-014 — historical precision evidence and release-workflow staging coverage.

## Success Criteria

- Every assigned test case implemented and passing.
- Both localized changelogs parse without issues, expose the same visible version/publication sequence, and match the current package version at the top.
- Domain or validation failure leaves every required file byte-identical; a successful invocation prepares all outputs coherently, and a coherent retry never changes the original instant. An I/O failure exits before any release commit, push, or tag.
- UTC instants display exactly in the active locale and injected viewer timezone, while historical dates never drift or gain invented time.
- No active runtime, workflow, tracing, or release reference depends on the deprecated single changelog path.
