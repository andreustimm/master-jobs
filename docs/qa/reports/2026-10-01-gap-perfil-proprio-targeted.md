# QA Run Report — 2026-10-01 — lacunas com o perfil do próprio candidato (targeted)

- **Scope:** `analyseGap` usava o `profile.yaml` do dono para qualquer candidato (#427); agora usa o perfil de matching da própria pessoa.
- **Cadence tier:** targeted
- **Build:** branch `fix/gap-perfil-candidato` sobre `463c1a1`, ainda não mesclada · **Environment:** vitest com PostgreSQL descartável e E2E isolado (build de produção local, Chromium), sem sessão manual com `agent-browser`.

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato convidado sem perfil | `docs/qa/personas.md` | desktop e 375 px / local / pt-BR e en | automatizada, `tests/e2e/ui/candidate-rescore.mjs` |

## Flows in Scope

- `J-refresh-candidate-ranking` — ler a seção de lacunas de `/candidate` (`../journeys/J-refresh-candidate-ranking.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | — (automatizado, sem charter manual) | J-refresh-candidate-ranking / PROF-gap-own-vocabulary | Candidato convidado sem perfil | — | Fixed (parcial) | BUG-20261001-gap-uses-owner-profile | pendente (PR ainda não mesclada) |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Suíte automatizada — Candidato convidado sem perfil

- **Ran:** 2026-10-01
- **Steps:** teste de banco com duas contas (B com perfil próprio recebe só o termo dele e o dono continua com os seus), caso de B sem perfil (relatório vazio, currículo preservado) e caso do dono sem perfil gravado; E2E `candidate-rescore`, onde a conta de CV fraco, sem perfil e não dona, continua vendo "nenhuma vaga para comparar" em pt-BR e en a 375 px.
- **True end state:** confirmado nos dois testes de banco e no E2E. NÃO percorrido: duas contas reais no navegador com refresh e leitura independente.
- **Scenarios settled:** PROF-gap-own-vocabulary permanece `untested`; não declaro `pass` sem o percurso manual.
- **Paper cuts:** nenhum observado.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-refresh-candidate-ranking | pass | — | — | — | — | — | `tests/cov-core-candidate-gap.test.ts`, `tests/e2e/ui/candidate-rescore.mjs`; não é QA de jornada completa |

## What Was Fixed

### BUG-20261001-gap-uses-owner-profile: lacunas medidas com o vocabulário do dono

- **Symptom:** a conta convidada via termos do `profile.yaml` do dono na seção de lacunas.
- **Root cause:** `analyseGap` lia `loadProfile(true)` para qualquer candidato.
- **Fix:** `personProfile(candidateId)`; quem não tem perfil próprio e não é o dono recebe relatório sem vagas e sem termos.
- **Regression test:** `tests/cov-core-candidate-gap.test.ts` (2 casos reprovam sem a correção, confirmado trocando a linha temporariamente).
- **Retested:** vitest 22/22 no arquivo; E2E `candidate-rescore` 33/33; `onboarding` e `cv-versions` 99/99 com a fumaça.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de runtime observado na suíte automatizada.

## Human Verifications Needed

- [ ] Entrar com a conta do dono e com uma conta convidada com perfil derivado do currículo, abrir `/candidate` em cada uma e conferir, após refresh e em sessão nova, que os termos da seção de lacunas da convidada saem do currículo dela.

## Decisions for a Human

- Nenhuma.

## Learnings

- Uma função que devolve `null` para "sem currículo" não deve servir também para "sem perfil": a tela mostraria "salve um currículo" a quem já o tem; por isso o caso sem perfil devolve relatório vazio.

## Final Status

- **Exit gate:** `pnpm typecheck` sem erros; vitest `tests/cov-core-candidate-gap.test.ts`, `tests/track-readers.test.ts`, `tests/candidate-vocabulary-gap.test.ts` passam; E2E `candidate-rescore` 33/33 e `onboarding`+`cv-versions` 99/99.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 (corrigido) · Friction 0 · Cosmetic 0
- **Coverage:** 1/1 jornada tocada, por teste automatizado; percurso manual com duas contas pendente.
- **Verdict:** ready-with-blocked-items — correção e testes verdes; falta a leitura humana com duas contas para o cenário fechar `pass`.
