# QA Run Report — 2026-08-26T023000000000Z-mobile-responsive-targeted

- **Scope:** navegação em paisagem, shell de 95% no mobile, linhas responsivas de Skills e alvos móveis das ações administrativas e de versões
- **Cadence tier:** targeted
- **Build:** working tree `codex/next-backlog-tasks` · **Environment:** build Next.js de produção local, Chromium e axe com sessões E2E reais
- **Started:** 2026-08-26T02:30:00Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus no celular | Mobile User | 375×812, 812×375, 1024×375, 768×1024 e 1280×900 / 4g / pt-BR | CH-mobile-responsive-regression |
| Andreus em triagem | Power User | desktop / wifi-fast / pt-BR | canário no `test:e2e` |

## Flows in Scope

- `J-switch-workspace-screen` — chegar à próxima área com navegação íntegra e controles utilizáveis (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-mobile-responsive-regression | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus no celular | Feature Tour | Pass (automated) | | pending commit |
| 2 | CH-mobile-responsive-regression | J-switch-workspace-screen / SKIL-mobile-layout | Andreus no celular | Feature Tour | Pass (automated) | | pending commit |
| 3 | CH-mobile-responsive-regression | J-switch-workspace-screen / ADMN-mobile-action-targets | Andreus no celular | Feature Tour | Pass (automated) | | pending commit |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-mobile-responsive-regression — Andreus no celular

- **Ran:** 2026-08-26T02:30Z → 2026-08-26T02:35Z (box respected: yes)
- **Findings:** menu compacto permaneceu visível em 812×375 e 1024×375 sem espremer os links; shell e footer mantiveram 95% no mobile; linhas de Skills refluíram sem overflow interno; ações administrativas e de versões mantiveram altura mínima de 44px no celular. O mesmo build passou em 375×812, 768×1024 e 1280×900.
- **Bugs filed/updated:** nenhum novo; a regressão do cabeçalho PWA continua no registro existente e ainda pede confirmação física.
- **Scenarios settled:** NAV-first-party-navigation-contract → pass; SKIL-mobile-layout → pass; ADMN-mobile-action-targets → pass.
- **Paper cuts:** nenhum observado no percurso automatizado.
- **Surprises:** o catálogo de Skills precisou ser semeado no fixture E2E para que a medição exercitasse linhas reais em vez de um estado vazio.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-switch-workspace-screen | pass | pass | pass | pass (Chromium emulado) | pass | pass for local production build | `tests/e2e/ui.mjs`; `tests/mobile.test.ts`; axe 8/8 |

## What Was Fixed

### Responsive header, Skills e ações móveis

- **Symptom:** a paisagem mostrava a navegação desktop espremida; Skills cortava status/barras; Excluir era menor que os demais controles.
- **Root cause:** o breakpoint `sm` ativava a fileira antes de haver espaço real, e os componentes mantinham trilhos mínimos/larguras compactas em telas de toque.
- **Fix:** menu completo passa a `xl`; shell/footer usam 95% no mobile; linhas e ações refluem com a escala do DESIGN.md. O popover mede o cabeçalho real para não cobrir a safe-area da PWA.
- **Regression test:** `tests/e2e/ui.mjs` e `tests/mobile.test.ts` — a verificação de paisagem, reflow e alvo móvel passa no build atual.
- **Retested:** J-switch-workspace-screen em retrato, paisagem, tablet e desktop.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus no celular | J-switch-workspace-screen step 1 | "A navegação continua acessível quando viro o aparelho." | sharp | fixed (pending commit) |

## Runtime Errors Observed

- Nenhum erro de aplicação, navegação ou axe; avisos de engine Node e `MaxListenersExceededWarning` do runner não alteraram o observável e já aparecem fora do produto.

## Human Verifications Needed

- [ ] No mesmo aparelho da foto, atualizar/reinstalar a PWA e confirmar visualmente em retrato e paisagem que relógio/indicadores não cobrem o cabeçalho (a confirmação física segue bloqueada no cenário PWA existente).

## Decisions for a Human

Nenhuma.

## Learnings

- O breakpoint deve ser escolhido pelo espaço disponível para a fileira inteira; ultrapassar `sm` não significa que um telefone em paisagem virou desktop.
- Fixtures de browser precisam conter conteúdo representativo para que um teste de layout não passe por um estado vazio.

## Final Status

- **Exit gate (full automated suite):** `rtk pnpm check` — 152 arquivos, 2130 testes passaram, 6 ignorados; `rtk pnpm test:e2e` — 197/197 verificações e 8/8 páginas sem violações axe WCAG 2.2 AA.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 1 jornada / 1 em escopo; 3 cenários resolvidos nos quatro viewports; confirmação física da PWA explicitamente pendente.
- **Verdict:** ready-with-blocked-items — a cobertura automatizada está verde; falta somente a confirmação humana no aparelho instalado.
