# CH-filter-pipeline: achar a candidatura certa no funil filtrado

```yaml
charter:
  id: CH-filter-pipeline
  mission: "Como Andreus em triagem noturna, estreitar o funil por texto, empresa, canal e score sem perder o estágio, confiar nos contadores e reabrir a mesma visão por link, refresh e voltar."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem noturna
    device: laptop e celular de 375 px
    network: wifi-fast
    locale: pt-BR e en
  journey: J-preserve-application-decision
  scenarios: [PIPE-filter-applications, PIPE-undo-and-move-back]
  tour: Back-Button Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Combinar empresa, canal, faixa de score e estágio e conferir o contador de cada estágio contra a lista que ele abre"
      - "Buscar por um termo em português que só existe em inglês na vaga, com e sem \"ampliar busca\", e por um cargo com uma letra trocada"
      - "Recarregar, voltar pelo navegador e abrir o link copiado em outra sessão"
      - "Chegar a zero resultado e usar \"limpar filtros\" sem perder o estágio"
      - "Repetir em 375 px com o seletor aberto e com a interface em inglês"
      - "Com o funil filtrado, mover e desfazer uma candidatura (canária do PIPE-undo-and-move-back)"
    must_avoid:
      - "Consultar SQL, mocks ou endpoints internos para atribuir Pass"
      - "Usar banco que não seja o descartável do ambiente isolado"
```
