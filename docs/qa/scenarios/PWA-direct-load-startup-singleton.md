---
id: PWA-direct-load-startup-singleton
area: PWA
title: Abrir diretamente com um único splash de startup
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: A carga direta conserva o splash de 900 ms e nunca empilha um overlay de transição durante hidratação
entry_points: /
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-08-23-task-02-loading-transicoes/CH-direct-startup-canary-goal.png
last_report: docs/qa/reports/2026-08-24-task-03-offline-shell.md
overlaps:
---

Canário adjacente para regressões no renderer inline, hidratação, locale e shell responsivo.

A URL direta e a recarga chegaram ao mesmo cockpit operável sem camada de transição residual.

Revalidado como canário adjacente no build isolado da Task 03.
