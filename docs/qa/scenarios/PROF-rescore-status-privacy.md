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
last_report: docs/qa/reports/2026-09-10T011143000000Z-8bd417c2-supabase-production.md
overlaps:
---

Varre empty/error, privacidade entre candidatos, responsividade, compatibilidade de locale e recuperação por nova tentativa. Acessibilidade é exercida pelo status semântico e pela canária de navegação por teclado.

Migração PostgreSQL: repetir a jornada; evidências anteriores são históricas.

10/09/2026: CH-private-ranking-recovery confirmou por login real e reload
a falha segura de Carla e o estado sem tarefa de Bruno, sem mistura de CVs.
Capturas da rodada supabase-production em 375×812 e 812×375 mostram o card
legível; não cobre rede flaky, Safari físico nem recuperação do worker.
