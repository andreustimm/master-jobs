---
id: JOBS-cockpit-count-matches-list
area: JOBS
title: O número da tela inicial conta o mesmo quadro que ela mostra
persona: Andreus em triagem
journey: J-refresh-candidate-ranking
expected: O "N vagas" do cockpit reflete os filtros aplicados, e concorda com o que /jobs diz para a mesma URL
entry_points: /; /?company=Acme; /?notApplied=1; /?fitMax=70
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
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
