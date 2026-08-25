# CH-auth-boundary-recovery: retornar ao resultado canônico após falha

```yaml
charter:
  id: CH-auth-boundary-recovery
  mission: "Como Candidato após falha, percorrer token inválido, autorização negada e sessão perdida sem conteúdo residual."
  mode: charter-with-tour
  persona:
    name: Candidato após falha
    device: laptop
    network: flaky
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios: [AUTH-canonical-transition-boundaries]
  tour: Back-Button Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Abrir um token de recuperação inválido"
      - "Entrar como candidato e recarregar uma rota administrativa negada"
      - "Remover a sessão e confirmar o retorno ao login"
    must_avoid:
      - "Inspecionar o banco para decidir o veredito"
```
