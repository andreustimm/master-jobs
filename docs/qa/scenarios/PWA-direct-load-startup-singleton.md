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
evidence: tests/e2e/ui.mjs
last_report: docs/qa/reports/2026-08-24-task-04-first-party-navigation.md
overlaps:
---

Canário adjacente para regressões no renderer inline, hidratação, locale e shell responsivo.

A URL direta e a recarga chegaram ao mesmo cockpit operável sem camada de transição residual.

Revalidado como canário adjacente no build isolado da Task 03.

Revalidado novamente na Task 04 contra login, recovery, callback e perfil público: carga direta manteve apenas o splash de startup e navegação suave manteve apenas a camada de transição.
