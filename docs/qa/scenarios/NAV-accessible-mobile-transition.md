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
evidence: tests/e2e/ui.mjs
last_report: docs/qa/reports/2026-08-24-task-04-first-party-navigation.md
overlaps:
---

Cobertura: acessibilidade, 375 px, zoom, safe areas, temas e movimento reduzido.

Walkthrough público cobriu teclado no desktop, menu por toque em 375×812 e retorno/avanço do histórico. Leitor de tela, safe-area sintética e zoom ficam qualificados pela cobertura automatizada do mesmo build.

Revalidado na Task 04 com menu móvel, foco, live region, viewport de 375×812, zoom equivalente a 200%, temas e movimento reduzido.
