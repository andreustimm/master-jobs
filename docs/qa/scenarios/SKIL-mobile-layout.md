---
id: SKIL-mobile-layout
area: SKIL
title: Ler e auditar skills sem conteúdo cortado no celular
persona: Andreus no celular
journey: J-switch-workspace-screen
expected: A demanda de mercado e os controles de auditoria refluem em uma coluna, mantendo nome, percentual, status, barras e ações dentro da largura útil
entry_points: /candidate/skills
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs; tests/mobile.test.ts; docs/qa/reports/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix.md
last_report: docs/qa/reports/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix.md
overlaps: NAV-first-party-navigation-contract
---

Em 375×812 a lista de demanda coloca a barra em uma linha própria e permite que nomes longos quebrem sem empurrar o percentual ou o status para fora do cartão. Os controles de confirmação e rejeição mantêm alvos de toque móveis e a largura do shell usa 95% da tela.
