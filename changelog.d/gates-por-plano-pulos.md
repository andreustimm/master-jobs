## Técnico

### Alterado

- CI de PR (#535, 2 de 2): o job `plano` ganha duas saídas além de `e2e`. `suite` é falsa em PR L0 — quando a tabela de impacto pede só os validadores estruturais — e pula `testes`, `cobertura`, `build` e `pwa-browser`; `banco` só é verdadeira quando o diff toca `drizzle/**`, `src/core/db/**`, `supabase/**`, `tests/support/**` ou `config/postgres-majors.json`, e pula `banco-nas-majors` nas demais PRs. Decisão do dono de 13/10/2026, só em `pull_request` com base `dev`: push em `dev`, `validar`, dispatch, `staging` e a PR de produção rodam tudo. `qualidade` e `schema-e-migracao` rodam sempre e só aceitam `skipped` do job que o `plano`, verde, declarou pulado; pulado sem plano reprova (`tests/ci-pipeline.test.ts` executa o `jq` de cada combinação).
- Tabela de impacto 1.2.0: classe nova `runtime-markdown` para o Markdown que o app ou o build lê (`content/legal/`, `docs/prompts/`, `CHANGELOG.md`, `USER_CHANGELOG*.md`), que pede tipos, testes e build. Antes, a classe `docs` o tratava como documentação: `pnpm gates` local não rodava teste nem build para uma mudança nos Termos de Uso, e o L0 do CI o pularia.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
