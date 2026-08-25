# CH-installed-header-safe-area: abrir a PWA sem controles sob a barra do sistema

```yaml
charter:
  id: CH-installed-header-safe-area
  mission: "Como Candidato em trânsito, abrir e girar o Cockpit instalado procurando marca ou controles encobertos pela barra do sistema."
  mode: charter-with-tour
  persona:
    name: Candidato em trânsito
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-open-dashboard-direct
  scenarios: [PWA-installed-header-safe-area]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Abrir a raiz instalada em 375×812 e recarregar"
      - "Girar para 812×375 sem perder marca, menu, idioma ou aparência"
      - "Repetir em 768×1024 e usar 1280×900 como canário sem faixa vazia"
      - "Procurar overflow horizontal em cada orientação"
    must_avoid:
      - "Contar emulação Chromium como confirmação física do Safari instalado"
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
