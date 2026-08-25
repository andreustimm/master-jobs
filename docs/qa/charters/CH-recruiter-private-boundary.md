# CH-recruiter-private-boundary: respeitar o limite da recrutadora

```yaml
charter:
  id: CH-recruiter-private-boundary
  mission: "Como Recrutadora convidada, entrar na área permitida e confirmar que uma rota privada de candidato continua negada após recarregar."
  mode: charter-with-tour
  persona:
    name: Recrutadora convidada
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios: [AUTH-canonical-transition-boundaries]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar com uma conta somente recrutadora"
      - "Abrir /candidate e recarregar o resultado canônico"
    must_avoid:
      - "Inferir autorização pelo menu sem tentar a rota"
```
