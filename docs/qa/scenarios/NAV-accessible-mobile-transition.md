---
id: NAV-accessible-mobile-transition
area: NAV
title: Navegar com teclado e viewport móvel
persona: Candidato por teclado
journey: J-switch-workspace-screen
expected: Um live status atômico anuncia a fase, o shell fica inerte e o overlay não prende foco nem transborda
entry_points: /jobs
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-keyboard-screen-transition-mobile-en.png
last_report: docs/qa/reports/2026-08-24T143638469000Z-8c1fe201-navigation-contract-retest.md
overlaps:
---

Cobertura: acessibilidade, 375 px, zoom, safe areas, temas e movimento reduzido.

Walkthrough público cobriu teclado no desktop, menu por toque em 375×812 e retorno/avanço do histórico. Leitor de tela, safe-area sintética e zoom ficam qualificados pela cobertura automatizada do mesmo build.

Revalidado na Task 04 com menu móvel, foco, live region, viewport de 375×812, zoom equivalente a 200%, temas e movimento reduzido.

Revalidado em iPhone 15 emulado com menu por toque, fechamento no destino e `scrollWidth` igual a `innerWidth` (393 px); árvore acessível, zoom, temas e movimento reduzido passaram no E2E do mesmo commit.

O ajuste posterior que restaurou pinch zoom no overlay reiniciou este cenário para `untested`. O navegador automatizado prova o `touch-action` computado e a contenção em 200%, mas a sessão da persona será repetida no Full QA de staging.
