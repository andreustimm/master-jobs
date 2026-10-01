# QA Run Report — 2026-10-01T165500Z — PR #430 — motivo de remuneração do score no idioma da tela (#426)

- **Scope:** `renderScoreMessage` passa a traduzir o período do rótulo de
  remuneração (`comp.*`) na borda de exibição; o scorer não mudou. Tela
  tocada: `/jobs/<id>`, bloco `score-reasons`.
- **Cadence tier:** targeted
- **Build:** merge de `origin/dev` (1.32.10) sobre `e7000607` · **Environment:**
  `node tests/e2e/run-isolated.mjs --areas i18n`, build de produção
  (standalone), PostgreSQL descartável, autenticação real.

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | conta local isolada (fixture do E2E) | Chromium desktop / local / pt-BR e en | automatizada, `tests/e2e/ui/i18n.mjs` |

## Flows in Scope

- `J-trust-the-filtered-board`: ler a explicação do score de uma vaga em
  `/jobs/<id>` nos dois idiomas (`../journeys/J-trust-the-filtered-board.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | — (automatizado, sem charter manual) | J-trust-the-filtered-board / JOBS-english-keeps-posting-data | Andreus em triagem | — | Pass no recorte automatizado | BUG-20261001-score-pay-reason-period-english-in-pt | `e7000607` |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Área i18n — Andreus em triagem

- **Ran:** 2026-10-01, sessão de browser nova criada pelo Playwright no runner.
- **Steps:** a fixture grava na vaga 904000004 um motivo `comp.below` com o
  rótulo como o scorer o grava (`$4,000/month`). O caso define o cookie
  `jho_locale=pt-BR`, navega a `/jobs/904000004` e lê o texto do bloco
  `score-reasons`; repete com `jho_locale=en`. Cada leitura é uma navegação
  nova (recarga completa, não troca em memória).
- **Evidence:** saída do runner: pt-BR contém `$4,000/mês` e nenhum `/month`;
  en contém `$4,000/month` e nenhum `/mês`. A área toda: 17/17 verificações,
  incluindo `interface em inglês não vaza português` e
  `lista de vagas em pt-BR localiza o período do salário`.
- **True end state:** confirmed, por leitura do DOM servido em cada idioma.
- **Scenarios settled:** `JOBS-english-keeps-posting-data` volta a `pass` no
  recorte do motivo de remuneração. A frase "nada da interface em português" no
  detalhe da vaga tem agora também o `total (N meses)` coberto, pela unidade.
- **Paper cuts:** nenhum observado.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-trust-the-filtered-board | pass | — | — | — | — | pass | `tests/e2e/ui/i18n.mjs`; não é QA de jornada completa |

## What Was Fixed

### BUG-20261001-score-pay-reason-period-english-in-pt: período do motivo de remuneração em inglês com a interface em pt-BR

- **Symptom:** `/jobs/<id>` em pt-BR mostrava `$4,000/month`; em inglês, `total (2 meses)`.
- **Root cause:** `renderScoreMessage` interpolava `params.label` sem traduzir o sufixo que o scorer grava.
- **Fix:** `e7000607` troca o sufixo pelas chaves `jobs.moneyPeriod*` e `jobs.moneyProject*` na exibição; scorer e saída gravada intactos.
- **Regression test:** `tests/score-message-money.test.ts` e `tests/e2e/ui/i18n.mjs`.
- **Retested:** área `i18n` do E2E isolado, 17/17.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de runtime observado; `E2E-025` (hydration, key, fetch, console) passou nos dois idiomas.

## Human Verifications Needed

- [ ] Percorrer `/jobs/<id>` de uma vaga real com salário baixo, com a interface
  em pt-BR e depois em inglês, numa sessão manual de browser com login novo.
  Esta rodada leu o DOM pela automação; não houve sessão manual nem leitor de
  tela, e o caso `total (N meses)` ficou só na cobertura unitária.

## Decisions for a Human

- Nenhuma.

## Learnings

- A fixture de E2E precisa gravar o motivo como o scorer grava (rótulo pronto,
  sem idioma); um motivo já no formato do dicionário não exercitaria a troca.

## Final Status

- **Exit gate:** `node tests/e2e/run-isolated.mjs --areas i18n`: exit 0, 17/17 verificações.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 (corrigido) · Friction 0 · Cosmetic 0
- **Coverage:** 1/1 jornada tocada, por automação; sessão manual pendente (acima).
- **Verdict:** ready-with-blocked-items — correção e reteste automatizado verdes; falta apenas a verificação humana de browser.
