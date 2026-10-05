## Técnico

### Corrigido

- Guarda do E2E (#435): `tests/e2e/database-guard.mjs` passa a recusar `E2E_BASE` fora do loopback ou inválida, e `JHO_TEST_DATABASE_URL` diferente de `DATABASE_URL`. `ui.mjs` e `a11y.mjs` consultam a guarda antes de abrir o navegador e antes do `finally` que apaga vagas; antes, só o `setup.mjs` a consultava. Assim, `pnpm test:e2e:external` não roda mais contra o site publicado.

### Documentação

- Roteiro do dono para apagar as contas do E2E que ficaram no banco de produção (candidatos 2 e 3, usuário 4) e deixar um único candidato com `is_default`: `docs/engineering/runbooks/435-contas-e2e-producao.md`. Ninguém o executou.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
