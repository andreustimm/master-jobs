# CH-mobile-transition-recovery: sentir espera e recuperação em tela pequena

```yaml
charter:
  id: CH-mobile-transition-recovery
  mission: "Como Candidato em trânsito, trocar telas em 375 px e observar se espera, contenção e recuperação continuam honestas."
  mode: charter-with-tour
  persona:
    name: Candidato em trânsito
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios: [NAV-slow-screen-truthful, NAV-failed-screen-retry]
  tour: Interrupt Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Interromper uma navegação com Voltar"
      - "Alternar orientação lógica entre largura móvel e zoom"
      - "Procurar controles cobertos ou texto cortado"
    must_avoid:
      - "Forçar falha por alteração de estado interno da aplicação"
```
