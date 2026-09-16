# Mapa de backlog para o Compozy

**Data da auditoria:** 2026-09-16

Este mapa evita que o backlog de discovery seja confundido com uma tarefa
executável. Um item entra em implementação somente quando tem PRD, histórias,
Tech Spec, contrato de testes e grafo `compozy.tasks/v2`.

## Ordem de ação

| Ordem | Item | Estado no Compozy | Próxima ação |
|---:|---|---|---|
| 1 | F-08 — dev/staging amostrais | Decomposto em [`environment-sample-only`](../../.compozy/tasks/environment-sample-only/) | Implementar guard e fixtures nesta semana. |
| 2 | F-07 — arquivar vagas preservando candidaturas | Decomposto em [`job-lifecycle-retention`](../../.compozy/tasks/job-lifecycle-retention/) | Implementar migration, CLI e leituras escopadas depois do guard. |
| 3 | Next Backlog Wave — docs, Compozy sweep, fila de rescore e fixtures de adapters | Já decomposto em [`next-backlog-wave`](../../.compozy/tasks/next-backlog-wave/) | Validar o grafo existente e executar somente após as duas tarefas P0/P1. |
| 4 | Supabase production | Plano operacional em [`supabase-production`](../../.compozy/tasks/supabase-production/); ainda não normalizado como PRD/TechSpec | Criar planejamento Compozy dedicado antes de qualquer DDL, import ou corte. |
| 5 | Workspace hygiene | Entrega concluída; registro em [`workspace-hygiene`](../../.compozy/tasks/workspace-hygiene/status.md) | Não reabrir sem nova evidência de branches/WIP. |

## Auditoria do backlog de discovery

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

## Regra de retomada

1. Ler este mapa e o registro da sessão antes de abrir uma tarefa.
2. Validar o workflow Compozy (`compozy tasks validate --name <slug>`).
3. Executar uma tarefa por vez, respeitando as arestas de `_tasks.md`.
4. Atualizar docs/QA e o status do task antes de criar a próxima PR.
5. Remover branch/worktree de trabalho somente após merge comprovado em `dev`.
