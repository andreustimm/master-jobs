---
id: JOBS-filter-fields-follow-url
area: JOBS
title: Campo de filtro mostra o que a URL diz, mesmo depois de navegação suave
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Depois de limpar, de um preset ou de uma faixa trocada pelo servidor, os campos mostram o estado atual — e o Aplicar seguinte não ressuscita o valor antigo
entry_points: /jobs; /jobs?pay=12000&payMax=6000; /jobs?fit=45
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/log.txt
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: JOBS-pay-filter; JOBS-score-range; JOBS-source-multi-select
---

Nasce da revisão profunda de 2026-09-21, e é o tipo de defeito que só a interface
mostra: a suíte de browser ficava verde porque lia os campos **depois de um
refresh**, que remonta a ilha.

Os campos da faixa nascem de `useState`, e o inicializador só é lido na
montagem. Toda navegação da barra de filtros é suave, então ir de um filtro para
outro reconcilia a mesma posição da árvore e a ilha **não remonta**: os campos
continuam mostrando o que mostravam, mesmo quando a URL e o quadro já dizem
outra coisa. Pior, o Aplicar seguinte reenvia o valor velho.

Três caminhos do fluxo normal chegavam nisso:

1. **Faixa invertida.** `?pay=12000&payMax=6000` é trocada no servidor, com
   aviso. Os campos seguiam em 12000/6000 e o Aplicar reenviava o par invertido:
   o aviso nunca saía e a URL nunca estabilizava.
2. **Limpar.** O "limpar" tira os parâmetros da URL; os campos mantinham os
   números e o Aplicar seguinte ressuscitava o filtro recém-limpo.
3. **Presets de corte.** Depois de "Aplicável hoje" o quadro filtra em 60 e o
   campo de Score continuava em 45 — e o Aplicar do Score desfazia o preset.

O mesmo vale, em DOM não controlado, para as marcas do combo de fontes.

A conferir, **sem refresh entre os passos** (é isso que o teste automatizado não
fazia):

- Abrir `?pay=12000&payMax=6000`: o aviso aparece e os campos mostram a faixa já
  na ordem certa.
- Preencher a faixa, aplicar, clicar em "limpar": os campos ficam vazios e o
  Aplicar seguinte não traz o filtro de volta.
- Clicar num preset de corte: o campo de Score passa a mostrar o corte do preset.
- Marcar duas fontes, aplicar, limpar fontes: as marcas somem.
- Em todos os casos, o que a URL diz e o que o campo mostra são a mesma coisa.

**Reset 2026-09-22 (#220):** a navegação de filtro deixou de tornar o shell `inert`, então agora dá para editar um campo enquanto a resposta anterior ainda chega. Conferir que o campo mostra a URL depois do commit e que o último Aplicar vence.

Full 1.22.0 (2026-09-22): Preset leva o campo mínimo ao valor da URL; Aplicar em seguida não ressuscita valor antigo; 70 aplicado e Voltar devolve 60 no campo. Limpar não foi exercitado.
