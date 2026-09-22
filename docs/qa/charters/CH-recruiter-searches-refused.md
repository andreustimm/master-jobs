# CH-recruiter-searches-refused: a recrutadora não alcança as Buscas do candidato, nem pela URL

```yaml
charter:
  id: CH-recruiter-searches-refused
  mission: "Como recrutadora, tentar chegar às trilhas e termos do candidato por menu, URL direta e voltar do histórico — nenhum caminho pode revelar o que ele busca."
  mode: charter-with-tour
  persona:
    name: Recrutadora convidada
    device: laptop
    network: wifi-fast
    locale: en-US
  journey: J-save-term-search
  scenarios: [SRCH-recruiter-refused]
  tour: Back-Button Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Procurar Buscas no menu da recrutadora, em inglês."
      - "Abrir /searches, /searches/tracks/new e /searches/tracks/<id de uma trilha do dono> digitando a URL."
      - "Voltar e avançar no histórico a partir da recusa, e recarregar a recusa."
      - "Conferir que a resposta não traz nome de trilha, termo nem contagem do candidato."
    must_avoid:
      - "Criar trilha ou termo com a conta do dono nesta sessão — o dado a proteger já vem da fixture."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
