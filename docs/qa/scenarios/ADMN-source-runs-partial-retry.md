---
id: ADMN-source-runs-partial-retry
area: ADMN
title: Buscar em todas com uma fonte falhando e tentar de novo só a falha
persona: Andreus em triagem
journey: J-operate-source-catalog
expected: A execução de todas fica parcial com uma linha por fonte, a que falhou mostra desconhecido nas contagens em vez de zero; Tentar de novo cria outra execução ligada à original, que não muda; a lista de execuções é paginada e cabe em 375 px
entry_points: /admin/execucoes
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: ADMN-source-catalog-operate
---

Novo em #223 (tarefa 03). A captura por termo não aparece como execução: a
tela aponta para o agregado em /admin/captures.
