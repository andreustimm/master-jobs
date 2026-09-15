# Organização do workspace

## Objetivo

Limpar o que já foi entregue e adaptar práticas úteis de contas_casal:
isolamento por demanda, proteção local de branches, inspeção de worktrees,
preservação de WIP e validação proporcional.

## Reconciliação em 2026-09-15

| Branch original | Evidência | Providência |
|---|---|---|
| codex/header-safe-area-web | PR #65 mesclada em dev; árvore idêntica ao merge bd8fc629; worktree limpa | Worktree e branch local removidas; remota já ausente |
| codex/db-retention-cleanup | HEAD igual a dev, porém 18 caminhos pendentes e nenhuma PR de entrega | Preservada, com backup de patch e arquivos não rastreados |
| codex/pause-turso-consumers | Dois commits próprios, branch remota presente, sem PR mesclada | Preservada; próxima etapa é revisar e publicar a documentação de operações |
| codex/supabase-production | 111 caminhos pendentes, incluindo runtime, schema, migração e QA | Preservada, com backup; concluir gates e pendências da migração antes da PR |

A raiz em dev continha duplicações antigas de changelog, documentação danificada,
um rascunho de issue e artefatos locais. Tudo foi preservado em
`data/workspace-recovery/2026-09-15/` antes da restauração dos quatro arquivos
rastreados e do fast-forward para origin/dev. A raiz ficou limpa.
Não houve alteração de banco, deploy ou retomada automática da migração.

## Estado da melhoria

Branch/worktree: `codex/workspace-hygiene` em `.claude/worktrees/workspace-hygiene`.
Implementação pronta; testes de comportamento de hooks, inspeção e commit de
release passaram (7 testes), incluindo rebase e commits exclusivos de uma tarefa.
A revisão inicial encontrou dois defeitos, reproduzidos por testes antes da
correção: HEAD destacado durante rebase e arquivos ocultos pela configuração
`status.showUntrackedFiles`. Ambos foram corrigidos; a rodada seguinte valida o
diff completo antes da PR para dev. Sem mudança visível no produto.

Referências analisadas em contas_casal: `AGENTS.md`, `.claude/rules/workflow.md`,
`.githooks/prepare-commit-msg` e memórias sobre isolamento por demanda e contenção
de CPU. São referências de desenho; suas regras não foram importadas para este
projeto.
