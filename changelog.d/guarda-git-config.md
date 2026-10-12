## Técnico

### Alterado

- Política de shell: `git push` não pede autorização (decisão do dono, 11/10/2026). `judgePush` só passa ou nega, nunca pergunta, nos três harnesses. Passa para branch de trabalho `<tipo>/<slug>`, forçado (`-f`, `--force`, `--force-with-lease`, `+ref`) ou não, com `--no-verify` ou `--prune`, e apagar branch de trabalho. Nega o destino `main`/`staging`/`dev` por qualquer refspec ou pelo destino real (`@{push}`, upstream, `HEAD`, configuração persistida), `--all`/`--mirror`/`--branches`, tag apagada ou sobrescrita e ref sem `/` apagada, e o destino que o texto não resolve (variável, curinga, `HEAD` sem contexto, `-c` de chave do push, configuração que desvia o destino) com a mensagem "explicite o destino (`git push origin <branch>`)", que o agente corrige sozinho. O push em repositório fora do projeto também não pergunta, e o alias de `-c` sem `!` (`git -c alias.p=push p origin main`) vale como o push que expande. `CLAUDE.md` e G63/G85 registram a regra: a rotina nunca pede autorização ao dono, e o que ainda perguntar é defeito de configuração da política.

### Corrigido

- Política de shell (#475): o git aceita o prefixo único de uma opção longa (`reset --har`, `switch --discard`, `checkout --forc`, `worktree remove --forc`, `tag --dele`, `gc --prun`, `rebase --exe`, `restore --work`, `config --glo`), e o classificador só reconhecia a forma completa, então a abreviada passava sem pergunta nos três harnesses. `expandGitOptions` troca a abreviação pela opção completa, por subcomando (`GIT_LONG_OPTIONS`), antes de julgar, nas duas direções (a que escreve e a que libera, como `clean --dr` e `rm --cac`); a forma exata vence (`fetch --prune`), o que vem depois de `--` não muda e o prefixo ambíguo vale como a opção mais perigosa.
- Política de shell (#505): configuração persistida do push desviava o destino do `git push origin feat/x` sem pergunta. `git config` que grava `push.*`, `remote.*`, `url.*.insteadOf`/`pushInsteadOf`, `branch.<b>.merge`/`remote`/`pushRemote` ou `include.path` agora pergunta nos três harnesses (`-c include.path` também), e o contexto do git conferido (`push-target.mjs`) passa a ler `remote.pushDefault`, `branch.<b>.pushRemote` e `url.*.pushInsteadOf`, que fazem o push sem `:` e o sem refspec perguntarem. `git push -u origin <tipo>/<slug>` e `git push` em branch de trabalho continuam passando.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
