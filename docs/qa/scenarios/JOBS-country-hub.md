---
id: JOBS-country-hub
area: JOBS
title: Escolher o país antes de abrir a vaga publicada em vários
persona: Andreus em triagem
journey: J-find-jobs-by-work-mode
expected: Clicar numa linha agrupada abre o hub com todas as publicações do grupo, e é lá que se escolhe o país
entry_points: /jobs/<id>/paises
qa_status: untested
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
