# CH-grouped-job-reaches-the-right-country: a linha agrupada nunca esconde vaga nem entrega o país errado

```yaml
charter:
  id: CH-grouped-job-reaches-the-right-country
  mission: "Procurar vaga aberta que o agrupamento torna inalcançável, e caminho que entrega um país escolhido pelo sistema em vez do pedido."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: desktop
    network: wifi-fast
    locale: pt-BR
  journey: J-trust-the-filtered-board
  scenarios:
    - JOBS-group-canonical-survives-filter
    - JOBS-anonymous-employer-never-groups
    - JOBS-country-hub
    - JOBS-group-repeated-countries
  tour: Feature Tour
  time_box_minutes: 90
  guidance:
    must_try:
      - "Com os padrões da tela (agrupamento ligado, corte em 45): achar uma linha agrupada e ligar `?unblocked=1`. Se a linha desaparecer havendo irmã sem bloqueador, é o defeito."
      - "Comparar a mesma busca com `?ungrouped=1`: toda vaga que aparece desagrupada e acima do corte tem de estar alcançável agrupada, direto ou pelo hub."
      - "Numa vaga cujo empregador é o nome da fonte (o quadro a marca como não nomeado): a linha NÃO pode ter fileira de bandeiras, e o hub dela lista só ela."
      - "Numa linha com mais de oito países, clicar no `+N`: o destino é o hub, nunca uma publicação."
      - "Procurar publicação sem localização na fileira: ela tem de ter rótulo legível, não um link vazio."
    must_avoid:
      - "Não misturar com os números do cockpit — é CH-filtered-board-numbers-agree."
```

<!-- O charter é durável e imutável: reexecute em ciclos seguintes; o debrief de cada execução vai no relatório daquela execução (Session Debriefs), nunca aqui. -->
