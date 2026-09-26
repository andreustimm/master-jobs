---
id: JOBS-cockpit-count-matches-list
area: JOBS
title: O número da tela inicial conta o mesmo quadro que ela mostra
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: O "N vagas" do cockpit reflete os filtros aplicados e concorda com /jobs na mesma URL; cada card de contagem abre a lista que ele conta, com o mesmo número
entry_points: /; /?company=Acme; /?notApplied=1; /?fitMax=70; /?fit=60&workMode=remote
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-21-docs-qa-jornada-do-quadro-filtrado/numbers-agree-empty-employer.png
last_report: 2026-09-21-docs-qa-jornada-do-quadro-filtrado
overlaps: JOBS-employer-filter; JOBS-score-range; JOBS-hide-already-sent
---

Nasce da revisão profunda de 2026-09-21.

O cockpit listava com o conjunto completo de filtros e contava com cinco campos
apenas — o número saía das facetas, e as facetas anulam cada dimensão na própria
contagem **de propósito** (escolher uma fonte não pode deixar só ela para
escolher). Ou seja: o número respondia outra pergunta.

Dois gatilhos, um deles aberto por omissão. Digitado: `/?company=Acme` cortava a
lista e deixava o número no total sem filtro, porque o campo de empresa, a faixa
de Score e o "ainda não enviadas" são renderizados no cockpit também. Padrão: com
vagas repetidas agrupadas, a lista mostra uma por grupo e as facetas contavam
cada publicação — os dois números divergiam antes de alguém tocar em nada.

`/jobs` nunca teve o problema, porque tira o número de outra consulta. A mesma
pergunta tinha duas respostas em duas telas, o que a invariante de "UI é
adaptador" proíbe.

A conferir:

- Abrir `/` sem filtro: o número ao lado de "mais aderentes" e o número de
  `/jobs` com a mesma URL são iguais.
- Digitar um empregador no cockpit: o número cai junto com a lista.
- Ligar "ainda não enviadas" e mexer na faixa de Score: idem.
- Os contadores dos chips continuam oferecendo o que cada opção renderia — eles
  não viram cópias do total.
- Nenhum chip mostra número maior que o total exibido ao lado dele.

**Reset 2026-09-25 (#314):** os cards do topo viraram links. A conferir, no
padrão e com `/?fit=60&workMode=remote`:

- "Vagas abertas", "empresa nomeada", "sem bloqueio" e "últimos 3 dias": o
  número do card é o total que `/jobs` mostra ao abrir o link, e o chip do card
  chega ligado (e desliga). Os de faceta não levam empresa, faixa de Score,
  faixa salarial nem "ainda não enviadas" digitados no cockpit.
- "Melhor fit" abre a vaga cuja nota é a do card; sem nota, o card não é link.
- "No funil" abre `/pipeline`, e o card "Todos" mostra o mesmo número.
- "Empresas" não tem hover, seta nem link.
- Teclado: Tab alcança cada card com foco visível e Enter navega; em 375px a
  faixa não estoura; passar o mouse mostra de que conjunto o número fala.
