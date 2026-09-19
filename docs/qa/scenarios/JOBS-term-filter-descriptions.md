---
id: JOBS-term-filter-descriptions
area: JOBS
title: Filtrar Vagas por um termo que só aparece na descrição
persona: Andreus em triagem
journey: J-save-term-search
expected: A busca encontra a palavra inteira no título, na empresa e na descrição, e não encontra pedaço de palavra
entry_points: /jobs?q=laravel
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-work-mode-continuity
---

"go" não traz "Google"; "c++" e "node.js" funcionam. Termo inválido na URL
mostra aviso e a lista sem filtro, em vez de erro. Com poucas vagas aparece
a oferta de salvar o termo em Buscas.
