---
id: PROF-version-actions-table
area: PROF
title: Ver, renomear, restaurar e excluir uma versão do currículo pela lista
persona: Andreus no celular
journey: J-refresh-candidate-ranking
expected: Cada linha da lista de versões mostra Ver e Renomear, e fora da atual também Restaurar e Excluir; o nome da ação aparece no hover e no foco (tooltip acima) e, em 375 px, ao lado do ícone; Ver abre o CV daquela versão num modal que alterna Renderizado/Markdown e devolve o foco ao ícone; restaurar e excluir pedem confirmação que nomeia a versão, com foco em Cancelar; Cancelar e Esc não mudam nada; Confirmar e Salvar mudam a lista e sobrevivem a refresh; o botão e o modal Histórico seguem iguais
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PROF-rescore-status-visibility
---

Entrega da #312. Em 375 px e em 1280 px, em português e em inglês: abrir a
área do candidato, passar o mouse e tabular pelos ícones de uma versão antiga,
abrir Ver e fechar com Esc, cancelar uma exclusão e uma restauração, renomear
com Esc e com Salvar, e só então confirmar uma exclusão numa versão criada para
o teste. Recarregar e conferir o resultado. Conferir que o botão Histórico
continua abrindo o mesmo modal de antes.
