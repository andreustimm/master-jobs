# CH-private-ranking-recovery: conferir estado privado após falha

```yaml
charter:
  id: CH-private-ranking-recovery
  mission: "Como candidato após falha, percorrer o estado do ranking e o retorno à área privada, comparando identidades sem expor erro interno."
  mode: charter-with-tour
  persona:
    name: Candidato após falha
    device: laptop
    network: flaky
    locale: pt-BR
  journey: J-refresh-candidate-ranking
  scenarios: [PROF-rescore-status-privacy]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar com a identidade que possui uma falha persistida e abrir Candidato"
      - "Recarregar em 375x812 e 812x375, procurando overflow e detalhes técnicos"
      - "Abandonar e retornar pelo navegador"
      - "Encerrar sessão e entrar com identidade sem tarefa, confirmando seu estado privado"
    must_avoid:
      - "Abrir banco ou logs para decidir o que a pessoa deveria ver"
      - "Afirmar simulação de rede instável se o driver não a executar"
```
