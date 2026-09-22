# Artefatos das tarefas

A fonte operacional de tarefas é o [GitHub Project 3](https://github.com/users/andreustimm/projects/3)
com issues reais de `andreustimm/master-jobs`. Leia o
[fluxo de tarefas](../../docs/engineering/github-project-tasks.md) para criar,
assumir, transferir ou retomar uma execução. Prioridade, status, dependências,
responsável humano e detentor de execução são consultados no GitHub.

## O que esta árvore preserva

PRDs, especificações, histórias, decisões, contratos de testes, revisões e
resultados autorais continuam versionados por slug. Eles explicam o problema,
o contrato e as evidências da feature; não são apagados pela migração.
Documentação que permanece válida depois da feature fica em `docs/`, conforme
a [ADR 0011](../../docs/adr/0011-fronteira-compozyos-e-docs.md).

Os `_tasks.md`, `task_NN.md`, `status.md`, checklists e campos de frontmatter
anteriores à migração são **snapshots históricos**. `completed`, `in_progress`
ou uma caixa marcada registram uma alegação local na data da escrita; não
provam entrega, concedem posse ou determinam a ordem atual. O
[relatório de migração](../../docs/engineering/github-project-migration.md)
registra duplicidades, evidências remotas e pendências de reconciliação.

## Projeções para execução

Uma ferramenta que exige grafo ou arquivos locais deve consumir uma projeção
gerada das issues, com identificação da fonte e da revisão. Gere-a em diretório
exclusivo, separado dos documentos autorais. Ela é descartável e não constitui
uma segunda fila.

Leia o estado remoto antes de começar ou retomar. Para mudar estado ou
dependência, use o fluxo da issue e depois atualize a projeção. Uma edição
manual da projeção, uma memória de sessão ou um arquivo recuperado de outra
branch nunca é importado como atualização operacional. A assinatura e a posse
válidas exigidas pelo protocolo continuam necessárias mesmo quando o
responsável humano é o mesmo em duas sessões.

## Trabalho já existente

Reutilize a issue correspondente ao escopo e à identidade de migração antes
de criar outra. Uma worktree com alterações pendentes é trabalho a preservar;
o nome da branch ou o autor de commit não identificam seu detentor de execução.
Confirme esse vínculo no GitHub e coordene a retomada, sem editar ou remover o
WIP de outra sessão.

Entregas passadas permanecem como histórico e links de PR, commit e evidência.
Não crie uma issue concluída para cada documento antigo. Uma nova issue exige
uma demanda residual ou nova, com o escopo que ainda precisa ser entregue.
