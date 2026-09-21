# CH-filtered-board-fields-follow-url: o campo mostra o que a URL diz, sem refresh

```yaml
charter:
  id: CH-filtered-board-fields-follow-url
  mission: "Procurar campo de filtro que guarda o valor antigo depois de uma navegação suave, e o Aplicar seguinte que ressuscita o filtro que a pessoa acabou de limpar."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: desktop
    network: wifi-fast
    locale: pt-BR
  journey: J-trust-the-filtered-board
  scenarios:
    - JOBS-filter-fields-follow-url
    - JOBS-pay-filter
    - JOBS-score-range
    - JOBS-source-multi-select
  tour: Back-Button Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "NUNCA dar refresh entre os passos: o refresh remonta a ilha e esconde exatamente este defeito — foi por isso que a suíte de browser ficava verde."
      - "Colar `?pay=12000&payMax=6000`: o servidor troca os lados e avisa; os campos têm de mostrar a faixa já na ordem certa, e o Aplicar seguinte não pode reenviar o par invertido."
      - "Preencher a faixa, aplicar, clicar em limpar, e apertar Aplicar de novo sem tocar em mais nada."
      - "Clicar num atalho de corte e olhar o campo de Score: ele tem de passar a mostrar o corte do atalho."
      - "Marcar duas fontes, aplicar, limpar fontes: as marcas dos checkboxes têm de sumir (é DOM não controlado, sofre o mesmo)."
    must_avoid:
      - "Não usar o botão Voltar do navegador como único caminho: o alvo aqui é a navegação suave da própria barra."
```

<!-- O charter é durável e imutável: reexecute em ciclos seguintes; o debrief de cada execução vai no relatório daquela execução (Session Debriefs), nunca aqui. -->
