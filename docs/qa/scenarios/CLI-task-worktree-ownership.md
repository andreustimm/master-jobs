---
id: CLI-task-worktree-ownership
area: CLI
title: Disputar e transferir a posse entre duas worktrees
persona: Operador somente por teclado
journey: J-coordinate-task-delivery
expected: Uma execução conserva posse confirmada, a transferência recusa a geração antiga e a retomada não duplica efeitos nem perde WIP
entry_points: rtk pnpm tasks show <issue> --json; rtk pnpm tasks claim <issue>; rtk pnpm tasks verify <issue>
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps:
---

No [piloto #191](https://github.com/andreustimm/master-jobs/issues/191), usar uma
issue de piloto atribuída ao operador e duas worktrees próprias, com branches,
IDs de worktree e UUIDs de execução distintos. Ler o remoto em ambas, disputar
claim e guardar os UUIDs e links dos recibos. O mesmo login humano não pode
fazer duas execuções parecerem um único detentor.

Interromper a espera do cliente depois de guardar o UUID da operação;
retomar com esse UUID. Confirmar por nova leitura da CLI e pela issue e caixa
de entrada recarregadas no GitHub, sem fabricar recibos nem editar o journal.
Pendência não permite iniciar trabalho.

Com a chave pública do destino criada pela CLI, transferir a posse. Conferir
o destino com `verify`, tentar heartbeat ou transição na execução antiga e
observar a recusa. Ao abandonar, registrar handoff e confirmar `release`;
reler o remoto e confirmar que as worktrees e seu WIP foram preservados.

Sem escritor inicializado e credenciais validadas em `main`, o cenário
continua sem execução. Planejamento e testes fake não são evidência de Pass.

