# CH-no-cv-ranking-state: primeira leitura do ranking sem currículo

```yaml
charter:
  id: CH-no-cv-ranking-state
  mission: "Como candidato sem currículo salvo, entender o que falta para liberar o ranking sem receber um estado enganoso."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem noturna
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-refresh-candidate-ranking
  scenarios: [PROF-rescore-status-no-cv]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar com a conta de QA sem CV e abrir /candidate pela navegação real"
      - "Confirmar que a orientação nomeia a ação necessária e não usa idle, pendente ou chave literal"
      - "Repetir em 375x812, 812x375, tablet e desktop e recarregar a página"
    must_avoid:
      - "Criar um CV, ler o banco ou usar endpoint interno para decidir o estado"
```
