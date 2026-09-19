---
id: JOBS-pay-filter
area: JOBS
title: Filtrar e ordenar Vagas pelo pagamento na minha moeda
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: O piso na moeda e no período escolhidos filtra vagas convertidas; pagamento não informado ou não comparável fica visível e marcado
entry_points: /jobs?pay=<valor>&cur=USD&per=month; /jobs?sort=pay
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-track-selector-fit
---

Ordenar por pagamento compara valores normalizados para o ano. Marcar "só
informado" tira as vagas sem pagamento. Valor inválido na URL mostra aviso e
ignora o filtro.
