---
id: JOBS-english-keeps-posting-data
area: JOBS
title: Interface em inglês mantém o texto do anúncio como ele veio
persona: Recrutadora convidada
journey: J-trust-the-filtered-board
expected: Com a interface em inglês, a localização e o nome da vaga continuam como o anúncio escreveu — inclusive com acento — e nada da interface aparece em português
entry_points: /jobs; /jobs/<id>/paises
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-country-hub; JOBS-group-repeated-countries
---

Nasce de um defeito achado por uma guarda nova, no primeiro uso dela.

A verificação de vazamento de português reprova por dois critérios: texto que **é**
valor do dicionário português, e texto com acento. Dado do anúncio fica de fora
por `data-user-content` — o currículo tem "São Paulo" e continua tendo em inglês.

A localização da vaga **não tinha a marca**, em dois lugares: na linha da lista
quando a vaga não é agrupada, e no popover de detalhe, que está no DOM mesmo
fechado e portanto aparece em toda tela com lista. Nenhuma das rotas varridas
tinha fixture com acento na localização, então os dois passaram desde que
existem. Bastou `/jobs/<id>/paises` entrar na varredura para os dois caírem.

A conferir, com a interface em inglês:

- A localização de uma vaga com acento — "São Paulo, State of São Paulo, Brazil" —
  aparece **como veio**, sem tradução e sem ser sinalizada.
- O mesmo dentro do popover da vaga, que a varredura enxerga mesmo fechado.
- Nada da INTERFACE aparece em português: rótulo, botão, aviso, cabeçalho.
- No hub dos países, o mesmo vale para o título, o empregador e a localização de
  cada publicação.
- O contraste que dá sentido à regra: se alguém traduzir mal um rótulo, a
  verificação tem de reprovar — a isenção é para dado do usuário, não para
  esconder tradução faltando.
