# BUG-20260825-pwa-header-status-bar-overlap: barra do sistema cobre o cabeçalho da PWA

- **Status:** fixed
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Candidato em trânsito
- **Journey Step:** J-open-dashboard-direct, step 2
- **Scenarios:** PWA-installed-header-safe-area
- **Found:** 2026-08-25 · **Report:** docs/qa/reports/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted.md
- **Origin:** foto fornecida pelo usuário em uma PWA instalada no celular

## Summary

Ao abrir o Cockpit como PWA instalada, o relógio e os indicadores do sistema aparecem sobre a marca e os controles do cabeçalho. O menu ainda pode ser alcançado, mas a primeira área da tela fica cortada e difícil de ler.

## Reproduction

- **Charter:** CH-installed-header-safe-area · **Tour:** Feature Tour
- **Environment:** PWA instalada / telefone em retrato / pt-BR

1. Abrir a PWA instalada diretamente no Cockpit.
2. Observar a marca, o menu, o seletor de idioma e o controle de aparência no topo.
3. Girar o aparelho e recarregar a tela.

**Expected:** O conteúdo do cabeçalho começa abaixo da barra do sistema em todas as orientações.
**Actual:** A barra do sistema ocupa o mesmo espaço da marca e dos controles, cortando o topo.

## Evidence

- Foto do usuário anexada à solicitação de 2026-08-25.
- `tests/e2e/ui.mjs` registra a geometria computada em mobile retrato, mobile paisagem, tablet e desktop.

## Fix

- **Root cause:** o shell instalado dependia apenas de `safe-area-inset-top`; alguns launchers móveis mantêm a barra do sistema sobre o viewport, mas reportam esse inset como zero.
- **Fix commit:** `5f90e25`
- **Regression test:** `tests/pwa-chrome.test.ts` falhou antes e passou depois; `376d242` trava a ligação dos tokens aos insets do aparelho, e `tests/e2e/ui.mjs` confirma geometria e ausência de overflow em quatro viewports.

## Verification

- **Retested:** 2026-08-25, sessão no runtime `5f90e25` e gate automatizado final no runtime `6562ac6`, em build de produção local Chromium · retrato 375×812, paisagem 812×375, tablet 768×1024 e desktop 1280×900 · **Report:** docs/qa/reports/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted.md
- **Result:** o conteúdo ficou abaixo do piso seguro em todos os contextos de toque, sem overflow; o desktop não ganhou faixa artificial. A verificação no Safari/PWA físico continua pendente antes de mover o bug para `verified`.
