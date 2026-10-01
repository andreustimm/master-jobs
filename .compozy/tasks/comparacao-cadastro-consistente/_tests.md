# Contrato de testes — #401

| ID | Caso | Prova exigida |
| --- | --- | --- |
| COMPARE-401-01 | Candidato sem perfil próprio cadastra uma vaga manual | `createManualComparison` retorna o `jobId`, mantém uma linha em `job` e não transforma `scoreOne === null` em erro |
| COMPARE-401-02 | Repetição do mesmo cadastro | duas chamadas com a mesma identidade devolvem o mesmo `jobId` e uma única linha em `job` |
| COMPARE-401-03 | Entrada inválida antes da persistência | erro de campo/formulário continua traduzível e nenhuma vaga parcial aparece |
| COMPARE-401-04 | Jornada no navegador | `/compare` mostra resultado de sucesso ou estado sem score depois do cadastro; atualizar a página preserva a ficha e a tentativa não duplica a vaga |

## Validação

- `pnpm vitest run tests/cov-matching-manual-comparison.test.ts`
- `pnpm typecheck`
- `node tests/e2e/run-isolated.mjs` para a jornada afetada, após liberação da
  fila E2E pelo coordenador.
