## Técnico

### Corrigido

- `publicCvText()`: o valor prometido por um rótulo de pretensão sem valor é procurado do rótulo em diante (`fromLabel()`), e o corte por seção só aceita valor que venha do rótulo em diante. Um número acima do rótulo ("Equipe de 12 pessoas") não cancela mais a retirada do parágrafo seguinte, que trazia o valor (#353).

## pt-BR

### Corrigido

- O perfil público não mostra mais a pretensão salarial escrita no parágrafo logo abaixo do rótulo quando havia um número qualquer acima dele.

## en

### Fixed

- The public profile no longer shows a salary expectation written in the paragraph right below its label when any number appeared above the label.
