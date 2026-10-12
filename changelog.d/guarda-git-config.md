## Técnico

### Corrigido

- Política de shell (#475): o git aceita o prefixo único de uma opção longa (`reset --har`, `switch --discard`, `checkout --forc`, `worktree remove --forc`, `tag --dele`, `gc --prun`, `rebase --exe`, `restore --work`, `config --glo`), e o classificador só reconhecia a forma completa, então a abreviada passava sem pergunta nos três harnesses. `expandGitOptions` troca a abreviação pela opção completa, por subcomando (`GIT_LONG_OPTIONS`), antes de julgar, nas duas direções (a que escreve e a que libera, como `clean --dr` e `rm --cac`); a forma exata vence (`fetch --prune`), o que vem depois de `--` não muda e o prefixo ambíguo vale como a opção mais perigosa.
- Política de shell (#505): configuração persistida do push desviava o destino do `git push origin feat/x` sem pergunta. `git config` que grava `push.*`, `remote.*`, `url.*.insteadOf`/`pushInsteadOf`, `branch.<b>.merge`/`remote`/`pushRemote` ou `include.path` agora pergunta nos três harnesses (`-c include.path` também), e o contexto do git conferido (`push-target.mjs`) passa a ler `remote.pushDefault`, `branch.<b>.pushRemote` e `url.*.pushInsteadOf`, que fazem o push sem `:` e o sem refspec perguntarem. `git push -u origin <tipo>/<slug>` e `git push` em branch de trabalho continuam passando.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
