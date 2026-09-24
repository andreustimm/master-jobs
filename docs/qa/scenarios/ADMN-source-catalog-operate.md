---
id: ADMN-source-catalog-operate
area: ADMN
title: Cadastrar, sondar, habilitar e buscar uma fonte pela tela
persona: Andreus em triagem
journey: J-operate-source-catalog
expected: A fonte cadastrada aparece desabilitada; duplicado e chave colada no lugar do nome são recusados com o motivo; sondar não grava vaga; habilitar sobrevive a recarga; Buscar agora leva ao detalhe da execução, que mostra na fila com o motivo ou concluída com contagens
entry_points: /admin/plataformas
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: ADMN-capture-health-aggregate
---

Novo em #223 (tarefa 03). Sem `GITHUB_DISPATCH_TOKEN` a execução fica na fila
com o motivo visível e roda pela CLI (`jho jobs sync --run <id>`). Fora de
produção a sondagem responde com a recusa do ambiente.
