---
id: JOBS-group-canonical-survives-filter
area: JOBS
title: Grupo de países não desaparece porque uma das publicações foi cortada
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Se uma publicação do grupo passa pelos filtros, o grupo aparece — representado por ela, e não pela que foi cortada
entry_points: /jobs; /jobs?unblocked=1; /jobs?fit=60
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report: docs/qa/reports/2026-09-21-execucao-concorrencia.md
overlaps: JOBS-group-repeated-countries; JOBS-score-range
---

Nasce da revisão profunda de 2026-09-21, que achou o defeito com a suíte inteira
verde.

A publicação que representa o grupo era a de **menor id entre todas as
abertas**, escolhida por um anti-join que não conhecia os filtros do quadro —
`minFit`, `unblocked`, termo e frescor moram no `where` de fora. Quando a de
menor id era justamente a que falhava um filtro, todas as irmãs falhavam o teste
de canônica e **o grupo inteiro saía da tela**, mesmo com uma irmã casando tudo.
E como a contagem compartilha o predicado, o rodapé concordava com a lista: nada
parecia errado.

O gatilho era a tela padrão, não uma URL exótica: agrupamento ligado por omissão
e corte em 45. Geo vale 15 dos 100 pontos e sai da localização, então duas
publicações do mesmo grupo caem rotineiramente em lados opostos do corte. Com
`?unblocked=1` era determinístico em vez de provável — o bloqueador vem da
restrição de local, logo a publicação on-site nos EUA de um grupo é exatamente a
que o filtro remove, e ela levava a irmã remota embora.

A conferir:

- Numa vaga publicada em vários países onde pelo menos uma publicação está acima
  do corte: a linha aparece, e o título leva ao hub do grupo.
- A publicação mostrada é uma que passa pelo filtro, não a que foi cortada.
- Ligar "sem bloqueadores" não faz a linha desaparecer quando existe irmã sem
  bloqueador.
- Subir o corte acima de todas as publicações do grupo faz a linha sair — isto é
  correto, e é o que separa "não suprimir" de "ressuscitar".
- O número do rodapé continua igual ao que a lista mostra.

## Passada manual em 2026-09-21: driver não conclui, produto tem cobertura verde

A fixture existe desde esta data, e o quadro mostra a linha agrupada. A navegação
até o hub **não pôde ser confirmada pela interface**: o clique no título respondeu
`✓ Done` e a tela permaneceu em `heading "Jobs"`.

Não é possível, daqui, distinguir "o link não navega" de "o clique não agiu" — e a
segunda hipótese tem precedente registrado neste driver. Por isso o veredito é
`Blocked (needs human verify)` e não `Fail`: afirmar defeito sem essa distinção
seria inventar um.

**O que se sabe do produto, por outra via:** `term-search E2E-014` verifica que
`[data-testid="job-link-<id>"]` aponta para `/jobs/<id>/paises`, que a linha
agrupada não tem botões de ação, e que o hub lista as quatro publicações. Ele
**passou** na última execução da suíte, em Chromium real. O caminho que este
cenário descreve está coberto e verde ali.

O que falta aqui é a confirmação em persona, pela interface, que é o que este
cenário existe para dar — e para isso é preciso um driver que navegue de forma
confiável, ou uma pessoa.

**Para quem for fechar à mão:** entre em `/jobs` com a conta `alex@local.test`,
clique no título "Engineering Manager Country Fixture" e confirme que a URL vira
`/jobs/<id>/paises` e que o hub lista as quatro publicações — Netherlands, France
e as duas do Brasil.
