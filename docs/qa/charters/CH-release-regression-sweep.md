# CH-release-regression-sweep: jornadas principais no celular e em inglês

```yaml
charter:
  id: CH-release-regression-sweep
  mission: "Percorrer vagas, filtros com transição suave, busca por termo, detalhe, funil, candidato, buscas e admin em 375px e em inglês, procurando estouro horizontal, texto em português e overlay onde a tela deveria continuar visível."
  mode: charter-with-tour
  persona:
    name: Andreus no celular
    device: phone-small
    network: 4g
    locale: en-US
  journey: J-trust-the-filtered-board
  scenarios: [NAV-same-screen-soft-transition, NAV-switch-screen-ready, NAV-first-party-navigation-contract, JOBS-term-filter-descriptions, JOBS-filter-fields-follow-url, JOBS-work-mode-continuity, JOBS-work-mode-mobile, JOBS-source-multi-select, JOBS-not-interested, JOBS-detail-owner-view-english, JOBS-country-hub, JOBS-group-canonical-survives-filter, JOBS-track-selector-fit, JOBS-country-only-blocked, PIPE-note-on-unchanged-stage, PIPE-refused-transition-keeps-draft, SRCH-mobile-layout, SRCH-term-lifecycle, SRCH-term-validation, SRCH-term-controls-named, SRCH-term-rerun-cooldown, SRCH-save-term-from-jobs, SRCH-new-jobs-count, SRCH-new-platforms, SRCH-track-primary-archive, SRCH-track-without-evidence, CLI-term-search-commands, CLI-linkedin-job-never-fetched]
  tour: Landmark Tour
  time_box_minutes: 90
  guidance:
    must_try:
      - "Mudar filtro, ordem e página em /jobs e conferir que a lista continua visível, com 'Updating this screen'."
      - "Buscar um termo que só está na descrição, com hífen e sem hífen."
      - "Salvar nota sem mudar o estágio; provocar recusa de transição por fora."
      - "Medir scrollWidth em 375px em cada tela."
    must_avoid:
      - "Julgar tempo de resposta do acervo sintético como tempo de produção."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
