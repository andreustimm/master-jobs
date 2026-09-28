## Técnico

### Corrigido

- `src/core/public-cv.ts`: a regex `EMAIL` só começa a tentativa no início de uma sequência de caracteres de endereço (lookbehind), e o telefone internacional passa a ler os grupos com regex sticky em vez de `slice` a cada grupo; as duas eram quadráticas numa rota anônima que filtra o CV duas vezes por visita. Teste de custo linear em `tests/public-cv.test.ts` (#344).
- `publicCvText()`: num bloco de várias linhas (CV de PDF sem linha em branco), sai só o trecho do piso — a linha ou o par de linhas do rótulo, a vizinha de cima que abre o rótulo ou traz valor, a de baixo que traz valor e, sem valor, as de baixo até a primeira que traga. O resto é relido como texto corrido e, se ainda parece piso, o bloco inteiro sai, como antes (G23) (#344).

## pt-BR

### Corrigido

- O perfil público não some mais inteiro quando o currículo importado de PDF traz a pretensão salarial: só a pretensão fica de fora.

## en

### Fixed

- The public profile no longer disappears entirely when a résumé imported from PDF includes a salary expectation: only the salary expectation is left out.
