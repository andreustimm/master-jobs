# CH-public-profile-jobicy-layout: entender o perfil público no layout Jobicy em segundos

```yaml
charter:
  id: CH-public-profile-jobicy-layout
  mission: "Como Visitante do perfil público (recrutador anônimo), abrir /p/<slug> no layout de referência Jobicy e confirmar que o hero, a grade de duas colunas, as skills agrupadas e o currículo completo recolhido entregam compreensão em segundos, em pt-BR e en, em 375px e desktop, sem contato nem piso salarial."
  mode: scenario-based
  persona:
    name: Visitante do perfil público
    device: phone-large
    network: 4g
    locale: en-US
  journey: J-open-public-profile
  scenarios: [PUB-public-profile-layout, PUB-public-cv-formatted]
  tour: Feature Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Abrir o perfil publicado em sessão anônima e cronometrar o que se entende só pelo hero (nome, headline, localização, CTAs) sem rolar"
      - "Conferir a grade de duas colunas a partir de 1024px e a ordem das skills (categoria alfabética, ocorrências decrescente, nome crescente, top 6 + N)"
      - "Expandir 'Currículo completo'/'Full CV' e confirmar seções por título em caixa alta, listas por item, sem contato nem pretensão salarial, antes e depois do reload"
      - "Trocar o idioma (EN/PT-BR) e confirmar que só a UI traduz, mantendo o texto do próprio currículo intacto"
      - "Clicar em copiar link e confirmar retorno visível"
    must_avoid:
      - "Usar a sessão autenticada do candidato para julgar o que o visitante vê"
      - "Confundir o rótulo original do CV (micro-label de dado do usuário) com o título traduzido do card"
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
