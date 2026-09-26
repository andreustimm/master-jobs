## Técnico

### Alterado

- `scripts/build-changelog.ts` passa a ler também o `CHANGELOG.md` técnico e compila, de forma retroativa, toda versão publicada sem nota de usuário como entrada `internal: true` (`technicalReleases` e `internalReleases` em `src/core/changelog.ts`, funções puras). A data vem do marcador `sem-nota-usuario` quando ele a traz e, na falta, do cabeçalho técnico; o texto técnico nunca chega ao artefato, e versão com nota de usuário malformada não vira "interna". O modal mostra a linha `changelog.internal` do dicionário. O `CHANGELOG.md` passa a ser entrada obrigatória da geração (#340).

## pt-BR

### Melhorado

- O modal Novidades agora lista todas as versões publicadas, começando pela versão em uso. As versões sem mudança visível aparecem com a data e a linha "Melhorias internas, sem mudança visível.".

## en

### Improved

- The What's new dialog now lists every published version, starting with the one in use. Versions without a visible change show their date and the line "Internal improvements, no visible change.".
