# Verificação do coordenador de tarefas

Relatório da [#189](https://github.com/andreustimm/master-jobs/issues/189): o
que prova cada cenário de aceite do [épico #181](https://github.com/andreustimm/master-jobs/issues/181)
e o que ainda depende do ensaio real. Contrato operacional em
[github-project-tasks.md](github-project-tasks.md); decisão em
[ADR 0023](../adr/0023-github-project-como-autoridade-operacional.md).

## Duas provas, e o que cada uma alcança

- **Suíte determinística** — `rtk pnpm test:tasks`. Roda o código real do
  coordenador, da coleta de eventos, da evidência de entrega e do gate de PR
  contra um gateway simulado, sem rede, sem banco e sem tocar o Project 2 nem
  outra execução. Prova as regras de decisão e os entrelaçamentos entre
  leitura, recibo e escrita. **Não** prova o comportamento do GitHub real: a
  resposta de fato da API, o token, a fila do Actions.
- **Ensaio real em duas worktrees** — parte do piloto de ativação
  ([#191](https://github.com/andreustimm/master-jobs/issues/191)). Exige o
  escritor em `main`, `PROJECTS_TOKEN` e `TASKS_WRITER_PRIVATE_KEY`
  provisionados e `initialize` confirmado. Sem isso, nenhum cenário abaixo
  pode ser marcado como aprovado contra o GitHub, e esta página não o faz.

Declaração de agente não é prova: cada linha aponta o teste que falha se a
regra quebrar.

## Cenários

| ID | Prova determinística (`tests/`) | Resultado simulado | Pendente no ensaio real |
|---|---|---|---|
| CAN-01 | `tasks-cli` › *refuses stale revisions and a different worktree before posting a transition*; `tasks-projection` › *refreshes a disposable native sub-issue graph…* e *never overwrites authored Compozy specs…* | Aprovado: escrita exige a revisão remota lida agora; a projeção não tem caminho de escrita para o GitHub | Duas worktrees lendo o mesmo estado; `refresh` da antiga |
| CAN-02 | `tasks-coordinator` › *serializes simultaneous claims… (CAN-02)* | Aprovado: um detentor, o outro recebe `STALE_REVISION`, uma escrita | Disputa real pela fila `queue: max` |
| CAN-03 | `tasks-coordinator` › *rejects stale branch/owner and generations… (CAN-03/10)*; *refuses expired ownership instead of silently discarding another worktree* | Aprovado: geração antiga recusada, lease vencido não é tomado em silêncio | Transferência real entre worktrees com WIP |
| CAN-04 | `tasks-events` › *records %s as ignored without suggesting a transition* (12 casos) e *ignores events predating a manual intervention…*; *workflow run evidence* › *rejects stale or inapplicable workflow %s* | Aprovado: evento vira nota "Ignorado", nunca transição | CI/deploy atrasado de verdade |
| CAN-05 | `tasks-coordinator` › *preserves manual priority changes… (CAN-05)*; `tasks-github` › *does not stale a claim for human priority edits or comments…* | Aprovado: prioridade humana preservada, claim válido | Edição pela UI durante execução |
| CAN-06 | `tasks-coordinator` › *invalidates old commands when manual status editing ends (CAN-06)* e *recovers %s when its prepared control write did not apply* | Aprovado: `unpause` incrementa a época e recusa o comando antigo | Pausa, edição de Status pela UI e retomada |
| CAN-07 | `tasks-coordinator` › *demonstrates the unprotected UI race rather than claiming API CAS (CAN-07)* | **Limitação demonstrada, não resolvida**: a API não tem CAS; edição de Status fora da pausa pode ser sobrescrita sem detecção | Aceite explícito do dono (abaixo) |
| CAN-08 | `tasks-coordinator` › *coalesces duplicate operations… (CAN-08)*; `tasks-cli` › *ignores forged receipts and rejects operation ID reuse…* | Aprovado | Repetição real do mesmo UUID |
| CAN-09 | `tasks-coordinator` › *recovers a lost response… (CAN-09/12)* e *recovers a lost prepared-receipt POST response…*; `tasks-github` › *does not convert authorization errors or GraphQL partial data…*, *never retries a mutation…*, *retries a short rate-limited read…* | Aprovado: 401/403, 429, erro GraphQL com HTTP 200 e resposta perdida nunca viram sucesso | Resposta perdida induzida no piloto |
| CAN-10 | `tasks-coordinator` › *rejects stale branch/owner… (CAN-03/10)*; `tasks-pr-gate` › *rejects a claim from another branch, another generation or a non-assignee actor* | Aprovado | Branch A tentando mudar a tarefa B |
| CAN-11 | `tasks-evidence` › *does not complete a production task merely because its PR merged into dev*; `tasks-events` › *distinguishes integration in dev from production…* | Aprovado: merge em dev sugere Implantar, não Concluído | Tarefa real de produção até a promoção |
| CAN-12 | `tasks-coordinator` › *keeps a durable pending intent even when no workflow runs (CAN-12)*, *supersedes the pending receipts when a reconciliation is itself recovered*, *replays an interrupted create without re-adding the links it already made* | Aprovado: a intenção vive na #207 e é retomada sem segunda execução | Fila cheia/cancelada no Actions |
| CAN-13 | `tasks-coordinator` › *does not treat closed or canceled dependencies as completed (CAN-13)*; `tasks-evidence` › *does not count a canceled, closed child as an accepted deliverable*; `tasks-events` › *does not suggest completion with cancelled dependencies or unfinished children* | Aprovado | — |
| CAN-14 | `tasks-evidence` › *accepts the real Vercel shape with SHA ref and Production only after same-SHA main smoke and ancestry*; `tasks-events` › *resolves the task PR through the staging → main promotion, never the promotion itself* | Aprovado: issue → PR nativa → SHA → deployment → fumaça, no mesmo SHA | Navegação real de uma tarefa entregue |

Além dos cenários, `tasks-workflows` › *has no write path to merges,
deployments, refs or workflow dispatches* prende a superfície de escrita: o
`PROJECTS_TOKEN` é um PAT e o escopo dele não impede um merge; só o código
impede.

## Limitação que precisa de aceite (CAN-07)

A mutação `updateProjectV2ItemFieldValue` não aceita revisão esperada. O grupo
de concorrência exclui os outros escritores, não uma pessoa editando o quadro.
O protocolo é: editar Status só entre `pause` e `unpause` confirmados. Quem
precisar de arrastar-e-soltar livre de Status com o escritor ligado precisa de
outro desenho, ou de manter o escritor só sugerindo. Esse aceite é do dono e
fica registrado na #189 antes do corte.

## Como repetir

```sh
rtk pnpm test:tasks
```

Mudança material em `scripts/tasks/` ou nos workflows `tasks-*.yml` renova esta
evidência: rode a suíte, e se um cenário mudar de teste, atualize a linha.
Para o ensaio real, siga o roteiro do piloto no
[charter CH-task-worktree-handoff](../qa/charters/CH-task-worktree-handoff.md)
e registre na #189 os `executionId`, as revisões e os links dos runs.
