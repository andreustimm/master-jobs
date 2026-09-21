# CH-term-input-mistreated: o campo de termo recebe o que se cola de outro lugar e responde com a mensagem certa

```yaml
charter:
  id: CH-term-input-mistreated
  mission: "Maltratar o campo de termo com curto, longo, caractere não aceito, repetido e colado com espaço sobrando — cada recusa precisa dizer o motivo e nenhuma pode salvar pela metade."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-save-term-search
  scenarios: [SRCH-term-validation]
  tour: Garbage Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Termo de um caractere, termo no limite e acima do limite."
      - "Termo com emoji, aspas curvas e espaço no começo e no fim."
      - "Salvar um termo que já existe e seguir o link para o existente."
      - "Clicar salvar duas vezes seguidas e recarregar."
    must_avoid:
      - "Teste de segurança de injeção: aqui o lixo é o de quem cola, não o de quem ataca."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
