# QA Run Report — 2026-10-01T162051Z-fixer — busca-vazia-com-filtros (correção da revisão)

- **Scope:** correção do achado Major da revisão L1 da PR #419 (issue #402): a
  mensagem de zero resultados ainda não distinguia "0 vagas com este filtro"
  de "termo ausente no acervo" — o fix anterior (7f69ab7) trocou uma frase
  única por outra frase única, sem a distinção que a issue pede.
- **Cadence tier:** targeted
- **Build:** `04e3560` · **Environment:** `pnpm vitest run` (testes
  afetados) e `pnpm test:e2e --areas searches` (suíte completa), runner
  isolado local, PostgreSQL descartável, autenticação real. Sem sessão
  manual nesta rodada.

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | conta local isolada (fixture do E2E) | desktop / build de produção / pt-BR e en | automatizada, `tests/e2e/ui/searches.mjs` |

## Flows in Scope

- `J-save-term-search` — buscar um termo em Vagas e entender por que zero vagas aparecem (`../journeys/J-save-term-search.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | — (automatizado, sem charter manual) | J-save-term-search / JOBS-term-filter-descriptions | Andreus em triagem | — | Fixed (parcial) | BUG-20260929-search-term-false-negative-laravel | `04e3560` |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Suíte automatizada — Andreus em triagem

- **Ran:** 2026-10-01 (sessão de browser nova por execução do Playwright)
- **Steps:** implementada `hasFilterBeyondTerm` (`app/filter-state.ts`), que
  decide a mensagem pelos mesmos campos que entram na consulta do quadro.
  `pnpm vitest run tests/filter-state.test.ts tests/jobs-empty-term.test.ts`
  (41 + 4 verificações) e `node tests/e2e/run-isolated.mjs --areas searches`
  completo: `laravel&workMode=onsite` (termo existe, filtro zera) mostra a
  frase de recorte; `zzqxunmatched` (sem filtro nenhum) mostra a frase de
  ausência — nos dois locales.
- **Evidence:** saída do runner, 86/86 verificações (log local, não
  versionado).
- **True end state:** confirmed para a distinção das duas mensagens, via
  automação. NÃO percorrido: o restante do cenário `JOBS-term-filter-descriptions`
  (correspondência de palavra inteira, `c++`, `node.js`, termo acentuado,
  frase exata, localização) — comportamento de busca que este fix não toca,
  e que a sessão de 29/09 também não tinha repercorrido por inteiro.
- **Scenarios settled:** `JOBS-term-filter-descriptions` → permanece
  `untested` no estado global; a sub-reivindicação da #402 (distinção das
  duas mensagens) tem evidência automatizada nova, registrada no corpo do
  cenário.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-save-term-search | pass | — | — | — | pass | — | `tests/e2e/ui/searches.mjs`; não é QA de jornada completa |

## What Was Fixed

### BUG-20260929-search-term-false-negative-laravel: busca diz "nenhuma vaga menciona" quando existem 43 (achado adicional da revisão)

- **Symptom:** depois do fix de 7f69ab7, a mensagem deixou de afirmar
  ausência falsa, mas virou uma frase única ("remova filtros") mesmo sem
  filtro nenhum escolhido — a distinção que a #402 pede continuava ausente.
- **Root cause:** a escolha da mensagem olhava só `state.query`, nunca se
  havia recorte além do termo.
- **Fix:** `04e3560` adiciona `hasFilterBeyondTerm` e as chaves
  `jobs.emptyTermFiltered`/`jobs.emptyTermAbsent`.
- **Regression test:** `tests/filter-state.test.ts`, `tests/jobs-empty-term.test.ts`,
  `tests/e2e/ui/searches.mjs` (E2E-020 e o par PT/EN do recorte).
- **Retested:** `pnpm test:e2e --areas searches`, 86/86, sessão nova.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de runtime observado na suíte automatizada.

## Human Verifications Needed

- [ ] Sessão de QA de jornada percorrendo `JOBS-term-filter-descriptions` por
  inteiro (palavra inteira, `c++`, `node.js`, acento, frase exata,
  localização) — fora do escopo desta correção, mas é o que falta para o
  cenário sair de `untested`.

## Decisions for a Human

- Fechar #402 sem o passo acima é uma decisão do dono: a distinção específica
  que a issue pede está corrigida e tem evidência automatizada; o cenário
  mais amplo que a abriga não foi repercorrido por inteiro, nesta nem na
  rodada anterior.

## Learnings

- "Trocar uma frase única por outra frase única" não é "distinguir dois
  casos" — o teste antigo (`tests/jobs-empty-term.test.ts`) só provava que a
  chave do dicionário era usada, não que a escolha entre chaves existia.

## Final Status

- **Exit gate (full automated suite):** `pnpm test:e2e --areas searches`: exit 0, 86/86 verificações.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 (mensagem ainda não distinguia, corrigido) · Friction 0 · Cosmetic 0
- **Coverage:** a sub-reivindicação da #402 foi repercorrida por automação; o cenário completo não.
- **Verdict:** ready-with-blocked-items — a distinção das mensagens está corrigida e verde; falta a sessão humana/agente para o cenário completo, por isso o commit usa `Refs #402`, não `Closes`.
