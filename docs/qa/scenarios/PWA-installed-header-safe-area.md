---
id: PWA-installed-header-safe-area
area: PWA
title: Abrir a PWA instalada sem conteúdo sob a barra do sistema
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: Em retrato, marca e controles ficam abaixo da barra do sistema; em paisagem baixa de telefone, o topo usa só o inset físico e mantém altura proporcional; tablet e desktop preservam seu contrato de área segura
entry_points: /
qa_status: blocked-verify
bug_ids: BUG-20260825-pwa-header-status-bar-overlap
fix_status: fixed
retest_status: pending
fix_commits: c2dcaed; 98759c5; 1570ccd; b05f949; 79d9cf3
evidence: tests/e2e/ui.mjs; tests/pwa-chrome.test.ts; docs/qa/evidence/2026-08-27-responsive-shell-final/mobile-portrait-375x812.png; docs/qa/evidence/2026-08-27-responsive-shell-final/mobile-landscape-812x375.png; docs/qa/evidence/2026-08-27-responsive-shell-final/tablet-768x1024.png; docs/qa/evidence/2026-08-27-responsive-shell-final/desktop-1280x900.png; docs/qa/evidence/2026-08-27-responsive-shell-final/widescreen-1920x1080.png; docs/qa/evidence/2026-08-28T002708793000Z-b25bc373-landscape-header-targeted/pwa-portrait-375x812.png; docs/qa/evidence/2026-08-28T002708793000Z-b25bc373-landscape-header-targeted/pwa-landscape-812x375.png; docs/qa/evidence/2026-08-28T002708793000Z-b25bc373-landscape-header-targeted/pwa-wide-phone-landscape-932x430.png; docs/qa/evidence/2026-08-28T002708793000Z-b25bc373-landscape-header-targeted/pwa-tablet-landscape-1024x375.png
last_report: docs/qa/reports/2026-08-28T002708793000Z-b25bc373-landscape-header-targeted.md
overlaps: PWA-direct-load-startup-singleton; NAV-first-party-navigation-contract
---

O fundo do cabeçalho pode alcançar a borda física do aparelho. O conteúdo interativo, porém, precisa respeitar a área segura mesmo quando um launcher instalado informa `safe-area-inset-top` igual a zero.

Chromium emulado passou nos quatro viewports, mas a confirmação do Safari/PWA físico que originou o bug permanece explicitamente bloqueada para verificação humana.

O piso tokenizado continua protegendo o retrato quando o launcher informa inset
zero. Em paisagem baixa, onde a barra do sistema desaparece, somente o inset
físico real deve compor a altura; reaproveitar o piso do retrato cria uma faixa
vazia de 48px. O resultado automatizado precisa ser confirmado na PWA física.

**Reset 2026-08-27:** a fileira do cabeçalho usa `min-h-16 py-3`. A superfície
do topo continua full-bleed; no celular, o conteúdo usa 95% da viewport
(2,5% por lado), enquanto tablet e desktop mantêm as calhas de 24px/32px do
DESIGN.md. Os cenários voltam para `untested` até a confirmação física contra
produção, com o gate de CSS provando que o build servido é o novo.

**Reset paisagem 2026-08-27:** a captura física da versão 1.3.9 confirmou o
retrato correto e revelou altura excessiva somente após a rotação. A rodada
targeted mede separadamente as duas orientações e usa tablet/desktop como
canários para impedir que a exceção de telefone escape do contexto de altura.

**Reteste local 2026-08-28:** emulação touch real mediu retrato 375×812 com
48px de piso e cabeçalho de 113px; em paisagem 812×375 o padding caiu para 0 e
o cabeçalho ficou em 65px, sem overflow. O estado permanece `blocked-verify`
até a confirmação no telefone físico após a publicação.

O canário adicional 1024×375 com toque manteve o piso do tablet, provando que
a exceção de baixa altura também permanece limitada abaixo do breakpoint de
tablet. O canário 932×430 cobre telefones largos sem reintroduzir a faixa.
