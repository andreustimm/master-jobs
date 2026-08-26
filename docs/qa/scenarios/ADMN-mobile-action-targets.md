---
id: ADMN-mobile-action-targets
area: ADMN
title: Usar ações administrativas sem alvos pequenos no celular
persona: Andreus no celular
journey: J-switch-workspace-screen
expected: Os controles de editar, ativar/desativar, assumir identidade e excluir permanecem confortáveis para toque em retrato e paisagem
entry_points: /admin/users
qa_status: pass
bug_ids:
fix_status: fixed
retest_status: pass
fix_commits:
evidence: tests/e2e/ui.mjs; tests/mobile.test.ts
last_report: docs/qa/reports/2026-08-26T023000000000Z-mobile-responsive-targeted.md
overlaps: NAV-first-party-navigation-contract
---

Em 375×812 e 812×375, cada ação visível da lista de usuários mantém pelo menos
44px de altura, quebra para uma nova linha quando necessário e não aumenta a
largura da página. Em telas maiores os mesmos controles voltam à densidade
compacta do sistema sem perder o alvo acessível.
