# QA Run Report — 2026-10-01T152245Z-fixer — termo-longo-sem-corte (correção da revisão)

- **Scope:** correção dos achados da revisão L1 da PR #411 (issue #390): o campo
  de termo em `/searches` apagava o texto digitado numa recusa (reset do
  formulário não controlado), e o cenário `SRCH-term-validation` tinha sido
  marcado `pass` sem repercorrer os casos além do termo longo nem usar sessão
  nova.
- **Cadence tier:** targeted
- **Build:** `5e7a027` · **Environment:** `pnpm test:e2e` (suíte completa),
  runner isolado local, PostgreSQL descartável, autenticação real. Sem sessão
  manual nesta rodada — ver "Human Verifications Needed".

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | conta local isolada (fixture do E2E) | desktop / build de produção / pt-BR | automatizada, `tests/e2e/ui/searches.mjs` |

## Flows in Scope

- `J-save-term-search` — salvar um termo de busca e receber recusa clara quando ele excede o limite (`../journeys/J-save-term-search.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | — (automatizado, sem charter manual) | J-save-term-search / SRCH-term-validation | Andreus em triagem | — | Fixed (parcial) | BUG-20260921-long-term-cut-silently | `5e7a027` |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Suíte automatizada — Andreus em triagem

- **Ran:** 2026-10-01 (sessão de browser nova por execução do Playwright, não reaproveitada entre casos)
- **Steps:** `pnpm test:e2e` completo (todas as áreas). Em `searches`, o caso
  `term-search E2E-021` passou a afirmar: o campo mantém os 65 caracteres
  depois da recusa, o termo (inteiro ou cortado em 60) não existe após
  recarregar. `term-search E2E-017` (mesma sessão) cobre o termo curto ("a")
  e a duplicata ("Tech Lead" depois de "techlead").
- **Evidence:** saída do runner, 433/433 verificações e 14/14 páginas sem
  violação axe (log local, não versionado — ver Final Status).
- **True end state:** confirmed para os três casos acima; NÃO percorrido para
  caractere inválido e limite de 20 termos nesta rodada.
- **Scenarios settled:** `SRCH-term-validation` → permanece `untested`
  (ver Human Verifications Needed); não reafirmo `pass` sem repercorrer os
  cinco casos numa sessão com leitura independente, que é o que a revisão
  apontou como faltante.
- **Paper cuts:** nenhum observado.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-save-term-search | pass | — | — | — | pass | — | `tests/e2e/ui/searches.mjs` (E2E-017, E2E-021); não é QA de jornada completa |

## What Was Fixed

### BUG-20260921-long-term-cut-silently: termo colado acima de 60 caracteres é cortado e salvo sem aviso (achado adicional da revisão)

- **Symptom:** depois do fix de e6ff264, a recusa de termo longo passou a mostrar o aviso certo, mas apagava o texto digitado — a pessoa tinha de colar e cortar de novo às cegas.
- **Root cause:** `MutationFeedbackForm` reiniciava o formulário não controlado em qualquer desfecho da action (sucesso ou recusa); faltava distinguir os dois.
- **Fix:** `5e7a027` adiciona `clearOnSuccess` ao `MutationFeedbackForm` (`app/mutation-feedback.tsx`) e o usa junto de `keepFields` só no formulário de termo (`app/searches/page.tsx`): a recusa mantém o texto, o sucesso limpa o campo.
- **Regression test:** `tests/e2e/ui/searches.mjs` (E2E-021, campo mantém 65 caracteres após a recusa — falhava antes, passa agora); `tests/mobile.test.ts` (passa a localizar o campo por `data-testid`, não por `name="term"` ser o primeiro atributo).
- **Retested:** `pnpm test:e2e` completo, 433/433, sessão de browser nova.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum erro de runtime observado na suíte automatizada.

## Human Verifications Needed

- [ ] Sessão de QA de jornada com **login novo** (não reaproveitar aba/sessão),
  percorrendo os cinco casos de `SRCH-term-validation` (curto, longo, caractere
  inválido, duplicata, 21º termo com 20 ativos) em `/searches`, com refresh e
  leitura independente de verdade, antes de o cenário voltar a `qa_status: pass`.
  Caractere inválido e limite de 20 não têm reteste de UI nesta rodada — só
  teste unitário (`tests/term-kernel.test.ts`, `tests/cov-matching-limites.test.ts`).

## Decisions for a Human

- Nenhuma: a lacuna de QA é um reteste pendente, não uma decisão de produto.

## Learnings

- "Reload na mesma aba" não é "leitura independente": o template de QA de
  jornada já distinguia os dois, e o reteste de 2026-09-29 registrou o
  primeiro como se fosse o segundo. Marcar `pass` no cenário inteiro por causa
  de um caso só também escondeu que os outros quatro não foram andados nesta
  rodada.

## Final Status

- **Exit gate (full automated suite):** `pnpm test:e2e`: exit 0, 433/433 verificações e 14/14 páginas sem violação axe.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 1 (campo apagado na recusa, corrigido) · Cosmetic 0
- **Coverage:** 1/1 jornada tocada pela correção, por teste automatizado; QA de jornada manual com sessão nova continua pendente para o cenário fechar `pass`.
- **Verdict:** ready-with-blocked-items — a correção do campo e o reteste automatizado estão verdes; falta a sessão humana/agente com login novo para fechar `SRCH-term-validation`.
