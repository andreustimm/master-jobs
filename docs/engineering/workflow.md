# Trabalhar e retomar sem deixar trabalho perdido

O fluxo continua sendo worktree de `dev` → PR para `dev` → promoção automática
para `staging` → aprovação humana para `main`.

## Começar ou retomar

Use Node 24.19.0, fixado em `.nvmrc` e compatível com `package.json`.
Quem usa nvm pode executar `nvm use` antes dos comandos.

1. Rode `rtk git status --short --branch` e `rtk pnpm worktrees`.
   O segundo comando só consulta o estado local; atualize as referências com
   `rtk git fetch origin --prune` antes de decidir sobre integração.
2. Reuse a worktree da demanda se ela já existir. Para trabalho novo, crie
   `<tipo>/<slug>` a partir de `origin/dev` em uma worktree própria. O tipo é
   o do Conventional Commits (`feat`, `fix`, `docs`, `chore`, `refactor`,
   `test`, `perf`, `ci`, `build`, `style`, `revert`) e o slug é kebab-case
   minúsculo: `feat/busca-por-tecnologia`. `.githooks/pre-push` recusa outro
   formato; `codex/*` é legado aceito para as branches já abertas.
3. Se houver alterações na raiz em `dev`, identifique a origem antes de editar.
   Preserve patch **e arquivos não rastreados** em `data/workspace-recovery/`
   ou na worktree responsável. Compare a cópia antes de limpar. Nunca use
   `reset --hard` ou `clean -fd` como solução genérica.
4. Não atualize a base nem remova a worktree de outro trabalho durante sua execução.
   Portas, banco e build de teste pertencem à execução; dados reais ficam fora.

Para uma mudança pequena, a descrição da PR basta para registrar objetivo,
validação e pendências. Trabalho que atravessa sessões mantém uma nota curta em
`.compozy/tasks/<slug>/`: branch/worktree, estado atual, próximo passo e bloqueio.
Specs extensas ficam para mudanças que precisam delas. Decisões duráveis vão
para `docs/`, conforme a ADR 0011.

## Validar pelo risco

| Mudança | Evidência necessária |
|---|---|
| Markdown e metadados | Estrutura, links e scripts afetados |
| Ferramenta de desenvolvimento | Testes de comportamento da ferramenta e comandos afetados |
| Runtime | `rtk pnpm check` e E2E aplicável |
| Comportamento percebido pelo usuário | Gates de runtime e QA targeted conforme [QA vivo](../qa/README.md) |
| Schema, autenticação ou promoção | Gates específicos existentes; não reduzir os testes por conveniência |

Rode suites pesadas em sequência na mesma máquina. Se o código ou a base mudar
depois da validação, renove os checks afetados. Registre o comando e o resultado
real na PR; execução não realizada continua pendente.

## Entregar e limpar

Antes da PR: deslop, deep-review com veredito SHIP e responsável atribuído.
Depois do merge, a limpeza faz parte da mesma entrega:

1. Confirme no GitHub que a PR da branch foi mesclada em `dev` e que seu último
   commit está incluído. Em squash, compare o conteúdo com o commit do merge.
2. Confirme a worktree limpa e preserve evidências locais que ainda importam.
   Estar no mesmo HEAD de `dev` **não** torna seguro apagar alterações locais.
3. Remova a worktree, a branch local e a remota, se ainda existir.
4. Rode `rtk git fetch origin --prune` e confira `rtk pnpm worktrees`.
   Atualize a raiz limpa com `rtk git merge --ff-only origin/dev`.

Sem PR mesclada ou com commits posteriores: preserve a branch e registre a
pendência. `dev`, `staging` e `main` permanecem sempre.

## Proteção local

`pnpm install` configura `.githooks`. O hook `prepare-commit-msg` impede commit
em branches permanentes; `pre-push` impede push direto para elas, inclusive
`feature:dev`. Isso também protege operações de clientes Git locais.
As promoções continuam nos workflows do GitHub. Hooks não protegem escritas
feitas diretamente pela API: as regras de PR continuam necessárias.

## O que foi adaptado de contas_casal

Adotamos isolamento por demanda, proteção local das branches permanentes,
preservação antes de reconciliar a raiz, evidência atual e limpeza após merge.
A inspeção usa Git e um script pequeno; o registro usa os diretórios existentes.
O master-jobs mantém seus slugs, branches `<tipo>/<slug>`, pnpm, E2E local isolado e
QA vivo. Não exige IDs sequenciais, métricas por execução, recibos de gates,
sincronização com GitHub Project ou um motor de orquestração para uma correção.
