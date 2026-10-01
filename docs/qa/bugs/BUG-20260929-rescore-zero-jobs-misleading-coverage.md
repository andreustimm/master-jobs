# BUG-20260929-rescore-zero-jobs-misleading-coverage: rescore com CV fraco zera o ranking sem motivo e a análise de lacunas mente sobre cobertura

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-refresh-candidate-ranking, passo de atualizar o ranking após salvar nova versão do CV
- **Scenarios:** PROF-rescore-refused-reason; PROF-rescore-status-visibility
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Quem atualiza o CV para uma versão fraca (133 caracteres, sem skill
reconhecível) vê o ranking dizer "Up to date — refreshed for 0 jobs", sem
nenhum `data-reason` explicando por quê. Pior: a análise de lacunas do mesmo
candidato afirma que o CV "cobre o que as vagas pedem" — comparando contra
zero vagas pontuadas. A pessoa lê duas mensagens que juntas soam positivas
("atualizado", "cobre o que pedem") quando o produto na verdade não conseguiu
pontuar nenhuma vaga contra aquele CV. É o oposto do que a tela deveria
comunicar.

## Reproduction

- **Charter:** CH-save-cv-ranking-refresh · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), pt-BR, conta
  `qa-full-candidate` com CV de 133 caracteres sem skills estruturadas

1. Entrar como o candidato e salvar uma nova versão de CV curta, sem skills
   reconhecíveis pelo scorer.
2. Pedir para atualizar o ranking.
3. Ler o status de rescore e a análise de lacunas em `/candidate`.

**Expected:** o status nomeia o motivo de zero vagas pontuadas (`data-reason`),
e a análise de lacunas não afirma cobertura completa quando não há vaga
nenhuma para comparar.
**Actual:** "Up to date — refreshed for 0 jobs" sem `data-reason`; análise de
lacunas diz "cobre o que as vagas pedem" comparando com 0 vagas.

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/adhoc-prof/09-weakcv-uptodate-0-jobs.png`
- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/adhoc-prof/08-refused-weakcv-375-en.png`
- Re-observado numa segunda sessão (lane pipe, mesma rodada), mesmo sintoma
  após salvar nova versão de CV e pedir refresh — ver debrief "Lane pipe" no
  relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `ScoreQueueCard` não nomeava `data-reason` quando `scored === 0` com `state === "done"`, então "0 vagas" e "atualizado" apareciam juntos sem causa — commit `43ecd2d`. Revisão L1 da PR #418 achou dois resíduos do mesmo defeito: (1) `analyseGap` zera `coverage` de todo termo quando `jobsAnalysed === 0` (por design, ver `tests/cov-core-candidate-gap.test.ts`), mas a tela ainda renderizava os blocos "confirmado"/"raro no mercado" nesse caso — uma afirmação de mercado sem nenhuma vaga para sustentá-la; (2) o motivo `noJobsUpdated` repetia o sintoma ("pode terminar sem mudanças") em vez da causa real (perfil de busca mantido, CV novo não deriva nota nova).
- **Fix commit:** `43ecd2d` (PR original); `e7a497da` corrige o resíduo achado na revisão L1 (blocos de confirmado/raro e motivo `noJobsUpdated`).
- **Regression test:** `tests/score-queue-card.test.ts` (`data-reason=noJobsUpdated`); `tests/candidate-vocabulary-gap.test.ts` (blocos "confirmado"/"raro" ocultos sem vaga analisada, adicionado nesta rodada); `tests/cov-core-candidate-gap.test.ts` (o domínio continua devolvendo `coverage=0` por design). E2E `candidate-rescore` (33/33), incluindo a verificação nova de que o CV do dono volta ao conteúdo original depois do cenário de CV fraco.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** E2E isolado `node tests/e2e/run-isolated.mjs --areas candidate-rescore` (33/33) e `--areas cv-versions` (65/65, confirma que a área dependente não regride); `pnpm typecheck` e os testes de unidade acima.
- **Result:** Pass. `weakCv` continua distinto de `noJobsUpdated`; zero vagas não afirma cobertura nem destaca termo como raro no mercado; recuperação com CV forte volta a mostrar os blocos normalmente. Evidências e limitações da rodada original: `docs/qa/reports/2026-09-29T144500Z-codex387-zero-vagas.md`.
