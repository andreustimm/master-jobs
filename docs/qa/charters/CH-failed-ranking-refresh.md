# CH-failed-ranking-refresh: recuperar confiança após falha do ranking

```yaml
charter:
  id: CH-failed-ranking-refresh
  mission: "Como candidato voltando de uma falha, confirmar em tela estreita que o ranking explica o problema com segurança e permite retomar sem vazamento."
  mode: charter-with-tour
  persona:
    name: Candidato após falha
    device: laptop
    network: flaky
    locale: pt-BR
  journey: J-refresh-candidate-ranking
  scenarios: [PROF-rescore-status-privacy]
  tour: Error Message Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar com a identidade que possui uma falha persistida e abrir /candidate"
      - "Recarregar em 375x812 e 812x375, procurando overflow e detalhes técnicos"
      - "Comparar com uma identidade sem tarefa para confirmar o estado idle privado"
    must_avoid:
      - "Abrir banco, logs ou devtools para decidir o que a pessoa deveria ver"
```
