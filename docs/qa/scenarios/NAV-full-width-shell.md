---
id: NAV-full-width-shell
area: NAV
title: Visualizar topo full-bleed e conteúdo móvel com 95% da viewport
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: O topo ocupa 100% da viewport; no celular somente o conteúdo usa 95% com 2,5% por lado; tablet e desktop preservam as calhas do design; os links do menu aparecem sempre que couberem.
entry_points: /
qa_status: pass
bug_ids: BUG-20260826-responsive-header-artifact-skew
fix_status: fixed
retest_status: verified
fix_commits: 1570ccd; b05f949; 79d9cf3
evidence: tests/e2e/ui.mjs; tests/mobile.test.ts; tests/pwa-chrome.test.ts; docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/NAV-full-width-shell-mobile.png
last_report: docs/qa/reports/2026-09-17T230607949478Z-796f372b-pre-varredura-cenarios-nao-testados.md
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
