---
id: PWA-installed-header-safe-area
area: PWA
title: Abrir a PWA instalada sem conteúdo sob a barra do sistema
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: Marca, menu, idioma e aparência ficam abaixo da barra do sistema em retrato e paisagem, sem criar faixa vazia no desktop
entry_points: /
qa_status: blocked-verify
bug_ids: BUG-20260825-pwa-header-status-bar-overlap
fix_status: fixed
retest_status: pending
fix_commits: 5f90e25
evidence: tests/e2e/ui.mjs; tests/pwa-chrome.test.ts; docs/qa/evidence/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted/header-portrait-touch.png; docs/qa/evidence/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted/header-landscape-touch.png; docs/qa/evidence/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted/header-tablet-touch.png; docs/qa/evidence/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted/header-desktop.png
last_report: docs/qa/reports/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted.md
overlaps: PWA-direct-load-startup-singleton; NAV-first-party-navigation-contract
---

O fundo do cabeçalho pode alcançar a borda física do aparelho. O conteúdo interativo, porém, precisa respeitar a área segura mesmo quando um launcher instalado informa `safe-area-inset-top` igual a zero.

Chromium emulado passou nos quatro viewports, mas a confirmação do Safari/PWA físico que originou o bug permanece explicitamente bloqueada para verificação humana.
