## Técnico

### Alterado

- Política de shell: o `git` passa ou nega, nunca pergunta (decisão do dono, 11/10/2026, depois de reclamação formal). `stash drop/clear`, gravar chave do push e `-c` de chave do push fora do push passam; o descarte fora de worktree de trabalho (G44) nega com a instrução "rode isso numa worktree de trabalho"; o que executa programa, reescreve histórico ou ref protegida, mexe em tag ou grava a configuração pessoal nega com a razão; `gitNeverAsks` converte em `deny` qualquer `ask` que venha de dentro do comando `git`. O git em repositório fora do projeto não pergunta mais. `AGENTS.md` e G63/G85 refletem a regra.

- Política de shell: `git push` não pede autorização (decisão do dono, 11/10/2026). `judgePush` só passa ou nega, nunca pergunta, nos três harnesses. Passa para branch de trabalho `<tipo>/<slug>`, forçado (`-f`, `--force`, `--force-with-lease`, `+ref`) ou não, com `--no-verify` ou `--prune`, e apagar branch de trabalho. Nega o destino `main`/`staging`/`dev` por qualquer refspec ou pelo destino real (`@{push}`, upstream, `HEAD`, configuração persistida), `--all`/`--mirror`/`--branches`, tag apagada ou sobrescrita e ref sem `/` apagada, e o destino que o texto não resolve (variável, curinga, `HEAD` sem contexto, `-c` de chave do push, configuração que desvia o destino) com a mensagem "explicite o destino (`git push origin <branch>`)", que o agente corrige sozinho. O push em repositório fora do projeto também não pergunta, e o alias de `-c` sem `!` (`git -c alias.p=push p origin main`) vale como o push que expande. `CLAUDE.md` e G63/G85 registram a regra: a rotina nunca pede autorização ao dono, e o que ainda perguntar é defeito de configuração da política.

- Permissões (decisão do dono, 11/10/2026): editar hook, `scripts/harness/`, `opencode.json`, `.codex/` e `.opencode/plugins/` deixa de perguntar, na ferramenta de edição (`.claude/settings.json`, com o espelho do OpenCode regenerado por `pnpm harness:sync`) e na shell. Só a lista de permissões, `.claude/settings.json`, continua perguntando.

### Corrigido

- Política de shell (juiz da #521, menores): `git push` com destino em `refs/remotes/*` (ou outro namespace fora de heads e tags) nega, e a saída redirecionada de um comando que só lê (`git log > ~/x.txt`) passa para a home fora da configuração pessoal.
- Política de shell (juiz da #521): `GIT_CONFIG_KEY_n=alias.*` nega com ou sem `!`, a detecção de push considera `-c alias.<x>=push`, e `push --receive-pack`/`--exec`, `fetch|pull|clone|ls-remote --upload-pack` e `archive --exec` negam, porque rodam o programa indicado no repositório local.

- Política de shell (#475): o git aceita o prefixo único de uma opção longa (`reset --har`, `switch --discard`, `checkout --forc`, `worktree remove --forc`, `tag --dele`, `gc --prun`, `rebase --exe`, `restore --work`, `config --glo`), e o classificador só reconhecia a forma completa, então a abreviada passava sem pergunta nos três harnesses. `expandGitOptions` troca a abreviação pela opção completa, por subcomando (`GIT_LONG_OPTIONS`), antes de julgar, nas duas direções (a que escreve e a que libera, como `clean --dr` e `rm --cac`); a forma exata vence (`fetch --prune`), o que vem depois de `--` não muda e o prefixo ambíguo vale como a opção mais perigosa.
- Política de shell (#505): configuração persistida do push desviava o destino do `git push origin feat/x` sem pergunta. `git config` que grava `push.*`, `remote.*`, `url.*.insteadOf`/`pushInsteadOf`, `branch.<b>.merge`/`remote`/`pushRemote` ou `include.path` nega, com a instrução de passar o destino no comando (`git push origin <branch>:<branch>`), em toda forma (`-c`, `--git-dir`, `sh -c`, `-C "$PWD"`, alias), e escrever `.git/config` por fora do `git config` também nega; `git push -u`, `git branch -u` e `git remote add` continuam passando; o contexto do git conferido (`push-target.mjs`) passa a ler `remote.pushDefault`, `branch.<b>.pushRemote` e `url.*.pushInsteadOf`, que fazem o push sem `:` e o sem refspec negarem, com a instrução de explicitar o destino. `git push -u origin <tipo>/<slug>` e `git push` em branch de trabalho continuam passando.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
