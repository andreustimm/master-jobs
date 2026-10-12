---
id: PIPE-read-application-history
area: PIPE
title: Reler a nota escrita ao mover a candidatura
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: O detalhe da vaga mostra cada mudança de estágio com data e a nota escrita naquele momento, e só do próprio candidato
entry_points: /jobs/<id>
qa_status: untested
bug_ids: BUG-20260917-transition-note-never-readable; BUG-20261007-job-history-day-in-utc
fix_status: fixed
retest_status: pending
fix_commits: cb00cbb; 039a373
evidence: docs/qa/reports/2026-09-18T202222983242Z-8870c32d-release-candidate-1.13.1-full.md
last_report: docs/qa/reports/2026-09-18T202222983242Z-8870c32d-release-candidate-1.13.1-full.md
overlaps: PIPE-save-resume-decision; PIPE-note-on-unchanged-stage
---

Fecha a metade que faltava de `PIPE-save-resume-decision`: a nota era aceita,
gravada em `application_event.detail` e lida por ninguém — nem na tela, nem em
`jobs show`, que lê `application.notes`, outro campo.

A leitura é escopada pelo candidato da sessão, e é isso que a sessão precisa
provar junto com o conteúdo: uma segunda conta abrindo a mesma vaga não vê nem
a nota nem as transições da primeira. Texto que a pessoa escreveu sobre a
própria candidatura tem a mesma natureza do funil.

**Reset 2026-09-25 (#316):** o histórico passou a marcar o evento desfeito
("desfeito", riscado) e a mostrar o desfazer como linha própria ("desfazer: de
X para Y"); a linha mais recente que pode ser desfeita tem o botão Desfazer. A
nota continua na linha em que foi escrita.

**Achado 07/10 (QA da #494):** a data de cada linha do histórico sai em UTC,
enquanto o "aplicado em" do Funil já segue o fuso de quem lê; à noite em São
Paulo, as duas telas discordam do dia da mesma candidatura
(BUG-20261007-job-history-day-in-utc). O reteste da nota não foi feito nesta
sessão. Relatório: `docs/qa/reports/2026-10-07-qa-494-funil-atritos.md`.

**Reset 2026-10-11 (#500):** a data de cada linha do histórico, o "visto em"
do cabeçalho e o "conferido em" da disponibilidade de `/jobs/<id>` saem pela
ilha `LocalDate`, no fuso de quem lê, e
passam a ter o dia por extenso do idioma da tela ("7 de out. de 2026"; em
inglês, "Oct 7, 2026") em vez de `2026-10-07`. Conferir, além da nota: com o
navegador em `America/Sao_Paulo`, a candidatura registrada às 23:45 mostra o
mesmo dia no Funil ("aplicado em") e no histórico, e o "visto em" também segue o
fuso; um fuso de outro dia (`TZ=Pacific/Kiritimati`) desloca as duas telas
juntas; o dia sobrevive a refresh. Prova automática (não substitui a jornada):
áreas `pipeline-filters` (E2E-500) e `job-availability` (E2E-004 e E2E-500) do
E2E e `tests/job-detail-local-date.test.ts`.
