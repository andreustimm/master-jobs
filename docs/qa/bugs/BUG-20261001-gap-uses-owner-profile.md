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

1. Criar duas contas candidato; dar à segunda um perfil de matching próprio com
   termos diferentes dos do `profile.yaml`.
2. Pontuar uma vaga que cite termos dos dois vocabulários para a segunda conta.
3. Chamar `analyseGap` para a segunda conta.

**Expected:** só os termos do perfil dela aparecem.
**Actual:** os termos do `profile.yaml` do dono aparecem, e os dela não.

## Evidence

- `tests/cov-core-candidate-gap.test.ts`, bloco "o vocabulário é do candidato,
  não o do dono": reprova sem a correção (2 casos) e passa com ela.

## Fix

- **Root cause:** `analyseGap` lia `loadProfile(true)` para qualquer `candidateId`.
- **Fix commit:** pendente (PR da #427 ainda não mesclada). `analyseGap` passa a
  usar `personProfile(candidateId)` do contexto de matching: o perfil gravado do
  candidato; o dono sem perfil gravado usa o `profile.yaml`, que é dele; quem
  não tem nenhum dos dois recebe um relatório sem vagas e sem termos, a mesma
  regra que impede pontuá-lo.
- **Regression test:** `tests/cov-core-candidate-gap.test.ts`.

## Verification

- **Retested:** `pnpm vitest run tests/cov-core-candidate-gap.test.ts` (22/22), E2E `candidate-rescore` (33/33) e `onboarding`/`cv-versions` (99/99 junto com a fumaça), `pnpm typecheck`.
- **Result:** automatizado passa; percurso manual com duas contas pendente (ver o cenário).
