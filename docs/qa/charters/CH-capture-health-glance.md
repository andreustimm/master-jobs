# CH-capture-health-glance: a saúde das capturas diz o que cada plataforma fez, sem mostrar termo nem candidato

```yaml
charter:
  id: CH-capture-health-glance
  mission: "Como administrador, ler a saúde das capturas depois das buscas da sessão — cada plataforma precisa mostrar cota, capturas e último erro, e nada pode revelar termo ou candidato."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-monitor-term-capture-health
  scenarios: [ADMN-capture-health-aggregate]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Abrir /admin/captures e ler um cartão por plataforma."
      - "Procurar no texto da tela qualquer termo salvo ou nome de candidato."
      - "Abrir a mesma URL com uma conta candidata sem papel admin."
    must_avoid:
      - "Forçar erro de plataforma externa: o ambiente é isolado."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
