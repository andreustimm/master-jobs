## Técnico

### Alterado

- CI de PR (#535, 2 de 2): `banco-nas-majors` passa a esperar o `plano` e, em `pull_request` com base `dev`, só roda quando o diff toca o banco (`DATABASE_PATTERNS` em `scripts/github/ci-plan.ts`: `drizzle/`, `src/core/db/`, `supabase/`, `tests/support/`, `config/postgres-majors.json`, dependências, configuração do `drizzle-kit` e o runner do job) — era 13% dos minutos do CI. `qualidade` e `schema-e-migracao` aceitam o pulo só com o `plano` verde dizendo `banco=false`; `escopo` (#528) fica só com o `pwa-browser`. As decisões do `plano` viram a tabela `DECISIONS`, uma saída por job recortado. O item da decisão de 13/10/2026 que pulava `testes`, `cobertura` e `build` em PR só de documentação não foi aplicado: colide com a evidência da #528 (o Vitest lê documentos, o Tailwind varre os `.md`), e vale a fonte mais protetora.
- Tabela de impacto 1.2.0: classe `runtime-markdown` (textos legais, prompts e changelogs compilados pedem tipos, testes e build) e `browser-visible` (textos legais, changelogs, `scripts/build-changelog.ts` e a CSP de `next.config.ts` pedem E2E).

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
