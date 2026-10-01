# BUG-20261001-gap-uses-owner-profile: a análise de lacunas mede o currículo de qualquer candidato com o vocabulário do dono

- **Status:** fixed
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Candidato convidado sem perfil
- **Journey Step:** J-refresh-candidate-ranking, leitura da seção de lacunas de vocabulário em `/candidate`
- **Scenarios:** PROF-gap-own-vocabulary
- **Found:** 2026-10-01 (achado fora de escopo das PRs #418 e #414) · **Report:** docs/qa/reports/2026-10-01-gap-perfil-proprio-targeted.md

## Summary

`analyseGap` montava a lista de termos com `loadProfile(true)`, o
`profile.yaml` da instalação, que é o perfil do dono. Numa instalação com mais
de um candidato, a seção de lacunas de qualquer conta mostrava "ausente",
"confirmado" e "raro no mercado" medidos com um vocabulário que a pessoa nunca
escolheu buscar.

## Reproduction

- **Issue:** #427 · **Environment:** leitura do código e teste de banco com duas contas

1. Criar duas contas candidato; dar à segunda uma trilha principal com termos
   diferentes dos do `profile.yaml`.
2. Pontuar uma vaga que cite termos dos dois vocabulários para a segunda conta.
3. Chamar `analyseGap` para a segunda conta.

**Expected:** só os termos da busca principal dela aparecem.
**Actual:** os termos do `profile.yaml` do dono aparecem, e os dela não.

## Evidence

- `tests/cov-core-candidate-gap.test.ts`, blocos "o vocabulário é do
  candidato, não o do dono" e "os termos são os da trilha principal".
- Área E2E `candidate-gap` (`tests/e2e/ui/candidate-gap.mjs`).

## Fix

- **Root cause:** `analyseGap` lia `loadProfile(true)` para qualquer
  `candidateId`. A primeira correção (`e53f4972`) trocou por `personProfile`,
  que devolve o perfil gravado, e a fila grava um perfil derivado do currículo
  para qualquer conta, dono incluído: as `keywords` desse perfil são as skills
  que o CV já cita, e "faltante" ficava vazio por construção (achado Major 1
  da revisão L2 da PR #431).
- **Fix commit:** `e53f4972`, `78c047fd`. `analyseGap` tira termos e vagas da
  mesma trilha principal, pelo perfil efetivo do scorer
  (`trackScoringProfiles`): `keywords` do alvo da principal e notas dessa
  trilha. Principal pendente devolve relatório vazio.
- **Regression test:** `tests/cov-core-candidate-gap.test.ts` (quatro casos
  reprovam com `e53f4972`) e a área E2E `candidate-gap` (três verificações da
  convidada reprovam com `e53f4972`).

## Verification

- **Retested:** 2026-10-01, `node tests/e2e/run-isolated.mjs --areas candidate-gap` 39/39 (com a fumaça e `candidate-rescore`); vitest dos arquivos afetados; `pnpm typecheck`. Relatório: `docs/qa/reports/2026-10-01T201500Z-gap-trilha-principal-retest.md`.
- **Result:** pass.
