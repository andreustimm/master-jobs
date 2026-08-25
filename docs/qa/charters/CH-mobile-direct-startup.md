# CH-mobile-direct-startup: abrir diretamente sem camadas residuais

```yaml
charter:
  id: CH-mobile-direct-startup
  mission: "Como Candidato em trânsito, abrir e recarregar o Cockpit em 375 px procurando splash duplicado, overflow e camada residual."
  mode: charter-with-tour
  persona:
    name: Candidato em trânsito
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-open-dashboard-direct
  scenarios: [PWA-direct-load-startup-singleton]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar pelo login real em 375×812"
      - "Abrir diretamente a raiz e recarregar"
      - "Confirmar ausência de camada residual"
    must_avoid:
      - "Contar a tela de login como startup autenticado"
```
