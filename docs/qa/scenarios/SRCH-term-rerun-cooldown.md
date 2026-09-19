---
id: SRCH-term-rerun-cooldown
area: SRCH
title: Rodar um termo de novo e saber quando poderá repetir
persona: Andreus em triagem
journey: J-save-term-search
expected: Dentro de 24 horas o botão mostra quando o termo pode buscar de novo; fora dele, a busca recomeça
entry_points: /searches
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: SRCH-save-term-from-jobs
---

Rodar de novo logo depois de salvar e ler o horário informado. Plataforma
que já buscou o termo hoje (inclusive por outro candidato) aparece como
reaproveitada, sem nova chamada.
