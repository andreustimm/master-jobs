# CH-saved-term-reaches-new-jobs: um termo salvo em Vagas vira vagas novas marcadas, de ponta a ponta

```yaml
charter:
  id: CH-saved-term-reaches-new-jobs
  mission: "Salvar um termo a partir de uma busca em Vagas e segui-lo até as vagas novas que ele trouxe — cada estado prometido na tela precisa existir e sobreviver à recarga."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-save-term-search
  scenarios: [SRCH-save-term-from-jobs, SRCH-term-lifecycle, SRCH-term-rerun-cooldown, SRCH-new-jobs-count, SRCH-new-platforms]
  tour: Feature Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Buscar em Vagas e usar a oferta de salvar o termo; conferir que Buscas abre com o termo preenchido."
      - "Salvar e ler o estado por plataforma; pausar, retomar e excluir, recarregando depois de cada ação."
      - "Pedir nova busca dentro das 24 horas e ler quando ela volta a ser possível."
      - "Seguir o contador de novas até Vagas filtrada e conferir que a contagem cai depois da visita."
    must_avoid:
      - "Capturas reais contra as plataformas externas: o ambiente é isolado; o que depende da rede externa fica Blocked com a razão."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
