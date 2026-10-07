## Técnico

### Corrigido

- O `.dockerignore` aplica os padrões de segredo e de banco local com `**/`, no fim do arquivo, para que nenhuma reinclusão (como `!.claude/hooks`) reabra um `.env` ou `*.token.json` criado num subdiretório; `tests/dockerignore-imports.test.ts` confere cada padrão dentro de todo diretório reincluído (#490).
- `resolveLocal` (`tests/support/module-graph.ts`) resolve o apelido `@core/*`, `.js` que nomeia o `.ts` irmão e `index.tsx`, com teste.
- A dica de "ampliar busca" do Funil só promete sinônimos quando a lista está em uso (`SEARCH_SYNONYMS_ENABLED` ligada e arquivo válido); desligada, fala só de cargo com grafia parecida.
- `config/e2e-spec-map.json`: as peças de filtro que o Funil importa de Vagas selecionam as duas telas no E2E seletivo.

## pt-BR

### Corrigido

- No Funil, a explicação de "ampliar busca" deixa de prometer sinônimos quando eles não estão ligados.

## en

### Fixed

- In the Pipeline, the "broaden search" explanation no longer promises synonyms when they are turned off.
