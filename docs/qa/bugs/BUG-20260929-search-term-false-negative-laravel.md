# BUG-20260929-search-term-false-negative-laravel: busca diz "nenhuma vaga menciona" quando existem 43

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao combinar termo e modalidade
- **Scenarios:** JOBS-term-filter-descriptions
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Com `q=laravel&workMode=onsite`, a tela diz "Nenhuma vaga do acervo menciona
'laravel'" — mas 43 vagas do acervo mencionam o termo (a combinação com o
filtro de modalidade é que reduz a zero, não a ausência do termo). A
mensagem confunde "0 resultados com este filtro" com "termo não existe no
acervo", levando a pessoa a desconfiar da busca em vez de ajustar o filtro.

## Reproduction

- **Charter:** CH-release-regression-sweep · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210)

1. Buscar `q=laravel&workMode=onsite`.
2. Ler a mensagem de zero resultados.
3. Remover `workMode=onsite` e contar as vagas que mencionam "laravel".

**Expected:** mensagem distingue "0 vagas com este filtro" de "termo ausente
no acervo".
**Actual:** "Nenhuma vaga do acervo menciona 'laravel'", mas 43 vagas
mencionam o termo sem o filtro de modalidade.

## Evidence

- Contagem direta nesta sessão (lane jobsnav, charter CH-release-regression-sweep,
  candidato C2); ver debrief "Lane jobsnav" no relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**

Correção em implementação com teste vermelho/verde registrado; reteste de jornada pendente.
