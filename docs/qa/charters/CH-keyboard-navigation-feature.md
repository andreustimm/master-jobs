# CH-keyboard-navigation-feature: concluir uma troca de tela somente por teclado

```yaml
charter:
  id: CH-keyboard-navigation-feature
  mission: "Como Candidato por teclado, trocar de Jobs para Pipeline sem mouse e confirmar que foco, destino e retorno continuam operáveis."
  mode: charter-with-tour
  persona:
    name: Candidato por teclado
    device: laptop
    network: wifi-fast
    locale: en-US
  journey: J-switch-workspace-screen
  scenarios: [NAV-accessible-mobile-transition]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar pelo login e alcançar Jobs usando somente Tab e Enter"
      - "Ativar Pipeline com Tab e Enter e continuar tabulando no destino"
      - "Usar Voltar, Avançar e recarregar sem perder a tela correta"
    must_avoid:
      - "Usar mouse, seletor interno ou console para decidir o veredito"
```
