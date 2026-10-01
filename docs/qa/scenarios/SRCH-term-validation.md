---
id: SRCH-term-validation
area: SRCH
title: Receber uma mensagem clara para termo inválido ou repetido
persona: Andreus em triagem
journey: J-save-term-search
expected: Termo curto, longo, com caractere não aceito ou já salvo mostra a mensagem própria, e o repetido oferece o link para o termo existente
entry_points: /searches
qa_status: untested
bug_ids: BUG-20260921-long-term-cut-silently
fix_status: fixed
retest_status: pending
fix_commits: e6ff264; 5e7a027
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-term-input-mistreated-baseline-duplicado-toast.png; evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-term-input-mistreated-baseline-limite-21.png; evidence/2026-09-29T141200Z-codex390-termo-longo-sem-corte/CH-term-input-mistreated-02-too-long.png; evidence/2026-09-29T141200Z-codex390-termo-longo-sem-corte/CH-term-input-mistreated-03-after-refresh.png
last_report: docs/qa/reports/2026-10-01T152245Z-fixer-termo-longo-sem-corte.md
overlaps: SRCH-save-term-from-jobs
---

Tentar "a", um termo de 61 caracteres, "<script>" e uma grafia equivalente
de um termo já salvo ("Tech Lead" depois de "techlead"). Nenhum caso cria
termo. O link "ver o termo"
leva até ele. Com 20 termos ativos, o 21º é recusado com a mensagem do
limite.

Correção aplicada: o campo não impõe `maxlength`; o domínio recebe o termo
inteiro e responde `term_too_long`.

**Reteste devido (2026-10-01):** a revisão da PR achou que o reteste de
2026-09-29 só reabriu a mesma sessão/aba (refresh, não sessão nova) e só andou
o caso do termo longo — os quatro restantes (curto, caractere inválido,
duplicata, limite de 20) não foram repercorridos naquela sessão, embora o
cenário tivesse virado `pass` inteiro. A correção desta revisão (`5e7a027`)
resolve, além disso, um defeito que o reteste anterior não via: a recusa
apagava o termo do campo (o React reinicia formulário não controlado em
qualquer desfecho), obrigando a pessoa a colar e cortar de novo às cegas; agora
o campo mantém o texto na recusa e some só depois de um envio aceito. Essa
parte, mais os casos curto e duplicata, têm reteste automatizado fresco em
`tests/e2e/ui/searches.mjs` (sessão de navegador nova por execução, não
reaproveitada). O caractere inválido e o limite de 20 continuam cobertos só
por teste unitário (`tests/term-kernel.test.ts`,
`tests/cov-matching-limites.test.ts`) e pela leitura manual de 2026-09-21; uma
sessão de QA de jornada com login novo, percorrendo os cinco casos, fica
pendente antes de o cenário voltar a `pass`.
