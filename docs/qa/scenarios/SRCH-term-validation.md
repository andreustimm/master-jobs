---
id: SRCH-term-validation
area: SRCH
title: Receber uma mensagem clara para termo inválido ou repetido
persona: Andreus em triagem
journey: J-save-term-search
expected: Termo curto, longo, com caractere não aceito ou já salvo mostra a mensagem própria, e o repetido oferece o link para o termo existente
entry_points: /searches
qa_status: pass
bug_ids: BUG-20260921-long-term-cut-silently
fix_status: fixed
retest_status: pass
fix_commits: e6ff264
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-term-input-mistreated-baseline-duplicado-toast.png; evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-term-input-mistreated-baseline-limite-21.png; evidence/2026-09-29T141200Z-codex390-termo-longo-sem-corte/CH-term-input-mistreated-02-too-long.png; evidence/2026-09-29T141200Z-codex390-termo-longo-sem-corte/CH-term-input-mistreated-03-after-refresh.png
last_report: docs/qa/reports/2026-09-29T141200Z-codex3901-termo-longo-sem-corte.md
overlaps: SRCH-save-term-from-jobs
---

Tentar "a", um termo de 61 caracteres, "<script>" e uma grafia equivalente
de um termo já salvo ("Tech Lead" depois de "techlead"). Nenhum caso cria
termo. O link "ver o termo"
leva até ele. Com 20 termos ativos, o 21º é recusado com a mensagem do
limite.

Correção aplicada: o campo não impõe `maxlength`; o domínio recebe o termo
inteiro e responde `term_too_long`. O reteste E2E e a jornada manual em 375×812
confirmaram o aviso e a ausência do termo após recarregar.
