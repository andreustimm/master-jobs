---
id: CLI-task-delivery-evidence
area: CLI
title: Concluir a tarefa somente depois da entrega exigida
persona: Operador somente por teclado
journey: J-coordinate-task-delivery
expected: O merge em dev mantém aberta a entrega de produção e só sua prova completa permite concluir, fechar a issue e liberar a posse
entry_points: rtk pnpm tasks show <issue> --json; rtk pnpm tasks transition <issue>; https://github.com/users/andreustimm/projects/3
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps:
---

Usar uma entrega real do [piloto #191](https://github.com/andreustimm/master-jobs/issues/191)
com contrato `production`, assignee, claim válido e PR nativamente vinculada.
Percorrer os estados permitidos com suas evidências e, após o merge verde em
`dev`, solicitar Concluído antes da promoção. A resposta precisa explicar a
prova ausente; a releitura deve mostrar a issue aberta, sem data de conclusão
nem perda da posse válida.

Depois da promoção autorizada por pessoa, conferir deployment Production e
a execução mais recente da fumaça de produção no mesmo SHA e posteriores ao
merge correto. Só então solicitar a conclusão. Registrar os links de PR,
deployment, fumaça e recibo. Reabrir issue e Project e comparar com
`tasks show`: Status Concluído, data real, issue fechada e posse liberada
precisam concordar.

Se a promoção ou a prova externa depender de pessoa, o relatório da sessão
indica exatamente a verificação pendente. A recusa correta é apenas uma parte
do cenário e não prova seu fim real. Não criar deployments artificiais,
aprovar produção automaticamente nem alterar Status pela UI para concluir.

