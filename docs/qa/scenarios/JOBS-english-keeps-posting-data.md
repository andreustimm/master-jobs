---
id: JOBS-english-keeps-posting-data
area: JOBS
title: Interface em inglês mantém o texto do anúncio como ele veio
persona: Recrutadora convidada
journey: J-trust-the-filtered-board
expected: Com a interface em inglês, a localização e o nome da vaga continuam como o anúncio escreveu — inclusive com acento — e nada da interface aparece em português
entry_points: /jobs; /jobs/<id>; /jobs/<id>/paises
qa_status: pass
bug_ids: BUG-20260921-job-detail-labels-untranslated
fix_status: fixed
retest_status: verified
fix_commits:
evidence: docs/qa/reports/2026-09-21-execucao-ingles-detalhe.md
last_report: 2026-09-21-execucao-ingles-detalhe
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

## O terceiro lugar, achado em 2026-09-21

A primeira execução deste cenário acrescentou `/jobs/<id>` aos pontos de entrada,
porque a jornada passa por lá: quem filtra o quadro clica numa vaga. E a tela de
detalhe tinha as duas metades do problema ao mesmo tempo — três textos de
interface como literal no JSX (`← vagas`, `Ver vaga na origem`, `visto em`,
servidos em português com a interface em inglês) e o dado do anúncio sem
`data-user-content` no nome da empresa, na localização e no rótulo da fonte.

As duas metades se protegiam: sem a marca, a rota não podia entrar na varredura
(o acento legítimo do acervo reprovaria); fora da varredura, ninguém veria os
rótulos. `docs/qa/bugs/BUG-20260921-job-detail-labels-untranslated.md` tem a
medição.

O que este cenário passou a exigir, por isso:

- Todo ponto de entrada da jornada entra na verificação — inclusive o que só se
  alcança clicando, não digitando a URL.
- Ausência de acento na tela **não** é prova de nada: a rota precisa de fixture
  com localização acentuada, senão a verificação passa por não ter o que medir.
- A recíproca também: rota em que o dado do usuário não está marcado só pode
  entrar depois da marca, e pular esse passo troca um defeito por um falso
  positivo permanente.
