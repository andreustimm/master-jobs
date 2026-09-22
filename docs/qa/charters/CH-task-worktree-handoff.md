# CH-task-worktree-handoff: coordenar duas execuções até comprovar a entrega

```yaml
charter:
  id: CH-task-worktree-handoff
  mission: "Como operador somente por teclado, alternar entre duas worktrees da mesma tarefa e confirmar quem pode agir até comprovar a entrega exigida."
  mode: charter-with-tour
  persona:
    name: Operador somente por teclado
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-coordinate-task-delivery
  scenarios: [CLI-task-worktree-ownership, CLI-task-delivery-evidence]
  tour: Multi-Tab Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Pedir claim nas duas worktrees e comparar recibos e nova leitura da CLI com issue e Project recarregados."
      - "Interromper a espera e retomar pelo mesmo UUID sem duplicar efeito; liberar a posse se abandonar."
      - "Transferir a posse e confirmar que um comando antigo é recusado, preservando o WIP de ambas."
      - "Solicitar conclusão antes da prova de produção e conferir a recusa; concluir somente com a entrega real comprovada."
    must_avoid:
      - "Tomar posse de tarefas de outros agentes, modificar recibos ou usar gateways fake como prova remota."
      - "Promover para main automaticamente, expor credenciais ou mudar Status pela UI para forçar o resultado."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->

Tier **targeted**, conforme o [README de QA](../README.md). Esta é a jornada
operacional do [épico #181](https://github.com/andreustimm/master-jobs/issues/181),
executada no [corte #191](https://github.com/andreustimm/master-jobs/issues/191)
após as pré-condições da [jornada](../journeys/J-coordinate-task-delivery.md).
É planejamento, sem sessão executada nem veredito remoto.

Pré-condição do piloto: código confiável em `main`, credenciais validadas,
`initialize` manual confirmado e `TASKS_WRITER_ENABLED=true`.
`TASKS_ENFORCEMENT` continua desativado até o piloto confirmar o corte. A
inicialização manual anterior funciona com o writer ainda desativado.

Executar primeiro esta sessão, pelo risco de concorrência. Depois, reutilizar
[CH-direct-startup-canary](CH-direct-startup-canary.md), com sua persona e
time-box próprios, para conferir a abertura pelo pacote/runtime compartilhado.
Não reutilizar o Pass de outra rodada como evidência do ciclo atual. Debrief
e bloqueio de promoção ficam no relatório datado; não prolongar a sessão para
esperar a promoção humana.
