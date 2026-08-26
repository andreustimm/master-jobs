# QA Run Report — 2026-08-26T174227129000Z-c759d603 — responsive header artifact skew

- **Scope:** cabeçalho responsivo resiliente a HTML e CSS publicados fora de sincronia, sem links empilhados nem dois menus simultâneos
- **Cadence tier:** targeted
- **Build:** working tree `codex/fix-responsive-header` · **Environment:** build Next.js de produção local isolado, banco temporário e navegador real; comparação de artefatos com `jobs.mastertimm.com.br`
- **Started:** 2026-08-26T17:42:27Z · **Status:** in-progress

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus no celular | `docs/qa/personas.md` | 375×812 e 812×375 / 4g / pt-BR | CH-mobile-responsive-regression |
| Andreus em triagem | `docs/qa/personas.md` | 768×1024 e 1280×900 / wifi-fast / pt-BR | canário de navegação |

## Flows in Scope

- `J-switch-workspace-screen` — trocar de tela com um único modo de navegação visível e operável (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-mobile-responsive-regression | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus no celular | Feature Tour | Pending | BUG-20260826-responsive-header-artifact-skew | pending |
| 2 | canário de navegação | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus em triagem | Feature Tour | Pending | | pending |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

Pending.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-switch-workspace-screen | pending | pending | pending | pending | pending | pending | pending |

## What Was Fixed

Pending.

## Paper Cuts

Nenhum registrado antes da sessão.

## Runtime Errors Observed

Pending.

## Human Verifications Needed

Nenhuma prevista para este contrato de layout.

## Decisions for a Human

Nenhuma.

## Learnings

- Um layout crítico precisa de um estado HTML seguro antes de qualquer medição no cliente; CSS dinâmico pode melhorar o breakpoint, mas não pode ser o único guard de visibilidade.

## Final Status

- **Exit gate (full automated suite):** pending
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 · Friction 0 · Cosmetic 0
- **Coverage:** 0 / 1 jornada percorrida
- **Verdict:** not-ready — QA e gate final pendentes.
