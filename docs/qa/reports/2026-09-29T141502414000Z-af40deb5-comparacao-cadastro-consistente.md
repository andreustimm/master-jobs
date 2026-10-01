# QA Run Report — 2026-09-29T141502414000Z-af40deb5 — comparacao-cadastro-consistente

- **Scope:** PR draft da #401: cadastro manual em `/compare` sem falso erro após persistência, com idempotência e estado sem score
- **Issue:** [#401](https://github.com/andreustimm/master-jobs/issues/401)
- **PR:** [#413](https://github.com/andreustimm/master-jobs/pull/413) (draft)
- **Cadence tier:** targeted
- **Build:** `a80dd061b7598189e06fd8741545b7c6686f5a01` · **Environment:** runner isolado local de produção-paridade (`127.0.0.1`), conta de QA sem perfil
- **Started:** 2026-09-29T14:15:02Z · **Finished:** 2026-09-29T15:00:49Z · **Status:** pass

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | Power User | laptop / wifi-fast / pt-BR | CH-first-party-navigation-inventory |

## Flows in Scope

- `J-trust-the-filtered-board` — reduzir o acervo a uma decisão confiável e preservar o contexto (`../journeys/J-trust-the-filtered-board.md`)
- `J-switch-workspace-screen` — chegar a telas internas e ações redirecionadas sem mutações repetidas (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-first-party-navigation-inventory | J-trust-the-filtered-board / COMPARE-manual-cadastro-idempotente | Andreus em triagem | Feature Tour | Pass | BUG-20260929-compare-false-failure-duplicates-job | a80dd061b7598189e06fd8741545b7c6686f5a01 |
| 2 | CH-first-party-navigation-inventory | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus em triagem | Feature Tour | Pass (canário) | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

- charter: CH-first-party-navigation-inventory
  journey: J-trust-the-filtered-board
  persona: Andreus em triagem
  entry: login pela interface como `daniel@local.test`, depois link `Comparar vaga`
  steps:
    - step: 1
      attempted: preencher cargo, empresa, localização e descrição com mais de 100 caracteres
      observed: o formulário aceitou uma única fonte de descrição e manteve os campos válidos
      verdict: pass
    - step: 2
      attempted: cadastrar e comparar
      observed: `/compare?job=7#comparison-result` abriu a ficha e mostrou `Esta vaga ainda não possui score.`
      evidence: docs/qa/evidence/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente/CH-first-party-navigation-inventory-compare-retest-1-result.png
      verdict: pass
    - step: 3
      attempted: atualizar a URL de resultado
      observed: a mesma ficha e o estado sem score sobreviveram ao refresh
      evidence: docs/qa/evidence/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente/CH-first-party-navigation-inventory-compare-retest-1-refresh.png
      verdict: pass
    - step: 4
      attempted: abrir `/jobs` e repetir o mesmo cadastro pela interface de `/compare`
      observed: a lista mostrou `Senior AI Software Architect` uma vez antes e depois da repetição; a segunda submissão voltou ao mesmo `job=7`
      evidence: docs/qa/evidence/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente/CH-first-party-navigation-inventory-compare-retest-1-jobs-after-retry.png
      verdict: pass
  goal_reached: yes
  true_end_state: confirmed
  abandonment_paths: []
  paper_cuts: []
  bugs: [BUG-20260929-compare-false-failure-duplicates-job]
  scenarios_settled: {COMPARE-manual-cadastro-idempotente: pass}

- charter: CH-first-party-navigation-inventory
  journey: J-switch-workspace-screen
  persona: Andreus em triagem
  entry: lista `/jobs` já confirmada, navegação pelo link `Comparar vaga`
  steps:
    - step: 1
      attempted: abrir a tela de comparação pela navegação principal
      observed: a rota `/compare` abriu com seus controles nomeados
      evidence: docs/qa/evidence/2026-09-29T141502414000Z-af40deb5-comparacao-cadastro-consistente/CH-first-party-navigation-inventory-nav-compare.png
      verdict: pass
  goal_reached: yes
  true_end_state: confirmed
  abandonment_paths: []
  paper_cuts: []
  bugs: []
  scenarios_settled: {NAV-first-party-navigation-contract: pass}

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-trust-the-filtered-board | pass | pass | pass | pass | pass | local isolated only | result, refresh, retry and `/jobs` evidence above |
| J-switch-workspace-screen | pass (canário) | pass (named controls) | pass | pass | pass | local isolated only | `/jobs` → `/compare` navigation evidence above |

## What Was Fixed

### BUG-20260929-compare-false-failure-duplicates-job: cadastro manual sem falso erro

- **Symptom:** a mensagem dizia falha depois que a vaga já havia entrado no acervo.
- **Root cause:** `scoreOne` retornava `null` para candidato sem perfil próprio e o caso de uso transformava isso em `unexpected` depois da persistência.
- **Fix:** `a80dd061b7598189e06fd8741545b7c6686f5a01` — o score derivado passou a ser melhor esforço após a persistência do `jobId`.
- **Regression test:** `tests/cov-matching-manual-comparison.test.ts` — falhou antes e passou depois.
- **Retested:** jornada original e canário adjacente passaram em 2026-09-29.

## Paper Cuts

| Persona | Onde (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de página ou console foi observado pela sessão `compare401`.

## Human Verifications Needed

- [x] Nenhuma: o runner isolado preparou a conta `daniel@local.test` e a sessão percorreu a jornada por UI.

## Decisions for a Human

Nenhuma: a correção é pequena, tem causa confirmada e não envolve decisão de produto.

## Learnings

- A ausência de score é estado derivado do candidato e não pode descrever como falho um cadastro já persistido.

## Final Status

<!-- Escrito somente após as sessões, validação automatizada e gate final. -->

- **Exit gate (targeted automated suite):** `node tests/e2e/run-isolated.mjs --areas candidate-rescore` — 25/25 verificações passaram. Um `pnpm check` opcional nesta sessão não foi usado como gate e parou no timeout de `UT-115`; a validação relacionada permaneceu verde (91/91).
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 1 · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 2/2 jornadas percorridas; cenário COMPARE retestado com evidência independente após refresh e retry.
- **Verdict:** pass — correção verificada no E2E afetado e na jornada manual; PR permanece draft para revisão L2.
