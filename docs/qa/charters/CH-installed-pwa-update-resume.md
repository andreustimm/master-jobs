# CH-installed-pwa-update-resume: retomar na geração atual sem visual antigo

```yaml
charter:
  id: CH-installed-pwa-update-resume
  mission: "Como Candidato em trânsito, retomar a PWA depois de um deploy e procurar CSS antigo, recargas repetidas ou cabeçalho encoberto."
  mode: charter-with-tour
  persona:
    name: Candidato em trânsito
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-open-dashboard-direct
  scenarios: [PWA-installed-update-current]
  tour: Interrupt Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Deixar a PWA instalada aberta antes da publicação de uma geração nova"
      - "Colocar o aplicativo em segundo plano e retomá-lo depois do deploy"
      - "Confirmar uma única recarga, o cabeçalho abaixo da barra do sistema e a persistência após fechar e reabrir"
      - "Repetir em retrato e paisagem com conexão disponível"
    must_avoid:
      - "Limpar caches ou reinstalar a PWA antes da retomada"
      - "Contar uma instalação nova como prova da atualização de um cliente antigo"
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
