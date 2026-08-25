# CH-save-cv-ranking-refresh: salvar CV e confirmar a fila do ranking

```yaml
charter:
  id: CH-save-cv-ranking-refresh
  mission: "Como Andreus em triagem noturna, salvar uma alteração real no CV e confirmar que o estado do ranking continua verdadeiro depois de recarregar."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem noturna
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-refresh-candidate-ranking
  scenarios: [PROF-rescore-status-visibility]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar pelo login real e chegar à área do candidato pela navegação"
      - "Alterar o CV, salvar e ler o estado sem usar banco ou endpoint interno"
      - "Recarregar e confirmar que o observável persiste"
    must_avoid:
      - "Esperar polling ou interpretar logs do worker como prova da interface"
```
