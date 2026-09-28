# CH-relevance-and-availability-catch-up: busca por frase, ordem por relevância e disponibilidade da vaga entregues em #223 (tarefas 04/05)

```yaml
charter:
  id: CH-relevance-and-availability-catch-up
  mission: "Como Andreus em triagem, conferir as duas entregas de #223 que ficaram untested: buscar 'tech lead' entre aspas com ordem por relevância (tarefa 05) e ler disponibilidade/última checagem no detalhe da vaga (tarefa 04) — as duas já estão em produção sem QA de jornada registrado."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-trust-the-filtered-board
  scenarios:
    - JOBS-search-relevance
    - JOBS-availability-last-check
  tour: Feature Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Abrir /jobs?q=%22tech%20lead%22&workMode=remote&sort=relevance e ler a primeira vaga: cargo com a frase exata."
      - "Cada linha diz onde casou (cargo, descrição ou localização); o grupo 'Termos parecidos' fica separado abaixo e fora da paginação/total."
      - "Trocar entre aderência e relevância e conferir que o total não muda; copiar a URL e reabrir numa aba nova."
      - "Apagar a busca e conferir que o chip de relevância e o grupo de termos parecidos somem."
      - "Abrir uma vaga verificada recentemente, uma nunca verificada e uma fechada por 404/410 (se existir no corpus) e ler o selo de disponibilidade e a data da última checagem em cada uma."
      - "Recarregar o detalhe da vaga e conferir que o selo de disponibilidade sobrevive."
      - "Repetir a leitura do selo de disponibilidade em 375 px."
    must_avoid:
      - "Não usar rota de teste nem inspecionar o banco para decidir o estado da vaga — só o que a tela mostra."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
