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
evidence: tests/e2e/ui.mjs; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-direct-startup-canary.webm; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-direct-startup-canary-final.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/candidato-transito-direct.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Canário adjacente para regressões no renderer inline, hidratação, locale e shell responsivo.

A URL direta e a recarga chegaram ao mesmo cockpit operável. O Full QA repetiu o percurso em 375×812 pela persona Candidato em trânsito, sem overflow nem camada residual.

Revalidado como canário adjacente no build isolado da Task 03.

Revalidado novamente na Task 04 contra login, recovery, callback e perfil público: carga direta manteve apenas o splash de startup e navegação suave manteve apenas a camada de transição.
