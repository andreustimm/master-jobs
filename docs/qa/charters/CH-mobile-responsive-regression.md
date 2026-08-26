# CH-mobile-responsive-regression: operar o produto em qualquer orientação

```yaml
charter:
  id: CH-mobile-responsive-regression
  mission: "Como Andreus no celular, alternar entre telas e controles procurando conteúdo cortado, navegação espremida ou ações difíceis de tocar."
  mode: charter-with-tour
  persona:
    name: Andreus no celular
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios: [NAV-first-party-navigation-contract, SKIL-mobile-layout, ADMN-mobile-action-targets]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Abrir o menu em 375×812 e navegar para Skills sem rolagem horizontal"
      - "Girar para 812×375 e confirmar que a navegação continua compacta"
      - "Percorrer as linhas de demanda e tocar os controles de auditoria"
      - "Abrir Usuários e conferir que Excluir mantém um alvo de toque confortável"
    must_avoid:
      - "Usar zoom do navegador para mascarar overflow"
      - "Considerar apenas a largura desktop como evidência de responsividade"
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report, never here. -->
