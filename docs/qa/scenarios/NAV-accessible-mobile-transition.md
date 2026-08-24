---
id: NAV-accessible-mobile-transition
area: NAV
title: Navegar com teclado e viewport móvel
persona: Candidato por teclado
journey: J-switch-workspace-screen
expected: Um live status atômico anuncia a fase, o shell fica inerte e o overlay não prende foco nem transborda
entry_points: /jobs
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-08-23-task-02-loading-transicoes/CH-mobile-transition-recovery-goal.png
last_report: docs/qa/reports/2026-08-23-task-02-loading-transicoes.md
overlaps:
---

Cobertura: acessibilidade, 375 px, zoom, safe areas, temas e movimento reduzido.

Walkthrough público cobriu teclado no desktop, menu por toque em 375×812 e retorno/avanço do histórico. Leitor de tela, safe-area sintética e zoom ficam qualificados pela cobertura automatizada do mesmo build.
