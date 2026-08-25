# CH-mobile-one-hand-ranking: consultar o ranking em uma mão

```yaml
charter:
  id: CH-mobile-one-hand-ranking
  mission: "Como Andreus no celular, abrir o ranking em 375 px e confirmar que a tela permanece contida após recarregar."
  mode: charter-with-tour
  persona:
    name: Andreus no celular
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios: [NAV-first-party-navigation-contract]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar pelo login real em 375×812"
      - "Recarregar o ranking e procurar overflow horizontal"
    must_avoid:
      - "Redimensionar a viewport depois de avaliar a contenção"
```
