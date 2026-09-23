---
id: JOBS-country-only-blocked
area: JOBS
title: Vaga restrita a países fora do meu alcance aparece bloqueada
persona: Andreus em triagem
journey: J-save-term-search
expected: Vaga com localização "United States only" ou "Spain only" mostra o bloqueio de elegibilidade e some de "Aplicáveis hoje"; vaga cuja lista inclui Brasil ou LATAM continua sem bloqueio
entry_points: /jobs; /jobs?unblocked=1; /jobs/<id>
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/log.txt
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: JOBS-track-selector-fit
---

A Himalayas publica quem pode se candidatar, e o sistema grava isso como
"<países> only". Depois de `jho jobs score --all`, a vaga só dos EUA mostra o
bloqueador no detalhe e não entra no preset "Aplicáveis hoje". Localização sem
"only" continua sem bloqueio.

Full 1.22.0 (2026-09-22): Vaga cadastrada com 'United States only' fica bloqueada e fora de Aplicáveis hoje; 'Remote — Brazil or LATAM' entra. 'Spain only' não foi testado.
