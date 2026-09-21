---
id: JOBS-score-range
area: JOBS
title: Pedir uma faixa de Score em vez de um corte
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Pedir de 60 a 80 mostra só vagas nessa faixa, arrastando ou digitando, e o campo recusa nota fora de 0 a 100
entry_points: /jobs?fit=60&fitMax=80
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-09-21-docs-qa-jornada-do-quadro-filtrado.md
last_report: docs/qa/reports/2026-09-21-docs-qa-jornada-do-quadro-filtrado.md
overlaps: JOBS-pay-filter
---

O antigo "corte" com botões prontos (45+/55+/60+/70+) virou "Score" com
mínimo e máximo, no mesmo controle da faixa salarial.

A conferir: digitar 250 no campo resulta em 100 e digitar um negativo resulta
em 0; campo vazio é "toda nota" e o placeholder diz qual é o limite (0 e 100);
mínimo acima do máximo é trocado com aviso; `fit=abc` na URL não derruba a
página — ela respondia 500 antes.
