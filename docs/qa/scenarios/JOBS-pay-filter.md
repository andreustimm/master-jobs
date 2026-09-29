---
id: JOBS-pay-filter
area: JOBS
title: Filtrar e ordenar Vagas por faixa de pagamento na minha moeda
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: A faixa (mínimo e máximo) na moeda e no período escolhidos filtra vagas convertidas; pagamento não informado ou não comparável fica visível e marcado
entry_points: /jobs?pay=<min>&payMax=<max>&cur=USD&per=month; /jobs?sort=pay
qa_status: pass
bug_ids: BUG-20260929-jobs-cockpit-ignores-salary-filter; BUG-20260929-jobs-grouped-pay-banner-off-by-one
fix_status: fixed
retest_status: pass
fix_commits:
evidence: docs/qa/evidence/2026-09-21-docs-qa-jornada-do-quadro-filtrado/pay-disclosed-only-empty.png; docs/qa/evidence/2026-09-29-cockpit-contagens-filtros/CH-filtered-board-numbers-agree/jobs-pay-deep-link.png
last_report: docs/qa/reports/2026-09-29-cockpit-contagens-filtros.md
overlaps: JOBS-track-selector-fit
---

Ordenar por pagamento compara valores normalizados para o ano. Marcar "só
informado" tira as vagas sem pagamento. Valor inválido na URL mostra aviso e
ignora o filtro.

O controle é um slider de dois punhos sobre os mesmos dois campos: arrastar um
punho escreve só o campo dele, e o punho no fim da escala deixa o campo vazio,
que é "sem limite" — o placeholder do campo diz isso. Mínimo acima do máximo é
trocado, com aviso. O campo aceita até 2.000.000.

**Reset 2026-09-23 (#218):** a faixa salarial deixou de ser remontada por `key` (valores, período e moeda seguem a URL por dentro) e passou a se aplicar sozinha, inclusive ao trocar moeda ou período. Refazer a faixa invertida, o limpar e a troca de período digitando o valor logo depois.

Reteste targeted de #396 (29/09): a recarga preservou `pay=6000`,
`payMax=9000`, USD e mês na sessão manual; a área E2E `searches` passou os
casos de mínimo, faixa salarial, agrupamento, ordenação e recarga (`80/80`).
