# QA Run Report — 2026-10-01T185201Z-fixer — busca-vazia-com-filtros (EXISTS sem filtros)

- **Scope:** correção do achado Major da re-revisão L1 da PR #419 (issue
  #402): `hasFilterBeyondTerm` só via filtro ESCOLHIDO na URL, então um termo
  real cujo único acerto estava abaixo do corte padrão de fit (45) ou só numa
  vaga com candidatura arquivada (status padrão) ainda recebia a frase de
  ausência, falsa.
- **Cadence tier:** targeted
- **Build:** `882e4877` · **Environment:** `pnpm vitest run` (testes
  afetados) e `node tests/e2e/run-isolated.mjs --areas searches` (suíte
  completa), runner isolado local, PostgreSQL descartável, autenticação
  real. Sem sessão manual nesta rodada.

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | conta local isolada (fixture do E2E) | desktop / build de produção / pt-BR e en | automatizada, `tests/e2e/ui/searches.mjs` |

## Flows in Scope

- `J-save-term-search` — buscar um termo em Vagas e entender por que zero vagas aparecem (`../journeys/J-save-term-search.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | — (automatizado, sem charter manual) | J-save-term-search / JOBS-term-filter-descriptions | Andreus em triagem | — | Fixed (parcial) | BUG-20260929-search-term-false-negative-laravel | `882e4877` |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Suíte automatizada — Andreus em triagem

- **Ran:** 2026-10-01 (sessão de browser nova por execução do Playwright)
- **Steps:** `termExistsInOpenCorpus` (`src/core/db/repo.ts`) roda o mesmo
  casamento de termo de `listBoardPage`, sem fit, status, trilha, fonte,
  modalidade nem faixa salarial; `loadJobsView` (`app/jobs/jobs-data.ts`) só
  a chama quando a lista já veio vazia e nenhum filtro explícito já justifica
  o zero. `pnpm vitest run tests/filter-state.test.ts tests/jobs-empty-term.test.ts
  tests/jobs-board.test.ts tests/mobile.test.ts tests/target-tracks.test.ts
  tests/target-tracks-domain.test.ts` (142 verificações) e
  `node tests/e2e/run-isolated.mjs --areas searches` completo: termo abaixo
  do corte padrão (fixture nova `905000041`/"zyxquantumcut") mostra a frase
  de recorte, não a de ausência; os dois casos já cobertos (`laravel
  &workMode=onsite`, `zzqxunmatched`) continuam corretos — nos dois locales.
- **Evidence:** saída do runner, 96/96 verificações (log local, não
  versionado).
- **True end state:** confirmed para o corte implícito de fit, via
  automação de banco (`tests/jobs-board.test.ts`) e de navegador (E2E-022).
  NÃO percorrido nesta rodada: o status padrão (candidatura arquivada) em
  E2E — a cobertura desse caso é só de banco
  (`tests/jobs-board.test.ts`); e o restante do cenário
  `JOBS-term-filter-descriptions` (correspondência de palavra inteira,
  `c++`, `node.js`, termo acentuado, frase exata, localização), que este fix
  não toca.
- **Scenarios settled:** `JOBS-term-filter-descriptions` → permanece
  `untested` no estado global; a sub-reivindicação da #402 (corte implícito
  vs. ausência de verdade) tem evidência automatizada nova.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-save-term-search | pass | — | — | — | pass | — | `tests/e2e/ui/searches.mjs`; não é QA de jornada completa |

## What Was Fixed

### BUG-20260929-search-term-false-negative-laravel: corte implícito (fit/status padrão) ainda afirmava ausência (achado da re-revisão)

- **Symptom:** depois do fix de `04e3560`, `/jobs?q=laravel` com toda vaga do
  termo pontuada abaixo de 45 (ou só em vaga arquivada) continuava mostrando
  "nenhuma vaga do acervo tem laravel", porque `hasFilterBeyondTerm` só vê
  filtro escolhido pela pessoa, não o corte padrão.
- **Root cause:** a decisão olhava só a URL, nunca o universo real do acervo.
- **Fix:** `882e4877` adiciona `termExistsInOpenCorpus`, chamada só quando a
  lista vem vazia.
- **Regression test:** `tests/jobs-board.test.ts` (3 cenários de banco + 1 de
  unidade), `tests/e2e/ui/searches.mjs` (E2E-022).
- **Retested:** `node tests/e2e/run-isolated.mjs --areas searches`, 96/96,
  sessão nova.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de runtime observado na suíte automatizada.

## Human Verifications Needed

- [ ] Sessão de QA de jornada percorrendo `JOBS-term-filter-descriptions` por
  inteiro (palavra inteira, `c++`, `node.js`, acento, frase exata,
  localização) — fora do escopo desta correção, mesma lacuna das duas
  rodadas anteriores.
- [ ] Caso do status padrão (termo só em vaga com candidatura arquivada) só
  tem cobertura de banco nesta rodada; sem sessão de browser dedicada.

## Decisions for a Human

- Fechar #402 sem os dois passos acima é uma decisão do dono: o corte
  implícito de fit está corrigido e tem evidência automatizada de banco e de
  navegador; o cenário mais amplo que a abriga, e o caso de status padrão em
  browser, não foram repercorridos.

## Learnings

- `hasFilterBeyondTerm` nomeado por "o que a pessoa escolheu" escondia que o
  próprio PADRÃO do produto (fit 45, status que esconde arquivada) também é
  recorte — só não é ESCOLHA. A pergunta certa para "a tela está mentindo?"
  não é "há filtro na URL?", é "existe a vaga, com ou sem recorte?".

## Final Status

- **Exit gate (full automated suite):** `node tests/e2e/run-isolated.mjs --areas searches`: exit 0, 96/96 verificações.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 (mensagem ainda mentia no corte implícito, corrigido) · Friction 0 · Cosmetic 0
- **Coverage:** o corte implícito de fit foi repercorrido por automação (banco e navegador); o caso de status padrão só por banco; o cenário completo, não.
- **Verdict:** ready-with-blocked-items — a distinção pelo corte implícito está corrigida e verde; falta a sessão humana/agente para o cenário completo e para o caso de status padrão em browser, por isso o commit usa `Refs #402`, não `Closes`.
