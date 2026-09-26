# CH-filtered-board-numbers-agree: todo número na tela descreve a lista ao lado dele

```yaml
charter:
  id: CH-filtered-board-numbers-agree
  mission: "Procurar número que conta um quadro diferente do que está listado ao lado dele — no cockpit, no rodapé, nos chips e no aviso de faixa salarial."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: desktop
    network: wifi-fast
    locale: pt-BR
  journey: J-trust-the-filtered-board
  scenarios:
    - JOBS-cockpit-count-matches-list
    - JOBS-score-range
    - JOBS-employer-filter
    - JOBS-hide-already-sent
    - JOBS-pay-filter
  tour: Money Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Abrir `/` e `/jobs` com a MESMA URL de filtro e comparar o número dos dois: a mesma pergunta não pode ter duas respostas."
      - "Digitar um empregador no cockpit — o campo é renderizado lá — e ver se o número cai junto com a lista."
      - "Com agrupamento ligado (o padrão), conferir se algum chip mostra número maior que o total exibido ao lado dele."
      - "Pôr faixa salarial e ler o aviso de quantas ficaram fora: somar com o total tem de fazer sentido."
      - "Clicar em cada card do topo do cockpit, no padrão e com `?fit=60&workMode=remote`, e comparar o número do card com o total de `/jobs` (ou com 'Todos' em `/pipeline`); digitar empresa e faixa de Score no cockpit antes, para ver que o link da faceta não as carrega."
    must_avoid:
      - "Não entrar na tela de skills nem na de nova trilha: elas são o charter de concorrência, e misturar dilui o achado."
      - "Não tentar cobrir o hub de países aqui — é CH-grouped-job-reaches-the-right-country."
```

<!-- O charter é durável e imutável: reexecute em ciclos seguintes; o debrief de cada execução vai no relatório daquela execução (Session Debriefs), nunca aqui. -->
