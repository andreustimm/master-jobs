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
fix_status: fixed
retest_status: pass
fix_commits:
evidence: tests/e2e/ui.mjs; tests/nav-mobile.test.ts; docs/qa/reports/2026-08-26T023000000000Z-mobile-responsive-targeted.md
last_report: docs/qa/reports/2026-08-26T023000000000Z-mobile-responsive-targeted.md
overlaps: NAV-switch-screen-ready
---

Cobertura: inventário desktop/mobile, links contextuais, GET URL-backed, redirects de Server Actions e exclusões nativas/externas.

O inventário completo passou com uma geração por navegação aceita; POSTs permaneceram one-shot e controles externos, download e modificadores preservaram a semântica nativa.

Revalidado no build `bfd27a9` em todos os destinos globais, filtro GET, densidade e paginação; o recrutador entrou diretamente em Vagas com apenas o destino autorizado visível.

O Full QA repetiu a navegação e o reload com Andreus em triagem, Andreus em triagem noturna e Andreus no celular; a viewport 375×812 permaneceu sem overflow.
