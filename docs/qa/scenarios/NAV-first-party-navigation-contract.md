---
id: NAV-first-party-navigation-contract
area: NAV
title: Percorrer toda navegação interna por uma transição estável
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Menu, links contextuais, filtros, paginação e redirects chegam ao destino com um único splash e sem repetir ações
entry_points: /; /jobs; /compare; /pipeline; /referrals; /candidate; /admin/users
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs
last_report: docs/qa/reports/2026-08-24-task-04-first-party-navigation.md
overlaps: NAV-switch-screen-ready
---

Cobertura: inventário desktop/mobile, links contextuais, GET URL-backed, redirects de Server Actions e exclusões nativas/externas.

O inventário completo passou com uma geração por navegação aceita; POSTs permaneceram one-shot e controles externos, download e modificadores preservaram a semântica nativa.
