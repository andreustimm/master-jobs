---
id: JOBS-employer-filter
area: JOBS
title: Procurar pelo empregador sem trazer quem só o cita
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: O campo de empresa devolve só as vagas daquele empregador, e não as que mencionam o nome na descrição
entry_points: /jobs?company=Shopify
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-21-docs-qa-jornada-do-quadro-filtrado/numbers-agree-empty-employer.png
last_report: 2026-09-21-docs-qa-jornada-do-quadro-filtrado
overlaps: JOBS-source-multi-select
---

A busca livre varre cargo, empresa E descrição. Este filtro pergunta só pelo
empregador, e casa dentro da palavra, porque "Shopify" precisa achar
"Shopify Inc".

A conferir: uma vaga que apenas cita a empresa na descrição NÃO aparece;
`%` e `_` no nome são texto, não curinga; o nome com `&` sobrevive à URL;
limpar remove o filtro.

**Reset 2026-09-23 (#218):** o campo Empresa passou a aplicar sozinho depois de 400 ms sem digitar, com três caracteres ou mais; Enter continua aplicando na hora para nomes curtos.
