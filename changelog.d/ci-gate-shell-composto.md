## Técnico

### Adicionado

- Gate da G63 versionado (#380): `.claude/hooks/no-compound-bash.mjs`, registrado em `.claude/settings.json` como `PreToolUse` do Bash, recusa com saída 2 comando de shell composto (`&&`, `||`, `;`, `|`, `&` de segundo plano, `$(...)`, crase, heredoc e várias linhas fora de aspas); separadores entre aspas, `2>&1`, `&>` e `\;` do `find -exec` passam. A mensagem de recusa sugere `git commit -F <arquivo>` quando o motivo é heredoc ou `$(...)`. `tests/no-compound-bash.test.ts` cobre a tabela de casos e executa o hook real com o JSON do `PreToolUse` na entrada. Codex mantém o guard próprio, que julga por trecho; OpenCode não tem hook (lacuna registrada na G63).

## pt-BR

### Adicionado

- Os agentes que trabalham no repositório passam a ser impedidos de mandar vários comandos de terminal numa só chamada, o que fazia o terminal parar e pedir aprovação manual para comandos simples.

## en

### Added

- Agents working in the repository are now prevented from sending several terminal commands in a single call, which used to stall the terminal waiting for manual approval of simple commands.
