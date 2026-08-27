---
id: NAV-full-width-shell
area: NAV
title: Visualizar topo full-bleed e conteúdo móvel com 95% da viewport
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: O topo ocupa 100% da viewport; no celular somente o conteúdo usa 95% com 2,5% por lado; tablet e desktop preservam as calhas do design; os links do menu aparecem sempre que couberem.
entry_points: /
qa_status: untested
bug_ids: BUG-20260826-responsive-header-artifact-skew
fix_status: fixed
retest_status: pending
fix_commits: 1570ccd; b05f949; 79d9cf3
evidence: tests/e2e/ui.mjs; tests/mobile.test.ts; tests/pwa-chrome.test.ts; docs/qa/evidence/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh/production-obsolete-safe-area-selector.png; docs/qa/evidence/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh/production-wide-compact-menu.png
last_report: docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md
overlaps: PWA-installed-header-safe-area; SKIL-mobile-layout
---

A superfície do cabeçalho pertence à viewport e não recebe margem lateral.
Somente sua linha interna, o conteúdo, o banner e o rodapé recebem calhas. No
celular a regra de produto é literal: 2,5% de cada lado; acima dele, as calhas
continuam na escala do DESIGN.md. A navegação escolhe fileira ou hambúrguer pela
largura medida, não pelo nome do dispositivo.

Produção falhou novamente em 2026-08-27 porque serviu a folha antiga com
`html.pwa-standalone body>div`. A correção só poderá ser marcada como verificada
quando o gate pós-deploy rejeitar essa folha e uma sessão publicada confirmar
topo, conteúdo e menu nas quatro classes de viewport.
