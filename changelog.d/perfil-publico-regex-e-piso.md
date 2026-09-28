## Técnico

### Corrigido

- `src/core/public-cv.ts`: custo linear na rota anônima `/p/[slug]`, que filtra o CV duas vezes por visita. A regex `EMAIL` só começa no início de uma sequência de caracteres de endereço (lookbehind), com leitura sticky para o endereço colado ao anterior; o telefone internacional lê os grupos com regex sticky em vez de `slice`; o rótulo `valor hora` deixa de ter dois `\s*` em volta do separador. Teste de custo sobre `publicCvMarkdown()` em `tests/public-cv.test.ts` (#344).
- `publicCvText()`: num bloco com títulos de seção (CV de PDF sem linha em branco), sai a seção do piso — do rótulo, quando é título, ou do título anterior, até o próximo nome de seção conhecido (`isKnownHeading()`, exportado de `src/core/cv-markdown.ts` com `isHeading()`). Sem título, sem valor na seção ou com resto que ainda parece piso, o bloco inteiro sai, como antes. G23 atualizada (#344).

## pt-BR

### Corrigido

- O perfil público não some mais inteiro quando o currículo importado de PDF traz a pretensão salarial: sai a seção da pretensão, e o resto do currículo fica.

## en

### Fixed

- The public profile no longer disappears entirely when a résumé imported from PDF includes a salary expectation: the salary section is left out and the rest of the résumé stays.
