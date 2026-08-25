# CH-night-ranking-navigation: alternar do ranking ao detalhe à noite

```yaml
charter:
  id: CH-night-ranking-navigation
  mission: "Como Andreus em triagem noturna, abrir o ranking, trocar de área e confirmar o destino após recarregar sem perder contexto."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem noturna
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios: [NAV-first-party-navigation-contract]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar pelo login real e abrir Vagas pelo menu"
      - "Recarregar e confirmar URL e conteúdo do destino"
    must_avoid:
      - "Usar rota interna ou banco para decidir o veredito"
```
