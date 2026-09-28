---
id: JOBS-search-relevance
area: JOBS
title: Buscar uma frase entre aspas, ordenar por relevância e ver termos parecidos à parte
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Com "tech lead" entre aspas e ordem por relevância, a lista traz primeiro quem tem a frase no cargo, cada linha diz onde casou, o total não muda com a ordem e as vagas de título parecido ficam num grupo separado abaixo
entry_points: /jobs?q=%22tech%20lead%22&workMode=remote&sort=relevance
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-relevance-and-availability-catch-up-search-relevance-desktop.png; docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-relevance-and-availability-catch-up-search-relevance-375px.png
last_report: docs/qa/reports/2026-09-28-qa-223-catch-up.md
overlaps: JOBS-term-filter-descriptions
---

Novo em #223 (tarefa 05). A conferir: trocar entre aderência e relevância não
muda o total; a URL copiada abre a mesma lista; o grupo "Termos parecidos" não
entra na paginação nem no total; tirar a busca some com o chip de relevância e
com o grupo; uma vaga que só tem o termo na localização aparece e diz
"localização"; em 375 px nada estoura para o lado. Nenhum texto fala em
semântica.

**Percorrido em 2026-09-28** (`CH-relevance-and-availability-catch-up`, persona
Andreus em triagem): `/jobs?q=%22tech+lead%22&workMode=remote&sort=relevance`
trouxe 67 vagas, a primeira com a frase exata no cargo ("Site Reliability
Engineer, Tech Lead") e "matched in: title, description" em cada linha.
Alternar `sort=fit`/`sort=relevance` manteve o total em 67 nos dois. O grupo
"Similar terms" apareceu separado, com o aviso "They are not in the count
above", e sumiu ao limpar a busca (`clear` também tirou `q` da URL e voltou ao
total geral). Paginação "1–50 de 67" com página 2 e seletor de 25/50/100/200.
Sem estouro horizontal em 375 px. Não encontrei, nesta sessão, um exemplo com
"matched in: location" isolado (tentei várias cidades raras — a maioria tinha
0 resultado ou casava por título/descrição também); não bloqueia o Pass porque
não é o observável central do cenário, mas fica como lacuna de cobertura para
uma próxima sessão. Nenhum texto do produto menciona semântica/embeddings.
