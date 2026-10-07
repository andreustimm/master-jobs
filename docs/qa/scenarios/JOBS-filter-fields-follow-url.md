---
id: JOBS-filter-fields-follow-url
area: JOBS
title: Campo de filtro mostra o que a URL diz, mesmo depois de navegação suave
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Depois de limpar, de um preset ou de uma faixa trocada pelo servidor, os campos mostram o estado atual — e o Aplicar seguinte não ressuscita o valor antigo
entry_points: /jobs; /jobs?pay=12000&payMax=6000; /jobs?fit=45
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-10-07-qa-492-funil-seletores.md; docs/qa/evidence/2026-10-07-qa-492-funil-seletores/jobs-score-invertido-60-80.png
last_report: docs/qa/reports/2026-10-07-qa-492-funil-seletores.md
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

**Reset 2026-09-23 (#218):** os campos de busca, empresa, Score e faixa salarial deixaram de ser remontados por `key` a cada resposta; agora seguem a URL por `useAppliedValue`, que só preserva texto ainda não enviado no campo em foco. Refazer os quatro caminhos acima (faixa invertida, limpar, preset, fontes), agora também com o filtro aplicado sozinho, e conferir que a digitação em curso não é apagada pela resposta anterior (`JOBS-filters-auto-apply`).

**QA 07/10 (canária da #492, `fix/funil-seletores` com `961558d`, que muda
`useAppliedValue`; ambiente isolado, sem refresh entre os passos): `pass`.**
`?pay=12000&payMax=6000` aberto mostra o aviso e 6000/12000. Faixa invertida
igual à já aplicada — salário 6000–12000 com 12000/6000 digitado e score 60–80
com 80/60 —: aviso, campos e controle deslizante na ordem certa, e o Aplicar
seguinte envia o par certo sem aviso. "Limpar" do salário deixa os campos
vazios e nem o Aplicar do salário nem o do Score o ressuscitam. "Aplicável
hoje" leva o mínimo de 70 para 60 e esvazia o máximo; o Aplicar seguinte mantém
60. Duas fontes marcadas, "limpar" e Voltar deixam zero marcadas, e marcar uma
depois aplica só ela. Termo digitado logo depois de um Aplicar do Score, com a
resposta a caminho, ficou no campo e foi aplicado (a janela da corrida não é
controlável pelo driver; tentado, não provado). Relatório:
`docs/qa/reports/2026-10-07-qa-492-funil-seletores.md`.

**Reset 2026-10-07 (#494, PR #499):** o campo vazio do teto (Score e faixa
salarial) deixou de ir para a URL — o Aplicar não manda mais `fitMax=` nem
`payMax=` —, e `?fit=abc` ou `?fitMax=abc` agora mostra aviso, com o valor
ilegível ignorado (o teto não vira 100). Refazer limpar, preset e faixa
invertida conferindo que a URL não carrega teto vazio, e abrir `/jobs?fit=abc`
e `/jobs?fitMax=abc`: aviso visível, corte padrão e teto vazio.
