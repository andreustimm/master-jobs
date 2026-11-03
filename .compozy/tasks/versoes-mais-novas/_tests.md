# Contrato de testes — #468

Cada ID aponta para o teste que já prova o item. Local: `pnpm typecheck`,
`pnpm check:versions` e `vitest related` do diff; a suíte inteira e a matriz
de majors são do CI.

## Versões escritas e gate

- **V1** Imagem só com tag fixa ou digest; `latest`, sem tag e digest
  malformado reprovam — `tests/version-policy.test.ts` ("imagem com versão
  explícita").
- **V2** Workflows: `runs-on` flutuante, `uses:` sem versão ou em branch,
  `container`/`services` sem versão reprovam — idem ("workflows").
- **V3** Dockerfile resolve `ARG` padrão e ignora estágio reaproveitado;
  Compose confere o padrão de `${VAR:-imagem}` — idem ("Dockerfile",
  "Compose").
- **V4** Major do Node igual em `engines.node`, `.nvmrc`, `@types/node` e
  imagens `node:*` — idem ("major do Node em todas as fontes");
  `tests/deploy-fly.test.ts` (imagem base na major de `engines.node`, pnpm
  vindo de `packageManager`).
- **V5** O repositório real passa no gate, o Python tem versão completa, e o
  gate roda no `pnpm check` e num job exigido pelo agregador — idem ("o
  repositório cumpre a política").
- **V6** Runner hospedado escrito (`HOSTED_RUNNER`), inclusive na guarda de
  fork — `tests/ci-runner-selection.test.ts` (F2-01, F2-04); o vigia de cota
  reverte com `gh variable delete CI_RUNS_ON`, no domínio e no SQL —
  `tests/quota-watch-domain.test.ts` (F3-05).

## PostgreSQL

- **P1** `config/postgres-majors.json` tem `latest`, `local` e `production`,
  na ordem production ≤ local ≤ latest; fora dela ou sem chave, recusa —
  `tests/version-policy.test.ts` ("majors do PostgreSQL testadas"), com
  valores sintéticos.
- **P2** Banco descartável na mais nova por padrão; `JHO_TEST_POSTGRES_MAJOR`
  só aceita major declarada; o servidor que subiu precisa reportar a major
  pedida — idem; `tests/support/postgres-global.ts`.
- **P3** Todo teste que usa PostgreSQL real entra na suíte das majors,
  derivado do grafo de imports e da URL de teste — idem ("todo teste que usa
  PostgreSQL real…", "a seleção segue helper intermediário…").
- **P4** Matriz `production|latest` × fatias, pela chave; `schema-e-migracao`
  com `always()` reprova em `failure`, `skipped`, `cancelled` e `needs` vazio
  — idem ("o check obrigatório `schema-e-migracao`…");
  `tests/promotion-provenance.test.ts` (check obrigatório com `needs` exige
  `always()`).
- **P5** O ensaio de corte passa na major da rodada —
  `tests/production-selection.test.ts`.
- **P6** Workflow e docs citam as chaves, não os números — idem ("workflow e
  docs citam as chaves…").
- **P7** O Compose local fica na major `local`; outra major reprova o gate —
  idem ("o Compose local fica na major `local`…").

## Renovate

- **R1** PR para `dev`, `rangeStrategy: bump`, commit `chore` — idem
  ("renovate.json").
- **R2** Nenhum `automerge` ligado em lugar nenhum, e explícito em cada regra
  — idem ("nada mescla sozinho…").
- **R3** Quarentena de um dia igual à do pnpm, declarada em
  `pnpm-workspace.yaml` — idem.
- **R4** Major de Node, `@types/node` e pnpm só com `confirmar-vercel` — idem.
- **R5** Subir `latest` não tira `production` do CI; a regex do runner alcança
  toda etiqueta `ubuntu-NN.NN`; os arquivos fora dos gerenciadores padrão
  estão cobertos — idem.
- **R6** A imagem Supabase do Compose é lida pelo Renovate, inclusive de
  major, e nenhuma regra a bloqueia — idem ("o Renovate sobe a imagem
  Supabase do Compose local…").

## Sentry 11 e ferramentas

- **S1** Um cliente real do SDK resolve toda coleta de `dataCollection` como
  desligada — `tests/sentry-tracing.test.ts`,
  `tests/instrumentation-guard.test.ts` (`tests/support/sentry-client.ts`).
- **S2** Ciclo de trace estático e `beforeSendSpan` marcado por
  `withStaticSpan` (também achado em `default`); sem ele, não inicializa —
  `tests/instrumentation-guard.test.ts`, `tests/sentry-tracing.test.ts`.
- **S3** A major instalada do `@sentry/nextjs` é a que as peneiras conhecem —
  `tests/instrumentation-guard.test.ts`.
- **T1** Vitest 5: blobs em `.vitest/blob` (`tests/ci-pipeline.test.ts`),
  `concurrent: false` no lugar de `describe.sequential`
  (`tests/pwa-chrome.test.ts`); o gancho de navegação do Next confere a major
  declarada, não um patch exato (`tests/navigation-transition.test.ts`).

## Não coberto aqui

- Build da Vercel com a major nova (o CI não o roda): rótulo
  `confirmar-vercel` e conferência à mão.
- Renovate em execução: depende de o dono instalar o app.
- Bootstrap local numa major nova da Supabase: smoke test manual de
  `docker/postgres/verify.sql` ([local-postgres.md](../../../docs/engineering/local-postgres.md)).
