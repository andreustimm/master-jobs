# BUG-20260929-search-term-false-negative-laravel: busca diz "nenhuma vaga menciona" quando existem 43

- **Status:** verified
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

Correção 7f69ab7: o texto descreve ausência nos filtros atuais. Dois testes falharam antes; 16 testes relacionados, typecheck e E2E searches 86/86 passaram. Reteste manual em conta Alex, PT/EN e 375px: TypeScript retorna duas vagas, presencial zera com orientação correta após refresh, e remover modalidade recupera ambas; detalhe confirma o termo e modalidade. Pass no escopo da #402. Relatório: `docs/qa/reports/2026-09-29T144500Z-codex402-busca-filtrada.md`.
