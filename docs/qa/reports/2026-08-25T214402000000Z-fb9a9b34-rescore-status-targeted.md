# QA Run Report — 2026-08-25T214402000000Z-fb9a9b34 — rescore-status-targeted

- **Scope:** Candidate-scoped, localized and responsive ranking-refresh status on `/candidate`, plus adjacent navigation canary
- **Cadence tier:** targeted
- **Build:** b0bb989 + working-tree task_03 diff · **Environment:** isolated Next.js standalone production build on loopback with real SQLite auth and deterministic identities
- **Started:** 2026-08-25T21:44:02Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem noturna | Power User | laptop / wifi-fast / pt-BR | CH-save-cv-ranking-refresh, CH-night-ranking-navigation |
| Candidato após falha | Recovering User | laptop / flaky / pt-BR | CH-failed-ranking-refresh |

## Flows in Scope

- `J-refresh-candidate-ranking` — O candidato entende se o ranking incorporou o CV salvo (`../journeys/J-refresh-candidate-ranking.md`)
- `J-switch-workspace-screen` — A navegação adjacente continua chegando ao destino correto (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-save-cv-ranking-refresh | J-refresh-candidate-ranking / PROF-rescore-status-visibility | Andreus em triagem noturna | Feature Tour | Pass | | |
| 2 | CH-failed-ranking-refresh | J-refresh-candidate-ranking / PROF-rescore-status-privacy | Candidato após falha | Error Message Tour | Pass | | |
| 3 | CH-night-ranking-navigation | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus em triagem noturna | Feature Tour | Pass | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-save-cv-ranking-refresh — Andreus em triagem noturna

- **Ran:** 2026-08-25T21:45Z → 2026-08-25T21:47Z (box respected: yes)
- **Findings:** The Portuguese card reported `Na fila` after a real CV save and kept the same state after reload; no finding.
- **Bugs filed/updated:** none
- **Scenarios settled:** PROF-rescore-status-visibility → pass
- **Paper cuts:** none
- **Surprises:** The card's status heading and form remained easy to locate in the existing long candidate page.
- **Suggested next charter:** Re-walk completion after a real worker drains a production-like corpus.

### CH-failed-ranking-refresh — Candidato após falha

- **Ran:** 2026-08-25T21:48Z → 2026-08-25T21:51Z (box respected: yes)
- **Findings:** Failed and idle identities remained distinct after reload; Portuguese failure copy exposed no technical detail and both portrait/landscape layouts stayed contained; no finding.
- **Bugs filed/updated:** none
- **Scenarios settled:** PROF-rescore-status-privacy → pass
- **Paper cuts:** none
- **Surprises:** The same semantic heading appeared in the accessibility snapshot without relying on badge color.
- **Suggested next charter:** Exercise recovery by re-saving after a naturally occurring worker failure.

### CH-night-ranking-navigation — Andreus em triagem noturna

- **Ran:** 2026-08-25T21:46Z → 2026-08-25T21:47Z (box respected: yes)
- **Findings:** Candidate → Jobs navigation reached `/jobs`, survived reload and remained operable; no finding.
- **Bugs filed/updated:** none
- **Scenarios settled:** NAV-first-party-navigation-contract → pass
- **Paper cuts:** none
- **Surprises:** none
- **Suggested next charter:** Keep the existing navigation inventory for the next full release pass.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-refresh-candidate-ranking | pass | pass | pass | pass | pass | pass | agent-browser checkpoints plus E2E Chromium/WebKit, six theme-mode combinations and axe |
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass | navigation canary screenshot and refresh |

## What Was Fixed

No QA-discovered fixes yet.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

No browser runtime error was observed during the three public-interface sessions. The initial screenshot command missed its evidence directory; creating the ignored directory resolved the QA harness issue without touching product state.

## Human Verifications Needed

None identified yet.

## Decisions for a Human

None identified yet.

## Learnings

- One compact status card is enough to make the asynchronous CV save outcome legible without polling.
- Identity-separated QA fixtures make privacy regressions observable through public sessions rather than database inspection.

## Final Status

- **Exit gate (full automated suite):** `rtk pnpm check` — 150 files passed, 2,107 tests passed, 6 skipped, QA tracker contracts 13/13; `rtk pnpm test:e2e` — 190/190 browser checks and 8/8 pages without axe WCAG 2.2 AA violations
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 2/2 journeys walked; no skips
- **Verdict:** ready — both in-scope journeys and the complete automated exit gate are green with no open finding.
