# BUG-20260929-jobs-row-title-missing-user-content-mark: título da linha em Vagas sem `data-user-content`

- **Status:** verified
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao ler o título de uma vaga na lista
- **Scenarios:** JOBS-english-keeps-posting-data
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Regra 9 exige `data-user-content` em todo dado do usuário/acervo, para que a
guarda de vazamento de idioma não reprove texto legítimo (nome de empresa,
localização) como tradução esquecida. O título da linha de vaga em `/jobs`
não tem essa marca — hoje não causa falso positivo porque nenhum título de
teste tem acento, mas um título futuro acentuado reprovaria a guarda sem
motivo, e a ausência da marca também é, por si, uma lacuna da regra.

## Reproduction

- **Charter:** CH-release-regression-sweep · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210)

1. Abrir `/jobs`.
2. Inspecionar o elemento do título de uma vaga na lista.

**Expected:** `data-user-content="true"` no elemento do título.
**Actual:** ausente.

## Evidence

- Inspeção do HTML servido nesta sessão (lane jobsnav, candidato C5); ver
  debrief "Lane jobsnav" no relatório desta rodada.

## Fix

- **Root cause:** o link do título da vaga em `app/joblist.tsx` não carregava
  `data-user-content`, então a guarda de vazamento de português não tinha
  como distinguir um título acentuado do acervo de uma tradução esquecida.
- **Fix commit:** d433dcf5 — `data-user-content="true"` adicionado ao link
  do título em `JobList`.
- **Regression test:** `tests/e2e/ui/i18n.mjs` (confere
  `title.getAttribute("data-user-content") === "true"` em `/jobs`).

## Verification

- **Retested:** 2026-09-29 · d433dcf5 · QA dirigido da PR #408
  (`docs/qa/reports/2026-09-29T143300Z-d433dcf-vagas-idioma-395.md`), leitura
  independente do DOM após recarga.
- **Result:** verified — os seis títulos da lista carregam
  `data-user-content="true"` e a marca sobrevive à recarga. `tests/e2e/ui/i18n.mjs`
  confere o mesmo atributo no CI, em `/jobs` com a interface em inglês.

## Reteste da issue #395

Correção d433dcf; relatório: docs/qa/reports/2026-09-29T143300Z-d433dcf-vagas-idioma-395.md.
Interface, recarga e leitura independente confirmaram a correção.
