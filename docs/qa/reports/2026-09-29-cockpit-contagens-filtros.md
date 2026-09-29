# QA Run Report — 2026-09-29-cockpit-contagens-filtros — #396

- **Scope:** correção das contagens do cockpit, facetas e aviso de faixa salarial quando empresa ou remuneração estão na URL
- **Cadence tier:** targeted
- **Build:** `f85003cbf99e126568154c9e4d30884ffb447833` (baseline antes do commit) · **Environment:** build standalone isolado em `127.0.0.1`, PostgreSQL e MinIO descartáveis
- **Started:** 2026-09-29T11:00:00-03:00 · **Status:** in-progress

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | dono do produto, admin+candidate | desktop / wifi-fast / pt-BR | CH-filtered-board-numbers-agree |

## Flows in Scope

- `J-trust-the-filtered-board` — estreitar o quadro e confiar nos números (`../journeys/J-trust-the-filtered-board.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-cockpit-count-matches-list | Andreus em triagem | Money Tour | Pending | BUG-20260929-jobs-chips-ignore-employer-filter; BUG-20260929-jobs-cockpit-ignores-salary-filter | |
| 2 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-employer-filter | Andreus em triagem | Money Tour | Pending | BUG-20260929-jobs-chips-ignore-employer-filter | |
| 3 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-pay-filter | Andreus em triagem | Pending | BUG-20260929-jobs-cockpit-ignores-salary-filter; BUG-20260929-jobs-grouped-pay-banner-off-by-one | |
| 4 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-score-range | Andreus em triagem | Money Tour | Skipped | Corte do targeted run; cobertura automatizada relacionada registrada abaixo | |
| 5 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-hide-already-sent | Andreus em triagem | Money Tour | Skipped | Superfície não alterada pelo diff | |
| 6 | CH-filtered-board-fields-follow-url | J-trust-the-filtered-board / JOBS-filter-fields-follow-url | Andreus em triagem | Back-Button Tour | Skipped | Canary adjacente fora do box manual; contratos automatizados continuam verdes | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-filtered-board-numbers-agree — Andreus em triagem

- **Ran:** 2026-09-29T11:14 → 2026-09-29T11:27-03:00 (box respeitado: sim)
- **Entry:** login real em `http://127.0.0.1:<porta>/login`, conta local descartável `alex@local.test`; idioma trocado pela interface para Português.
- **Steps:** a contagem padrão do cockpit mostrou 3 e `/jobs` na mesma sessão mostrou as mesmas 3 vagas; `Aurora` no campo Empresa mostrou 1 no cockpit, e a leitura independente em `/jobs?company=Aurora` mostrou 1; a recarga de `/jobs?pay=6000&payMax=9000&cur=USD&per=month` preservou os campos da faixa.
- **Evidence:** `docs/qa/evidence/2026-09-29-cockpit-contagens-filtros/CH-filtered-board-numbers-agree/cockpit-default.png`; `company-aurora-counts-agree.png`; `jobs-company-aurora.png`; `jobs-default.png`; `jobs-pay-deep-link.png`.
- **Tour:** Money Tour: conferidos os números do quadro, do chip e da leitura em `/jobs`; o fixture manual não possui remunerações divulgadas, então o banner de vagas fora da faixa foi coberto pela área E2E com fixtures de salário.
- **Goal reached:** yes
- **True end state:** confirmed para empresa, contagem geral e persistência da faixa; confirmação salarial completa pela sessão de navegador E2E abaixo.
- **Abandonment paths:** nenhum.
- **Paper cuts:** nenhum sharp; a sessão manual exigiu trocar o idioma por o navegador iniciar em English, fricção dull da fixture.
- **Bugs:** BUG-20260929-jobs-chips-ignore-employer-filter, BUG-20260929-jobs-cockpit-ignores-salary-filter, BUG-20260929-jobs-grouped-pay-banner-off-by-one.
- **Scenarios settled:** `JOBS-cockpit-count-matches-list` → Fixed; `JOBS-employer-filter` → Fixed; `JOBS-pay-filter` → Fixed.

### Cobertura E2E de remuneração — build isolado

- **Ran:** 2026-09-29T11:48 → 2026-09-29T11:57-03:00 (box respeitado: sim)
- **Command:** `node tests/e2e/run-isolated.mjs --areas searches`
- **Observed:** a fixture de remuneração passou pelos filtros mínimo, faixa 6.000–11.000 USD/mês, ordenação, agrupamento, aviso de itens fora da faixa e recarga.
- **Result:** `80/80 verificações passaram`, incluindo `term-search E2E-007`, `E2E-010`, `E2E-012` e `E2E-008`.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-trust-the-filtered-board | pass | pass (E2E 375/768/1024) | pass | pass (Chromium desktop e mobile E2E) | pass | friction (fixtures locais descartáveis; sem serviço externo) | screenshots acima; 80/80 E2E |

## What Was Fixed

### BUG-20260929-jobs-chips-ignore-employer-filter

- **Symptom:** chips do cockpit mantinham o total geral depois de filtrar empresa.
- **Root cause:** `boardFacets` não recebia empresa nem remuneração, apesar de `listBoard` receber o quadro completo.
- **Fix:** incluir empresa, faixa e taxas no contrato/cache das facetas e nas queries do cockpit/lista.
- **Regression test:** `tests/jobs-board.test.ts` — IT-396-01 falhava antes e passa depois.
- **Retested:** cockpit e `/jobs?company=Aurora` na sessão manual; filtro de empresa também coberto pela integração.

### BUG-20260929-jobs-cockpit-ignores-salary-filter

- **Symptom:** cockpit e `/jobs` respondiam números diferentes para a mesma faixa salarial.
- **Root cause:** o cockpit só projetava filtros de `filter-state` e nunca resolvia o alvo/taxas para aplicar `pay` no `countBoard`.
- **Fix:** resolver remuneração no cockpit com a mesma trilha primária/taxas da lista.
- **Regression test:** `tests/jobs-board.test.ts` — IT-396-02 falhava antes e passa depois; E2E `term-search E2E-010` passa.
- **Retested:** deep link salarial recarregado manualmente; área E2E de buscas passou 80/80.

### BUG-20260929-jobs-grouped-pay-banner-off-by-one

- **Symptom:** soma do total visível com o aviso de itens fora da faixa excedia o total.
- **Root cause:** o banner comparava contagens de publicações filtradas com total agrupado e usava o grupo canônico mínimo da consulta não filtrada.
- **Fix:** calcular o aviso como diferença entre o universo sem faixa e o universo visível, preservando o mesmo filtro de agrupamento.
- **Regression test:** `tests/jobs-board.test.ts` — IT-396-02 cobre grupo repetido, publicação qualificada e item fora da faixa; E2E `term-search E2E-007`/`E2E-010` passam.
- **Retested:** caminho de agrupamento e faixa na área E2E isolada.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus em triagem | cockpit, troca de idioma | "preciso trocar o idioma porque a sessão abre em inglês" | dull | fixture local; sem mudança no produto |

## Runtime Errors Observed

- Warnings de build do `require-in-the-middle` e ausência de `SENTRY_AUTH_TOKEN`; nenhum erro de runtime nas 80 verificações E2E.

## Human Verifications Needed

- [ ] Repetir o caminho com o acervo de produção após a promoção, usando uma faixa com salários divulgados e conferir que a soma do total visível com o aviso permanece igual ao total do universo. (Os fixtures isolados cobrem a regra sem tocar produção.)

## Decisions for a Human

Nenhuma.

## Learnings

- Facetas que aparecem em cartões do cockpit precisam compartilhar o universo completo de `BoardFilters`, inclusive dimensões que antes eram removidas de propósito.
- O fixture manual não contém remuneração; o cenário salarial precisa manter uma fixture divulgada para permitir reteste humano sem banco de produção.

## Final Status

- **Exit gate (full automated suite):** pendente até rodar `pnpm check` nesta worktree.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 2 corrigidos · Friction 0 · Cosmetic 1 corrigido
- **Coverage:** 1 jornada impactada percorrida; 3 cenários corrigidos e retestados; 3 cenários explicitamente cortados neste targeted run.
- **Verdict:** in-progress — aguarda o gate completo, commit e PR draft.
