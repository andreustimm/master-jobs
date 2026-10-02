## Técnico

### Corrigido

- `src/core/llm/registry.ts`: `keyPresent` e `portFor` leem a chave pela mesma função, aparada como `redactKey` já fazia. Uma variável só com espaços ou quebra de linha deixa de contar como chave presente: antes o banner dizia `ok` e o comando mostrava "(ausente)" e falhava com 401. O valor aparado é o que segue no cabeçalho.
- `chooseModel` escolhe o padrão pela linha (id e provedor), não só pelo id: com o mesmo id em dois provedores, o padrão marcado em um não vira o outro. `jho llm list` marca "em uso" comparando também o provedor.
- `jho jobs verify` e `staleCandidates` usam `DEFAULT_VERIFY_MIN_FIT` no lugar do 55 literal, e o texto de ajuda de `--min-fit` o cita; o teste de banco prova que a verificação global sem `minFit` conta só a vaga de nota 55 ou mais em `dueTotal` e `fetched`.

## pt-BR

### Corrigido

- `jho llm list` não marca mais duas linhas como "em uso" quando o mesmo modelo existe em dois provedores, e uma chave só com espaços no `.env` passa a aparecer como ausente em vez de `ok`.

## en

### Fixed

- `jho llm list` no longer marks two rows as "in use" when the same model exists under two providers, and a key made only of whitespace in `.env` now shows as missing instead of `ok`.
