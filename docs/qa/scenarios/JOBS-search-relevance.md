---
id: JOBS-search-relevance
area: JOBS
title: Buscar uma frase entre aspas, ordenar por relevância e ver termos parecidos à parte
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Com "tech lead" entre aspas e ordem por relevância, a lista traz primeiro quem tem a frase no cargo, cada linha diz onde casou, o total não muda com a ordem e as vagas de título parecido ficam num grupo separado abaixo
entry_points: /jobs?q=%22tech%20lead%22&workMode=remote&sort=relevance
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-term-filter-descriptions
---

Novo em #223 (tarefa 05). A conferir: trocar entre aderência e relevância não
muda o total; a URL copiada abre a mesma lista; o grupo "Termos parecidos" não
entra na paginação nem no total; tirar a busca some com o chip de relevância e
com o grupo; uma vaga que só tem o termo na localização aparece e diz
"localização"; em 375 px nada estoura para o lado. Nenhum texto fala em
semântica.
