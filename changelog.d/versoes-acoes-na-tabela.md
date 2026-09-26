## Técnico

### Adicionado

- `/candidate`: a lista de versões do currículo ganhou ações por linha (Ver, Renomear e, fora da atual, Restaurar e Excluir) em `app/candidate/version-table.tsx`, como atalho adicional ao modal Histórico, que não muda. As duas superfícies compartilham `useVersionActions` e chamam as mesmas Server Actions já guardadas; nenhuma action nova. Toda ação com efeito exige confirmação (foco inicial em Cancelar, Esc cancela), Ver abre um `<dialog>` próprio com o conteúdo da versão e o foco volta ao ícone. Botão só-ícone e tooltip entram no DESIGN.md (#312).

## pt-BR

### Novidade

- Na área do candidato, cada versão do currículo tem ícones para ver, renomear, restaurar e excluir direto na lista, sem abrir o histórico. Toda ação pede confirmação antes de mudar alguma coisa, e passar o mouse (ou focar pelo teclado) mostra o nome da ação; no celular o nome aparece ao lado do ícone.

## en

### New

- In the candidate area, each CV version now has icons to view, rename, restore and delete it right in the list, without opening the history. Every action asks for confirmation before changing anything, and hovering (or focusing with the keyboard) shows the action's name; on phones the name appears next to the icon.
