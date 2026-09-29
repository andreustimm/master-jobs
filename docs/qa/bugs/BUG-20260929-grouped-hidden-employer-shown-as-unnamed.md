# BUG-20260929-grouped-hidden-employer-shown-as-unnamed: quadro de empresa oculta o próprio nome é tratado como não nomeado ao agrupar

- **Status:** open
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao agrupar vagas repetidas
- **Scenarios:** JOBS-anonymous-employer-never-groups
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Com "agrupar repetidas" ligado, vagas de empregadores que optam por ocultar
o próprio nome no anúncio — "Anthropic · employer hidden", "Vercel ·
employer hidden" — aparecem como se o nome fosse desconhecido ("employer
hidden" tratado como rótulo de "sem nome"), em vez de reconhecer que o nome
é conhecido e a ocultação é intencional do anunciante. Cosmético, mas
confunde quem lê rapidamente a lista agrupada.

## Reproduction

- **Charter:** CH-grouped-job-reaches-the-right-country · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210)

1. Em `/jobs`, ligar "agrupar repetidas".
2. Localizar uma vaga de empregador que oculta o próprio nome no anúncio
   (ex.: Anthropic, Vercel neste acervo).

**Expected:** o agrupamento reconhece o empregador real por trás da vaga
ocultada.
**Actual:** "Anthropic · employer hidden" / "Vercel · employer hidden"
tratados como não nomeados.

## Evidence

- Observado nesta sessão (lane jobsnav, candidato C10); ver debrief "Lane
  jobsnav" no relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
