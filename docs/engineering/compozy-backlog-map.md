# Mapa de backlog para o Compozy

> **Snapshot histórico de 16/09/2026.** A ordem e os estados desta auditoria
> foram superados por entregas posteriores. A autoridade operacional é o
> [GitHub Project 3](https://github.com/users/andreustimm/projects/3) e suas
> issues de `andreustimm/master-jobs`. Consulte a [reconciliação com PRs e SHAs](github-project-migration.md)
> antes de interpretar uma linha como pendência. Este arquivo preserva a
> origem das especificações e não recebe novas tarefas ou atualizações de status.

**Data da auditoria:** 2026-09-16

Este mapa registrou a separação entre discovery e tarefa executável usada
naquela sessão: PRD, histórias, Tech Spec, contrato de testes e grafo
`compozy.tasks/v2`. Os contratos autorais continuam disponíveis; a execução
atual segue o [fluxo de tarefas no GitHub](github-project-tasks.md).

## Ordem de ação registrada em 16/09 — histórica

| Ordem | Item | Estado no Compozy | Próxima ação |
|---:|---|---|---|
| 1 | F-08 — dev/staging amostrais | Decomposto em [`environment-sample-only`](../../.compozy/tasks/environment-sample-only/) | Implementar guard e fixtures nesta semana. |
| 2 | F-07 — arquivar vagas preservando candidaturas | Decomposto em [`job-lifecycle-retention`](../../.compozy/tasks/job-lifecycle-retention/) | Implementar migration, CLI e leituras escopadas depois do guard. |
| 3 | Next Backlog Wave — docs, Compozy sweep, fila de rescore e fixtures de adapters | Já decomposto em [`next-backlog-wave`](../../.compozy/tasks/next-backlog-wave/) | Validar o grafo existente e executar somente após as duas tarefas P0/P1. |
| 4 | Supabase production | Plano operacional em [`supabase-production`](../../.compozy/tasks/supabase-production/); ainda não normalizado como PRD/TechSpec | Criar planejamento Compozy dedicado antes de qualquer DDL, import ou corte. |
| 5 | Workspace hygiene | Entrega concluída; registro em [`workspace-hygiene`](../../.compozy/tasks/workspace-hygiene/status.md) | Não reabrir sem nova evidência de branches/WIP. |

## Achados registrados na auditoria de 16/09

- Os itens marcados como entregues (scoring, ingestão, dashboard, autenticação,
  recheck, currículo, PWA e arquitetura) não devem virar tarefas novas apenas
  porque o texto histórico ainda descreve o problema. A seção “Entregue” é a
  evidência; uma nova tarefa exige uma lacuna concreta.
- F-07 e F-08 eram os únicos pedidos novos desta sessão e agora têm decomposição
  completa, com IDs de testes atribuídos uma única vez.
- UI-02 aparece como entregue e a própria seção registra o que ficou de fora;
  não é uma tarefa pendente até alguém priorizar o diff de versões.
- O plano Supabase é uma migração operacional sensível, não deve ser iniciado
  junto com a limpeza de ambientes. Ele fica depois dos guards/fixtures e exige
  um PRD/TechSpec próprio antes do corte.

## Retomada vigente

Leia a issue canônica no Project e confira a execução ativa antes de iniciar
trabalho. Especificações e registros desta auditoria são contexto para a
issue; `_tasks.md`, `task_NN.md` e `status.md` legados não concedem posse nem
determinam a próxima tarefa. A projeção local deve ser atualizada a partir do
GitHub, conforme o [guia operacional](github-project-tasks.md), sem publicar
o estado de uma branch antiga sobre o remoto.
