# QA Run Report — 2026-09-29T141502414000Z-af40deb5 — comparacao-cadastro-consistente

- **Scope:** PR draft da #401: cadastro manual em `/compare` sem falso erro após persistência, com idempotência e estado sem score
- **Issue:** [#401](https://github.com/andreustimm/master-jobs/issues/401)
- **PR:** pendente de abertura após validação automatizada
- **Cadence tier:** targeted
- **Build:** `791663959001a8a0d1bb8428be3845651719b1a4` · **Environment:** local de produção-paridade, ainda não iniciado
- **Started:** 2026-09-29T14:15:02Z · **Status:** in-progress

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
| 1 | CH-first-party-navigation-inventory | J-trust-the-filtered-board / COMPARE-manual-cadastro-idempotente | Andreus em triagem | Feature Tour | Pending | BUG-20260929-compare-false-failure-duplicates-job | |
| 2 | CH-first-party-navigation-inventory | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus em triagem | Feature Tour | Pending | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

<!-- Atualizado depois de cada sessão; o charter fica inalterado. -->

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-trust-the-filtered-board | pending | pending | pending | pending | pending | pending | |
| J-switch-workspace-screen | pending | pending | pending | pending | pending | pending | |

## What Was Fixed

### BUG-20260929-compare-false-failure-duplicates-job: cadastro manual sem falso erro

- **Symptom:** a mensagem dizia falha depois que a vaga já havia entrado no acervo.
- **Root cause:** `scoreOne` retornava `null` para candidato sem perfil próprio e o caso de uso transformava isso em `unexpected` depois da persistência.
- **Fix:** pendente de SHA do commit desta branch.
- **Regression test:** `tests/cov-matching-manual-comparison.test.ts` — falhou antes e passou depois.
- **Retested:** jornada original e canário adjacente ainda pendentes.

## Paper Cuts

| Persona | Onde (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhuma sessão de navegador executada ainda.

## Human Verifications Needed

- [ ] Nenhuma até a sessão; se o ambiente local não tiver conta de QA ou browser disponível, registrar a instrução exata aqui e marcar a linha correspondente como `Blocked (needs human verify)`.

## Decisions for a Human

Nenhuma: a correção é pequena, tem causa confirmada e não envolve decisão de produto.

## Learnings

- A ausência de score é estado derivado do candidato e não pode descrever como falho um cadastro já persistido.

## Final Status

<!-- Escrito somente após as sessões, validação automatizada e gate final. -->

- **Exit gate (full automated suite):** pendente
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 1 · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 0/2 jornadas percorridas; targeted ainda em execução
- **Verdict:** pendente — finalizar E2E e jornada manual antes da PR draft.
