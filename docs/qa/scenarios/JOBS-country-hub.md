---
id: JOBS-country-hub
area: JOBS
title: Escolher o país antes de abrir a vaga publicada em vários
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Clicar numa linha agrupada abre o hub com todas as publicações do grupo, e é lá que se escolhe o país
entry_points: /jobs/<id>/paises
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report: docs/qa/reports/2026-09-21-execucao-concorrencia.md
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
