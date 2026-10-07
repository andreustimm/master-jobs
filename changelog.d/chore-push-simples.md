## Técnico

### Alterado

- Política de shell (#476): todo `git` numa worktree de trabalho passa sem pergunta nos três harnesses, inclusive o destrutivo (push sem refspec, forçado e `--delete` de branch de trabalho, `reset --hard`, `clean`, `checkout`/`switch` com descarte, `restore`, `rm -r/-f`, `commit --no-verify`), por decisão do dono. O contexto vem do próprio git: `.claude/hooks/push-target.mjs` resolve checkout principal ou worktree registrada, branch e `@{push}`, e a política só o usa para `git` simples (sem `-c`, `--git-dir`, `GIT_DIR=`, `env -C`, shell aninhado, `xargs` ou `find`). Push cujo destino real é `main`/`staging`/`dev`, descarte na checkout principal, `stash drop/clear` e segredo continuam perguntando ou negando.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
