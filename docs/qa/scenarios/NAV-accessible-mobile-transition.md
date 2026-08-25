---
id: NAV-accessible-mobile-transition
area: NAV
title: Navegar com teclado e viewport móvel
persona: Candidato por teclado
journey: J-switch-workspace-screen
expected: Um live status atômico anuncia a fase, o shell fica inerte e o overlay não prende foco nem transborda
entry_points: /jobs
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/keyboard-pipeline-focus.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/keyboard-pipeline-goal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/operador-teclado-vagas-focus.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/operador-teclado-vagas-goal.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Cobertura: acessibilidade, 375 px, zoom, safe areas, temas e movimento reduzido.

Walkthrough público cobriu teclado no desktop, menu por toque em 375×812 e retorno/avanço do histórico. Leitor de tela, safe-area sintética e zoom ficam qualificados pela cobertura automatizada do mesmo build.

Revalidado na Task 04 com menu móvel, foco, live region, viewport de 375×812, zoom equivalente a 200%, temas e movimento reduzido.

Revalidado em iPhone 15 emulado com menu por toque, fechamento no destino e `scrollWidth` igual a `innerWidth` (393 px); árvore acessível, zoom, temas e movimento reduzido passaram no E2E do mesmo commit.

O Full QA repetiu teclado, destino e reload com a persona atribuída e com o Operador em pt-BR. O cenário fica Blocked até confirmar pinch e VoiceOver em iPhone físico: heading anunciado uma vez e foco fora do splash.
