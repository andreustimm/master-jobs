---
id: NAV-failed-screen-retry
area: NAV
title: Recuperar uma navegação que falhou
persona: Candidato após falha
journey: J-switch-workspace-screen
expected: O overlay libera uma mensagem localizada sem detalhe técnico e tentar novamente chega ao destino
entry_points: /jobs
qa_status: skipped
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report: docs/qa/reports/2026-08-23-task-02-loading-transicoes.md
overlaps:
---

Cobertura: falha, redação de exceção, recuperação e ausência de estado residual.

Skipped no dogfooding: não existe uma ação pública legítima que provoque falha de render sob demanda. O build isolado verificou E2E-009 com fixture; usar a fixture como persona violaria a regra de interface pública.
