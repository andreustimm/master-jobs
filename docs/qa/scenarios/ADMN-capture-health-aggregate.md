---
id: ADMN-capture-health-aggregate
area: ADMN
title: Ler a saúde das capturas sem ver termos nem candidatos
persona: Andreus em triagem
journey: J-monitor-term-capture-health
expected: Um cartão por plataforma mostra cotas, capturas das últimas 24 horas e último erro; sessão emprestada e candidato sem papel admin são recusados
entry_points: /admin/captures
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22T103914934977Z-a59f3329-capturas-concorrentes/CH-capture-health-glance-baseline-aggregate.png; evidence/2026-09-22T103914934977Z-a59f3329-capturas-concorrentes/CH-capture-health-glance-baseline-borrowed-denied.png; evidence/2026-09-22T103914934977Z-a59f3329-capturas-concorrentes/CH-capture-health-glance-baseline-candidate-denied.png
last_report: docs/qa/reports/2026-09-22T103914934977Z-a59f3329-capturas-concorrentes.md
overlaps: SRCH-borrowed-session-waits-sweep
---

Plataforma com falhas seguidas aparece em atenção. Nenhum termo, trilha ou
nome de candidato aparece na tela nem no HTML.
