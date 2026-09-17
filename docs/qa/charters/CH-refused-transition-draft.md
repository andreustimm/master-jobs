# CH-refused-transition-draft: perder a mudança sem perder o texto

```yaml
charter:
  id: CH-refused-transition-draft
  mission: "Como Andreus em triagem noturna, provocar uma recusa real de mudança de estágio e verificar que a nota digitada continua na tela e que o aviso nomeia os dois estágios."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem noturna
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-preserve-application-decision
  scenarios: [PIPE-refused-transition-keeps-draft]
  tour: Back-Button Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Conferir, no detalhe de uma candidatura já registrada, que o seletor lista só estágios alcançáveis a partir do atual"
      - "Deixar uma aba aberta, mover a candidatura para um estado terminal por outra aba e só então digitar a nota e enviar pela aba desatualizada"
      - "Ler o aviso: ele precisa citar o estágio gravado e o pretendido, não uma falha genérica"
      - "Confirmar o campo de nota com o texto ainda presente depois do aviso, e que reenviar um estágio alcançável grava sem redigitar"
    must_avoid:
      - "Forçar a recusa por SQL, endpoint interno ou devtools: a segunda aba é a via pública"
      - "Aceitar um Pass sem confirmar as duas metades na mesma tentativa"
```
