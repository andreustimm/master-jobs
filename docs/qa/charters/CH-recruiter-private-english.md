# CH-recruiter-private-english: respeitar o limite da recrutadora em inglês

```yaml
charter:
  id: CH-recruiter-private-english
  mission: "Como Recrutadora convidada, entrar em inglês e confirmar que uma área privada de candidato continua negada após recarregar."
  mode: charter-with-tour
  persona:
    name: Recrutadora convidada
    device: laptop
    network: wifi-fast
    locale: en-US
  journey: J-switch-workspace-screen
  scenarios: [AUTH-canonical-transition-boundaries]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar com conta somente recrutadora e usar a navegação permitida"
      - "Abrir o endereço público /candidate, recarregar e conferir a negativa sem dados de candidato"
      - "Voltar a uma área permitida e confirmar que a sessão segue utilizável"
    must_avoid:
      - "Inferir autorização apenas pelo menu ou consultar o banco"
      - "Usar uma conta administrativa como se fosse recrutadora"
```

Variante com locale correspondente à persona; o charter legado
CH-recruiter-private-boundary permanece imutável como histórico.
