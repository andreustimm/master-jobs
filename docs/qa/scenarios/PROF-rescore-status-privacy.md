---
id: PROF-rescore-status-privacy
area: PROF
title: Exibir estado privado e falha segura da repontuação
persona: Candidato após falha
journey: J-refresh-candidate-ranking
expected: Cada sessão vê somente sua própria fila, com idle ou falha localizada sem erro interno e sem overflow nos viewports suportados
entry_points: /candidate
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-08-25T214402000000Z-fb9a9b34-rescore-status-targeted/failed-safe-mobile.png; docs/qa/evidence/2026-08-25T214402000000Z-fb9a9b34-rescore-status-targeted/failed-safe-landscape.png; docs/qa/evidence/2026-08-25T214402000000Z-fb9a9b34-rescore-status-targeted/idle-private-mobile.png; tests/e2e/ui.mjs
last_report: docs/qa/reports/2026-08-25T214402000000Z-fb9a9b34-rescore-status-targeted.md
overlaps:
---

Varre empty/error, privacidade entre candidatos, responsividade, compatibilidade de locale e recuperação por nova tentativa. Acessibilidade é exercida pelo status semântico e pela canária de navegação por teclado.
