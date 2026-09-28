---
id: JOBS-availability-last-check
area: JOBS
title: Ver na vaga se ela continua disponível e quando foi conferida
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: A página da vaga mostra disponível com a data da última checagem quando a verificação respondeu; disponibilidade desconhecida quando nunca foi conferida; vencida quando a checagem tem mais de 14 dias; encerrada na origem depois de um 404/410, com o histórico da candidatura ainda visível; o estado sobrevive a recarga e cabe em 375 px
entry_points: /jobs/<id>
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-relevance-and-availability-catch-up-availability-375px.png
last_report: docs/qa/reports/2026-09-28-qa-223-catch-up.md
overlaps: JOBS-detail-owner-view-english
---

Novo em #223 (tarefa 04). A disponibilidade vem dos eventos de verificação
(`job_check_event`); vaga verificada antes dos eventos existirem aparece como
desconhecida até a próxima checagem, com a data da checagem antiga. Vaga
fechada pelo sync aparece encerrada, igual ao selo. Um 403 ou 5xx não muda o
que o último veredito conclusivo provou.

**Percorrido em 2026-09-28** (`CH-relevance-and-availability-catch-up`, persona
Andreus em triagem), parcial — confirmado por 3 dos 4 estados:

- `/jobs/8778` (nunca verificada): "availability unknown · never checked" —
  sobrevive a `reload` e cabe em 375 px.
- `/jobs/13133` e `/jobs/38` (checadas em 2026-09-19 e 2026-08-20 pelo
  mecanismo antigo, antes de `job_check_event` existir): as duas mostram
  "availability unknown · checked on <data antiga>" — exatamente o
  comportamento documentado acima (checagem antiga não prova estado atual).
- `/jobs/15027` (fechada pelo sync, sem verificação): "closed — dropped from
  the source listing · never checked".

**Bloqueado, não reprovado:** os estados "available" (`open`) e "stale"
(vencida) exigem um `job_check_event` real, e a tabela está com 0 linhas em
todo o corpus local — `pnpm jho jobs recheck queue`/`run` enfileiraram e
tentaram 3 vagas nesta sessão, mas `runVerifyQueue` recusou com
`Ingestion blocked in preview: preview runs on fixtures only` (o mesmo guard
de rede citado em `ADMN-source-catalog-operate`). Correto por design — não é
um defeito — mas significa que "vencida" e "disponível com data" só são
verificáveis num ambiente que libere sondagem de rede real (produção, ou um
preview autorizado). Também não confirmei nesta sessão que o histórico de
candidatura permanece visível numa vaga encerrada: a única vaga fechada com
candidatura no corpus (`/jobs/42`) pertence à conta real do dono
(`andreus@zorbit.com.br`), e evitei trocar a senha dela só para este teste.
Pré-requisito para fechar: (1) rodar a reconferência num ambiente com rede
liberada e reabrir a mesma vaga; (2) reabrir `/jobs/42` autenticado como o
dono (ou recriar o cenário com a conta de QA) para confirmar o funil visível
com a vaga fechada.
