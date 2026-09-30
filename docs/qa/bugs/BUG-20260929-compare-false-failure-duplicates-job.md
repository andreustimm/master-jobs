# BUG-20260929-compare-false-failure-duplicates-job: /compare diz que falhou mas cadastra a vaga

- **Status:** verified
- **Impact (user-side):** Data-Loss
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao cadastrar uma vaga manual em `/compare`
- **Scenarios:** `docs/qa/scenarios/COMPARE-manual-cadastro-idempotente.md`
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente.md

## Summary

Em `/compare`, clicar em "Cadastrar e comparar" mostrava "A comparação não
pôde ser concluída. Tente novamente." e apagava o formulário embora a vaga já
tivesse sido persistida. Uma nova tentativa podia levar a uma segunda
observação da mesma vaga.

## Reproduction

- **Charter:** CH-first-party-navigation-inventory · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), conta `qa-full-candidate-a`
  sem CV

1. Abrir `/compare` e preencher os dados de uma vaga manual.
2. Clicar em "Cadastrar e comparar".
3. Ler a mensagem de erro e conferir o acervo (`/jobs`) para a vaga recém
   descrita.
4. Tentar de novo com os mesmos dados.

**Expected:** depois de persistida, a operação informa sucesso e leva à ficha;
se o score não estiver disponível, a ficha informa esse estado. Repetir o
mesmo cadastro mantém um único `jobId`.

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-first-party-navigation-inventory/compare-failed.png`

## Fix

- **Root cause:** `addManualDescriptionJob` persistia a vaga antes de
  `scoreOne`; para uma conta sem perfil próprio, `scoreOne` retornava `null` e
  `createManualComparison` convertia esse estado válido em
  `ComparisonInputError("unexpected")`.
- **Fix:** o score da comparação passou a ser derivado em melhor esforço. A
  persistência continua idempotente pelo fingerprint isolado de comparação;
  depois de obter o `jobId`, a ação redireciona para a ficha mesmo sem score.
- **Fix commit:** `a80dd061b7598189e06fd8741545b7c6686f5a01`
- **Regression test:** `tests/cov-matching-manual-comparison.test.ts`, caso
  "mantém o cadastro quando o candidato ainda não tem perfil para pontuar".

## Verification

- **Automated:** `pnpm vitest run tests/cov-matching-manual-comparison.test.ts`
  — 20 testes passaram após o fix.
- **E2E:** `node tests/e2e/run-isolated.mjs --areas candidate-rescore` — 25/25
  verificações passaram, incluindo comparação, upload e viewport de 375 px.
- **Journey:** 2026-09-29, conta isolada `daniel@local.test` sem perfil:
  `/compare?job=7#comparison-result` mostrou o estado traduzido sem score,
  refresh preservou a ficha, a repetição voltou ao mesmo `job=7` e `/jobs`
  mostrou uma ocorrência de `Senior AI Software Architect` depois da segunda
  tentativa.
- **Evidence:** `docs/qa/evidence/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente/CH-first-party-navigation-inventory-compare-retest-1-result.png`,
  `docs/qa/evidence/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente/CH-first-party-navigation-inventory-compare-retest-1-refresh.png` e
  `docs/qa/evidence/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente/CH-first-party-navigation-inventory-compare-retest-1-jobs-after-retry.png`.
