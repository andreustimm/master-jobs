## Técnico

### Alterado

- CI de PR (#535): novo job `plano` no `ci.yml` lê o diff do commit de merge da PR contra a base e roda `planGates` (a mesma tabela de impacto de `pnpm gates`, `config/validation-impact.json`). O `e2e-navegador` passa a esperar só o `plano` e, em `pull_request` com base `dev`, só roda quando o gate `e2e` está no plano — 18 de 50 PRs medidos não tocavam nada que a tabela mande testar em navegador, e o E2E era 41,6% dos minutos do CI. Decisão do dono de 13/10/2026, que afrouxa a G57 só nesse ponto. Falha fechada: push em `dev`, `staging` e `main`, `workflow_dispatch`, chamada da promoção, PR de produção, diff vazio ou ilegível e PR que muda o próprio plano rodam o E2E como antes. `plano` entra em `qualidade.needs`; o workflow continua sem `paths:`. Prova: `tests/ci-plan.test.ts` (inclui Git de verdade com commit de merge) e `tests/ci-pipeline.test.ts`.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
