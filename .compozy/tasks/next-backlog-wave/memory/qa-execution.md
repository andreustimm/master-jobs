# QA execution memory

## Objective Snapshot

Audit the completed `next-backlog-wave` tasks and verify the responsive UI,
candidate queue status, Compozy trust boundary, adapter fixtures, and
operational documentation against the repository contract. The final pass
must include the mobile landscape regression where the navigation popover is
already open while the viewport rotates.

## Important Decisions

- The compact navigation remains active below the `xl` breakpoint so the
  812px, 1024px, and iPad-landscape widths do not squeeze the full link row.
- The mobile popover is positioned from the complete header rectangle, not the
  shorter centered trigger, and is recalculated on both `resize` and
  `orientationchange` while open.
- Mobile/tablet action controls keep the 44px touch target; compact desktop
  sizing starts at `xl`.
- The installed-PWA physical-device confirmation remains blocked until a real
  device is available; automated safe-area and viewport evidence is not used
  as a substitute.

## Learnings

- A browser test that closes and reopens a popover after changing the viewport
  cannot detect a missing rotation listener. The regression test must keep the
  same panel open, change header geometry, dispatch the orientation event, and
  compare the new panel top with the new header bottom.
- Static source assertions are useful contracts but do not prove geometry or
  event behavior; the Playwright E2E is the authoritative proof for this bug.
- The repository gate requires a local listener; sandboxed runs can fail with
  `listen EPERM`, which is an environment restriction rather than a product
  failure. The escalated local run is the evidence used below.

## Files / Surfaces

- `app/layout.tsx`, `app/mobile-nav.tsx`, and `app/footer.tsx` — responsive
  shell, breakpoints, safe-area and navigation geometry.
- `app/candidate/skills/page.tsx`, `app/candidate/versions.tsx`, and
  `app/admin/users/page.tsx` — mobile action targets and wrapping.
- `src/core/scoring/queue.ts`, `app/candidate/page.tsx`, and i18n dictionaries
  — candidate-scoped queue status and localized rendering.
- `tests/e2e/ui.mjs`, `tests/mobile.test.ts`, `tests/nav-mobile.test.ts`, and
  `tests/pwa-chrome.test.ts` — browser and contract regressions.
- `.compozy/tasks/next-backlog-wave/`, `compozy/`, and `docs/qa/` — task,
  workflow, and living QA artifacts.

## Errors / Corrections

- Initial deep-review sweep reported a Major because rotation coverage was only
  source-string based. Classification: `genuine-failure` in the review
  artifact, corrected by adding the open-popover rotation sequence to
  `tests/e2e/ui.mjs` and rerunning `sweep-tests`.
- The first E2E implementation measured the trigger bottom and failed on PWA
  safe-area fixtures. Classification: `genuine-failure`; corrected to measure
  `#application-shell > header` bottom. The final E2E run passed.
- A sandbox run of `pnpm check` and `pnpm test:e2e` failed to bind
  `127.0.0.1` with `EPERM`. Classification: `grader-bug` / environment
  restriction; escalated local runs passed with the same source state.
- No task frontmatter was flipped during the audit, so no bug issue was filed
  and `state.yaml` remains owned by the cy-codex-loop updater.

## Ready for Next Run

- All four task frontmatters remain `status: completed` and have an independent
  `PASS` verdict in the audit report.
- Deep review has 11/11 valid jobs, no open findings, and verdict `SHIP`.
- The remaining human-only step is physical installed-PWA confirmation; it is
  explicitly tracked as blocked rather than inferred from automation.
