---
id: JOBS-group-canonical-survives-filter
area: JOBS
title: Grupo de países não desaparece porque uma das publicações foi cortada
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Se uma publicação do grupo passa pelos filtros, o grupo aparece — representado por ela, e não pela que foi cortada
entry_points: /jobs; /jobs?unblocked=1; /jobs?fit=60
qa_status: blocked
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
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

## Bloqueado por ausência de fixture no ambiente manual (2026-09-21)

`tests/e2e/setup-manual.ts` semeia **uma única vaga** — "Senior Software
Architect", Aurora Sistemas, `Remoto · Brasil`, empregador nomeado, um país. O
quadro confirma: `NO BLOCKERS · 1`, `NAMED EMPLOYER · 1`.

Este cenário precisa de vaga publicada em vários países (e, no caso do empregador
anônimo, de uma cujo empregador seja o nome da fonte). Nenhuma existe ali, então
não há o que percorrer — o veredito não é "passou" nem "falhou", é que o ambiente
de paridade não oferece o estado.

O `setup.mjs` do E2E automatizado **tem** essas fixtures (`904000101` com quatro
publicações). Desbloquear é levá-las para o `setup-manual.ts`, e isso é mudança de
código, não de execução de QA.
