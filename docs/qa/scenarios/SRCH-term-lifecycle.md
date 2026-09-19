---
id: SRCH-term-lifecycle
area: SRCH
title: Pausar, retomar, mover e excluir um termo salvo
persona: Andreus em triagem
journey: J-save-term-search
expected: Cada ação muda o termo na tela e sobrevive à recarga; excluir não remove nenhuma vaga do acervo
entry_points: /searches
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: SRCH-new-jobs-count
---

Pausar tira o termo da repetição diária; retomar devolve. Termo pausado não
roda nem pela mão. Mover para outra trilha leva o termo e o filtro das vagas
que ele trouxe; mover para trilha arquivada é recusado. Depois de excluir, as
vagas que o termo trouxe continuam em Vagas e o filtro por ele deixa de ser
oferecido.
