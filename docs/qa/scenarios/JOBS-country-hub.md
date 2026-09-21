---
id: JOBS-country-hub
area: JOBS
title: Escolher o país antes de abrir a vaga publicada em vários
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Clicar numa linha agrupada abre o hub com todas as publicações do grupo, e é lá que se escolhe o país
entry_points: /jobs/<id>/paises
qa_status: blocked
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-group-repeated-countries
---

A linha agrupada representa N publicações, e antes disto o clique entregava
uma: a de menor id, que é escolha de ordenação e não de produto. Quem clicava em
"Engineering Manager" com sete bandeiras abria a vaga na Holanda sem ter pedido
a Holanda.

A âncora da URL é **qualquer publicação do grupo**, não um id de grupo: o
agrupamento é de apresentação e não há registro para apontar.

A conferir:

- O título da linha agrupada leva a `/jobs/<id>/paises`, não a `/jobs/<id>`.
- **O `+N` da fileira de bandeiras leva ao hub também.** Ele apontava para a
  publicação canônica — o mesmo destino da primeira bandeira —, então pedir "os
  outros 34 países" abria um país escolhido pela ordenação. A tela de detalhe não
  lista país nenhum, logo ela nunca é a resposta dessa pergunta. Só aparece com
  mais de oito países, e o acervo tem uma vaga em 42.
- **Publicação sem localização nenhuma** aparece com rótulo do dicionário ("sem
  localização"), não como um link vazio: ela é uma vaga aberta de verdade e tem
  de ser alcançável, e um leitor de tela precisa de nome para anunciar.
- A linha agrupada **não** mostra "Vaga", "Site", "Aplicar" nem "não me
  interessa": as quatro agem sobre uma publicação, e ali não há uma, há N.
- O hub mostra o título, o empregador e quantos países e anúncios existem.
- Cada publicação traz o próprio país, a própria nota, o próprio salário e o
  próprio estado no funil — que é justamente o que pode divergir entre elas.
- Chegar pelo hub por qualquer publicação do grupo dá a mesma lista.
- Publicação com localização que não resolve para país aparece com a
  localização crua, e o cabeçalho diz quantas são.
- `/jobs/<id>/paises` de uma vaga que não existe, ou de id não numérico,
  responde **404**, não 500.
- Quando a publicação que ancora o link fecha, o link dá 404 — a regra 3 guarda
  o registro, não a vitrine.

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
