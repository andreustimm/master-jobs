# CH-keyboard-screen-transition: trocar telas sem perder anúncio ou foco

```yaml
charter:
  id: CH-keyboard-screen-transition
  mission: "Como Candidato por teclado, percorrer uma troca de tela procurando bloqueio incompleto, anúncio duplicado e foco residual."
  mode: charter-with-tour
  persona:
    name: Candidato por teclado
    device: laptop
    network: wifi-fast
    locale: en-US
  journey: J-switch-workspace-screen
  scenarios: [NAV-switch-screen-ready, NAV-accessible-mobile-transition]
  tour: Accessibility Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Iniciar a navegação apenas pelo teclado"
      - "Tentar operar o shell enquanto o splash está ativo"
      - "Confirmar o destino e continuar tabulando depois da saída"
    must_avoid:
      - "Usar seletores internos ou console para decidir o veredito"
```
