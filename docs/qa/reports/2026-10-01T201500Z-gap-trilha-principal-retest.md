# QA Run Report — 2026-10-01 — lacunas com a trilha principal (reteste targeted)

- **Scope:** reteste de PROF-gap-own-vocabulary depois do achado Major 1 da revisão L2 da PR #431: `analyseGap` passa a medir termos e vagas pela trilha principal do candidato (`trackScoringProfiles`), e não pelo perfil gravado, que a fila deriva do currículo.
- **Cadence tier:** targeted
- **Build:** branch `fix/gap-perfil-candidato` em `78c047fd` (merge de `origin/dev` `9afa13b4` incluso), não mesclada · **Environment:** `node tests/e2e/run-isolated.mjs --areas candidate-gap`: build de produção local, PostgreSQL descartável, Chromium, login real pela tela.

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato convidado sem perfil | `docs/qa/personas.md` | 375 px e 1280 px / local / pt-BR | conta `e2e-lacuna@local.test`: currículo próprio, perfil derivado pela fila, principal editada para "lifecycle" e "customers" |
| Dono | `docs/qa/personas.md` | 1280 px / local / pt-BR | conta `e2e@local.test`, depois de `candidate-rescore` salvar o currículo e a fila derivar o perfil dele |

## Flows in Scope

- `J-refresh-candidate-ranking`: ler a seção de lacunas de `/candidate` (`../journeys/J-refresh-candidate-ranking.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | — (percurso automatizado pela interface) | J-refresh-candidate-ranking / PROF-gap-own-vocabulary | Candidato convidado sem perfil | — | Pass | BUG-20261001-gap-uses-owner-profile | `e53f4972`, `78c047fd` |
| 2 | — (percurso automatizado pela interface) | J-refresh-candidate-ranking / PROF-gap-own-vocabulary | Dono | — | Pass | BUG-20261001-gap-uses-owner-profile | `e53f4972`, `78c047fd` |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Convidada

- **Ran:** 2026-10-01
- **Steps:** login pela tela a 375 px, `/candidate`, leitura da seção pelos `data-testid` dos termos; recarregar; fechar o contexto e entrar de novo a 1280 px.
- **True end state:** ausentes `["lifecycle"]`, confirmados `["customers"]`, raros `[]` nas três leituras. Sem estouro horizontal a 375 px.
- **Contraprova:** a mesma área contra `e53f4972` reprovou as três leituras com ausentes `[]`, confirmados `["kubernetes","python"]` e raros `["postgresql"]`: as skills do perfil derivado do currículo dela.

### Dono

- **Ran:** 2026-10-01
- **Steps:** depois de `candidate-rescore`, conferência no banco de que o dono tem perfil gravado derivado do CV (`source: candidate`); `/candidate`, leitura e refresh.
- **True end state:** a seção mostra só termos da principal dele, nenhum termo da convidada, e a mesma lista depois do refresh.
- **Limite:** no acervo de fixtures do E2E, as vagas do dono acima de 60 não citam termo do perfil, então ele só tem termos raros (`llm`, `distributed systems`, `technical leadership`, `observability`, `typescript`, `python`), que coincidem com os do perfil derivado. A tela do dono não separa principal de perfil derivado neste acervo; quem separa é o caso (b) de `tests/cov-core-candidate-gap.test.ts`, que reprova com `e53f4972`.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-refresh-candidate-ranking | pass | — | — | pass | — | — | área E2E `candidate-gap`, login real e leitura pela tela; Chromium a 375 e 1280 px; sem produção |

## What Was Fixed

### BUG-20261001-gap-uses-owner-profile: lacunas medidas com o vocabulário errado

- **Symptom:** a conta convidada via termos do `profile.yaml` do dono; com a primeira correção, qualquer conta com currículo salvo via só as skills do próprio CV, e "faltante" ficava vazio.
- **Root cause:** `personProfile` devolve o perfil gravado, que a fila deriva do currículo para qualquer conta.
- **Fix:** termos e vagas da mesma trilha principal, pelo perfil efetivo do scorer.
- **Regression test:** `tests/cov-core-candidate-gap.test.ts` e `tests/e2e/ui/candidate-gap.mjs`.
- **Retested:** E2E 39/39.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum: o check `E2E-025` (console, hidratação) passou na mesma execução.

## Human Verifications Needed

- Nenhuma.

## Decisions for a Human

- Nenhuma.

## Learnings

- O perfil gravado não é "o que a pessoa busca": a fila o deriva do currículo. O que ela busca é o alvo da trilha principal, e é ele que o scorer usa.

## Final Status

- **Exit gate:** `pnpm typecheck` sem erros; vitest dos arquivos afetados; E2E `candidate-gap` 39/39.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 (corrigido) · Friction 0 · Cosmetic 0
- **Coverage:** 1/1 jornada tocada, duas personas.
- **Verdict:** ready.
