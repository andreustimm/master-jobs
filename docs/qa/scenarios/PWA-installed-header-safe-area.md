---
id: PWA-installed-header-safe-area
area: PWA
title: Abrir a PWA instalada sem conteúdo sob a barra do sistema
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: Marca, menu, idioma e aparência ficam abaixo da barra do sistema em retrato e paisagem, sem criar faixa vazia no desktop
entry_points: /
qa_status: untested
bug_ids: BUG-20260825-pwa-header-status-bar-overlap
fix_status: fixed
retest_status: untested
fix_commits: codex/header-top-fix (PR pending); codex/header-safe-area-web
evidence: tests/e2e/ui.mjs; tests/pwa-chrome.test.ts; docs/qa/evidence/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix/header-pwa-safe-area.png; docs/qa/evidence/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix/header-portrait.png; docs/qa/evidence/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix/header-landscape.png; docs/qa/evidence/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix/header-tablet.png; docs/qa/evidence/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix/header-wide.png
last_report: docs/qa/reports/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix.md
overlaps: PWA-direct-load-startup-singleton; NAV-first-party-navigation-contract
---

O fundo do cabeçalho pode alcançar a borda física do aparelho. O conteúdo interativo, porém, precisa respeitar a área segura mesmo quando um launcher instalado informa `safe-area-inset-top` igual a zero.

Chromium emulado passou nos quatro viewports, mas a confirmação do Safari/PWA físico que originou o bug permanece explicitamente bloqueada para verificação humana.

Esta rodada também cobriu o caso horizontal e WebViews que expõem o inset sem a classe de modo instalado; o piso tokenizado agora vale para qualquer orientação de toque. O resultado automatizado passou, mas a captura física ainda é necessária para fechar o reteste.

**Reset 2026-08-27:** a fileira do cabeçalho usa `min-h-16 py-3`. A superfície
do topo continua full-bleed; no celular, o conteúdo usa 95% da viewport
(2,5% por lado), enquanto tablet e desktop mantêm as calhas de 24px/32px do
DESIGN.md. Os cenários voltam para `untested` até a confirmação física contra
produção, com o gate de CSS provando que o build servido é o novo.
