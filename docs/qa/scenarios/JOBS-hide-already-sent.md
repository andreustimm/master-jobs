---
id: JOBS-hide-already-sent
area: JOBS
title: Esconder as vagas que já enviei
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Ligar "ainda não enviadas" tira da lista as vagas com envio registrado, inclusive as recusadas e as desistidas
entry_points: /jobs?notApplied=1
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-09-21-docs-qa-jornada-do-quadro-filtrado.md
last_report: docs/qa/reports/2026-09-21-docs-qa-jornada-do-quadro-filtrado.md
overlaps: PIPE-save-resume-decision
---

O critério é a data de envio registrada, não o nome do status: o carimbo é
posto uma vez, na entrada em "candidatura enviada", e sobrevive a recusa,
desistência e arquivamento.

A conferir: uma vaga em "a fazer" ou "preparando" CONTINUA na lista, porque
ainda não foi enviada; uma vaga rejeitada depois de enviada some; o contador ao
lado do rótulo bate com o que a lista mostra; recarregar mantém.
