---
id: NAV-first-party-navigation-contract
area: NAV
title: Percorrer toda navegação interna por uma transição estável
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Menu, links contextuais, filtros, paginação e redirects chegam ao destino com um único splash e sem repetir ações
entry_points: /; /jobs; /compare; /pipeline; /referrals; /candidate; /admin/users
qa_status: pass
bug_ids: BUG-20260826-responsive-header-artifact-skew
fix_status: fixed
retest_status: pass
fix_commits: 062eb64, cce67ae, 055af8a, a56a0c1
evidence: tests/e2e/ui.mjs; tests/nav-mobile.test.ts; docs/qa/reports/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew.md; docs/qa/evidence/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew/after-mobile-portrait.png; docs/qa/evidence/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew/after-mobile-landscape.png; docs/qa/evidence/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew/after-tablet.png; docs/qa/evidence/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew/after-desktop.png; docs/qa/evidence/2026-08-28T002708793000Z-b25bc373-landscape-header-targeted/pwa-landscape-812x375.png
last_report: docs/qa/reports/2026-08-28T002708793000Z-b25bc373-landscape-header-targeted.md
overlaps: NAV-switch-screen-ready
---

Cobertura: inventário desktop/mobile, links contextuais, GET URL-backed, redirects de Server Actions e exclusões nativas/externas.

O inventário completo passou com uma geração por navegação aceita; POSTs permaneceram one-shot e controles externos, download e modificadores preservaram a semântica nativa.

Revalidado no build `bfd27a9` em todos os destinos globais, filtro GET, densidade e paginação; o recrutador entrou diretamente em Vagas com apenas o destino autorizado visível.

O Full QA repetiu a navegação e o reload com Andreus em triagem, Andreus em triagem noturna e Andreus no celular; a viewport 375×812 permaneceu sem overflow.

Esta rodada revalidou o cabeçalho em 1280×800 e 1920×1080: os links completos aparecem quando a largura natural comporta marca, controles e espaçamentos; o menu compacto permanece apenas nos viewports em que a fileira não cabe.

Reaberto em 2026-08-26 depois que produção serviu o HTML novo junto de um CSS sem os seletores responsivos: a navegação completa ficou empilhada ao mesmo tempo que o botão do menu compacto. O contrato agora exige um fallback estrutural no próprio HTML e verifica altura, direção e exclusão mútua dos dois modos.

Retestado novamente em 2026-08-26T19:11Z–19:18Z no build limpo `a56a0c1`: 375×812, 812×375 e 768×1024 mantiveram somente o menu compacto; 1280×900 manteve somente os links horizontais. O cabeçalho mediu 57px e a largura do documento não excedeu a área útil em nenhum perfil, inclusive com nome de conta no limite permitido. Um caso adicional força o modo compacto em 1280×900 e confirma que botão e painel continuam utilizáveis.

**Reset 2026-08-28:** a regra de área segura do cabeçalho mudou somente em
telefone de toque com paisagem baixa. O cenário volta a `untested` como canário
para confirmar que a redução vertical não altera a exclusão entre navegação
completa e compacta, a rotação nem o posicionamento do popover.

**Reteste 2026-08-28:** o build de produção local manteve navegação compacta e
controles alinhados em 375×812, usou a fileira de 65px em 812×375 e não criou
overflow horizontal. A suíte E2E completa confirmou também tablet e desktop.
