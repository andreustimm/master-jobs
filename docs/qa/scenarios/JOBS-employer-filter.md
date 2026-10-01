---
id: JOBS-employer-filter
area: JOBS
title: Procurar pelo empregador sem trazer quem só o cita
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: O campo de empresa devolve só as vagas daquele empregador, e não as que mencionam o nome na descrição
entry_points: /jobs?company=Shopify
qa_status: pass
bug_ids: BUG-20260929-jobs-chips-ignore-employer-filter
fix_status: fixed
retest_status: pass
fix_commits: 7bdacc7f7c323dfb6d3fa2f14b657b149487b8ac
evidence: docs/qa/evidence/2026-09-21-docs-qa-jornada-do-quadro-filtrado/numbers-agree-empty-employer.png; docs/qa/evidence/2026-09-29-cockpit-contagens-filtros/CH-filtered-board-numbers-agree/company-aurora-counts-agree.png; docs/qa/evidence/2026-09-29-cockpit-contagens-filtros/CH-filtered-board-numbers-agree/jobs-company-aurora.png
last_report: docs/qa/reports/2026-09-29-cockpit-contagens-filtros.md
overlaps: JOBS-source-multi-select
---

A busca livre varre cargo, empresa E descrição. Este filtro pergunta só pelo
empregador, e casa dentro da palavra, porque "Shopify" precisa achar
"Shopify Inc".

A conferir: uma vaga que apenas cita a empresa na descrição NÃO aparece;
`%` e `_` no nome são texto, não curinga; o nome com `&` sobrevive à URL;
limpar remove o filtro.

**Reset 2026-09-23 (#218):** o campo Empresa passou a aplicar sozinho depois de 400 ms sem digitar, com três caracteres ou mais; Enter continua aplicando na hora para nomes curtos.

Reteste targeted de #396 (29/09): `Aurora` no cockpit mostrou um chip sem
bloqueio com 1, o ranking com 1 correspondência e a leitura independente em
`/jobs?company=Aurora` mostrou a mesma única vaga após recarga.
