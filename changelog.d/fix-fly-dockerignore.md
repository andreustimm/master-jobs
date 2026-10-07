## Técnico

### Corrigido

- A imagem do plano B (Fly.io) volta a compilar (#470). O `.dockerignore` excluía `.claude/` e `tests/`, mas `next build` checa tipos de todo `**/*.ts` do contexto: `scripts/harness/` importa `.claude/hooks/shell-policy.mjs` (desde a #462) e `scripts/versions/postgres-majors.ts` importa `tests/support/module-graph.ts`. Voltam ao contexto só `.claude/hooks/` e os dois arquivos do grafo de módulos; memória, worktrees, settings, agentes e skills seguem fora. `tests/dockerignore-imports.test.ts` reprova import, a partir de arquivo do contexto, de arquivo que o `.dockerignore` exclui.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
