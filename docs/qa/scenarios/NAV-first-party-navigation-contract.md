---
id: NAV-first-party-navigation-contract
area: NAV
title: Percorrer toda navegação interna por uma transição estável
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Menu, links contextuais, filtros, paginação e redirects chegam ao destino com um único splash e sem repetir ações
entry_points: /; /jobs; /compare; /pipeline; /referrals; /candidate; /admin/users
qa_status: untested
bug_ids: BUG-20260826-responsive-header-artifact-skew
fix_status: in-progress
retest_status: pending
fix_commits:
evidence: tests/e2e/ui.mjs; tests/nav-mobile.test.ts; docs/qa/reports/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix.md; docs/qa/evidence/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix/header-landscape.png; docs/qa/evidence/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix/header-wide.png
last_report: docs/qa/reports/2026-08-26T083500000000Z-b7f3a1c9-header-top-fix.md
overlaps: NAV-switch-screen-ready
---

Cobertura: inventário desktop/mobile, links contextuais, GET URL-backed, redirects de Server Actions e exclusões nativas/externas.

O inventário completo passou com uma geração por navegação aceita; POSTs permaneceram one-shot e controles externos, download e modificadores preservaram a semântica nativa.

Revalidado no build `bfd27a9` em todos os destinos globais, filtro GET, densidade e paginação; o recrutador entrou diretamente em Vagas com apenas o destino autorizado visível.

O Full QA repetiu a navegação e o reload com Andreus em triagem, Andreus em triagem noturna e Andreus no celular; a viewport 375×812 permaneceu sem overflow.

Esta rodada revalidou o cabeçalho em 1280×800 e 1920×1080: os links completos aparecem quando a largura natural comporta marca, controles e espaçamentos; o menu compacto permanece apenas nos viewports em que a fileira não cabe.

Reaberto em 2026-08-26 depois que produção serviu o HTML novo junto de um CSS sem os seletores responsivos: a navegação completa ficou empilhada ao mesmo tempo que o botão do menu compacto. O contrato agora exige um fallback estrutural no próprio HTML e verifica altura, direção e exclusão mútua dos dois modos.
