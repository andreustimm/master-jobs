# QA Run Report — 2026-08-28T002708793000Z-b25bc373 — landscape-header-targeted

- **Scope:** corrigir a altura excessiva do cabeçalho da PWA em telefone girado para paisagem, preservando retrato, tablet e desktop
- **Cadence tier:** targeted
- **Build:** `origin/dev@e3a2f88` + working tree · **Environment:** build de produção local, banco e autenticação reais de QA; Chromium com emulação de toque e viewport
- **Started:** 2026-08-28T00:27:08.793Z · **Status:** completed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato em trânsito | Mobile User | phone-small / 4g / pt-BR | CH-installed-header-safe-area |
| Andreus no celular | Mobile User | phone-small / 4g / pt-BR | CH-mobile-responsive-regression |

## Flows in Scope

- `J-open-dashboard-direct` — abrir a PWA e receber um shell utilizável em qualquer orientação (`../journeys/J-open-dashboard-direct.md`)
- `J-switch-workspace-screen` — navegar pelo cabeçalho compartilhado sem sobreposição, overflow ou modo duplicado (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-installed-header-safe-area | J-open-dashboard-direct / PWA-installed-header-safe-area | Candidato em trânsito | Feature Tour | Blocked (needs human verify) | BUG-20260825-pwa-header-status-bar-overlap | working tree |
| 2 | CH-mobile-responsive-regression | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus no celular | Feature Tour | Pass | | working tree |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

- **CH-installed-header-safe-area:** o build de produção local foi aberto com
  autenticação real, `pwa-standalone`, toque real e as resoluções 375×812 e
  812×375. Em retrato, o piso permaneceu em 48px (`headerHeight=113px`); em
  paisagem baixa, o piso foi removido e restou apenas o inset físico
  (`paddingTop=0px`, `headerHeight=65px`). Não houve overflow horizontal. A
  última perna continua bloqueada porque somente o aparelho físico confirma o
  comportamento do launcher e da barra do sistema depois do deploy.
- **CH-mobile-responsive-regression:** a fileira manteve exclusão mútua entre
  menu compacto e navegação ampla, controles utilizáveis e conteúdo sem
  overflow. A redução vertical ficou restrita ao contexto coarse + landscape +
  altura baixa + largura de telefone; o canário touch 1024×375 preservou o piso
  de 48px do tablet (`headerHeight=113px`) e o canário 932×430 cobriu um
  telefone largo.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-open-dashboard-direct | pass | pass | pass | blocked-verify | pass | pass | `pwa-portrait-375x812.png`; `pwa-landscape-812x375.png`; `pwa-wide-phone-landscape-932x430.png`; `pwa-tablet-landscape-1024x375.png`; medidas computadas e E2E verdes |
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass | mesma captura de paisagem; `tests/e2e/ui.mjs`; suíte E2E completa |

## What Was Fixed

- O piso artificial de 48px continua protegendo o cabeçalho instalado em
  retrato quando o launcher informa inset zero.
- Em telefone touch, paisagem e altura de até 500px, o cabeçalho passa a usar
  somente `safe-area-inset-top`; sem barra física, não cria faixa vazia. O
  limite adicional de 1023px cobre telefones largos e mantém tablets fora da
  exceção.
- O teste de contrato e o E2E medem orientação, coarse pointer, padding,
  altura da fileira e overflow para impedir regressão nas duas orientações.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de runtime, console ou overflow observado na rodada.

## Human Verifications Needed

- Após a publicação, abrir a PWA no mesmo telefone da captura física, confirmar
  o retrato sem regressão, girar para paisagem e verificar que o topo mede só a
  fileira normal mais eventual inset físico do aparelho.

## Decisions for a Human

Nenhuma até o início das sessões.

## Learnings

- O launcher pode informar inset zero em retrato e, ao mesmo tempo, esconder a
  barra do sistema em paisagem. O piso precisa ser sensível à orientação e à
  altura disponível, não apenas à presença de touch.
- Screenshot com viewport redimensionado não é prova suficiente: a evidência
  válida exigiu `hasTouch=true` para ativar `(pointer: coarse)`.

## Final Status

- **Exit gate (full automated suite):** `pnpm check` verde (2.159 testes, 5
  skipped); `pnpm test:e2e` verde (207/207 e 8/8 axe); `pnpm build` verde;
  `pnpm test:pwa-browser` verde (33/33)
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 1 · Cosmetic 0
- **Coverage:** 2/2 jornadas percorridas
- **Verdict:** ready-with-blocked-items — implementação e regressão
  automatizada verdes; resta somente confirmação humana na PWA física após o
  deploy.
