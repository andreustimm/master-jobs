# QA Run Report — 2026-09-29T141200Z-codex3901 — termo-longo-sem-corte

- **Scope:** correção do campo de termo em `/searches`: entradas acima de 60 caracteres chegam à validação e não criam termo truncado.
- **Cadence tier:** targeted
- **Build:** `e6ff264` · **Environment:** runner isolado local, PostgreSQL descartável, autenticação real.
- **Started:** 2026-09-29T14:12:00Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | conta local isolada | phone-small 375×812 / wifi-fast / pt-BR | CH-term-input-mistreated |

## Flows in Scope

- `J-save-term-search` — salvar um termo de busca e receber recusa clara quando ele excede o limite (`../journeys/J-save-term-search.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-term-input-mistreated | J-save-term-search / SRCH-term-validation | Andreus em triagem | Garbage Tour | Fixed | BUG-20260921-long-term-cut-silently | e6ff264 |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-term-input-mistreated — Andreus em triagem

- **Ran:** 2026-09-29T14:19Z → 2026-09-29T14:24Z (box respeitado: sim)
- **Entry:** login real em `/login`, depois `/searches`, viewport 375×812 e locale PT-BR.
- **Steps:** preenchi `LongTermInput` repetido cinco vezes (65 caracteres), salvei, observei "O termo passa de 60 caracteres.", recarreguei `/searches` e confirmei que o termo não aparece.
- **Evidence:** `evidence/2026-09-29T141200Z-codex390-termo-longo-sem-corte/CH-term-input-mistreated-02-too-long.png`; `evidence/2026-09-29T141200Z-codex390-termo-longo-sem-corte/CH-term-input-mistreated-03-after-refresh.png`.
- **True end state:** confirmed.
- **Scenarios settled:** `SRCH-term-validation` → `pass`.
- **Paper cuts:** nenhum observado.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-save-term-search | pass | pass | pass | pass | pass | pass | evidências acima; ambiente isolado com PostgreSQL descartável |

## What Was Fixed

### BUG-20260921-long-term-cut-silently: termo colado acima de 60 caracteres é cortado e salvo sem aviso

- **Symptom:** termo acima de 60 caracteres era cortado pelo navegador e salvo sem aviso.
- **Root cause:** o limite HTML descartava o excedente antes de `validateTerm` receber a entrada.
- **Fix:** e6ff264 remove o limite HTML e deixa a validação do domínio receber o termo completo.
- **Regression test:** `tests/mobile.test.ts` e `tests/e2e/ui/searches.mjs`.
- **Retested:** E2E seletivo 81/81 e sessão manual em 375×812, com refresh.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de runtime observado; o build registrou somente o warning conhecido de dependência dinâmica do Sentry.

## Human Verifications Needed

- [ ] Nenhuma; o reteste usa conta e ambiente locais descartáveis.

## Decisions for a Human

- Nenhuma.

## Learnings

- O domínio já tinha a recusa nomeada; a borda do navegador precisava deixar a entrada completa atravessar o formulário.

## Final Status

- **Exit gate (full automated suite):** não executado; E2E seletivo `pnpm test:e2e --areas searches`: exit 0, 81/81 verificações passaram.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 1 · Cosmetic 0
- **Coverage:** 1/1 jornada direcionada caminhada; suíte completa não executada.
- **Verdict:** ready-with-blocked-items — a correção e a jornada direcionada estão verdes; a suíte automatizada completa permanece para o CI.
