---
id: JOBS-availability-last-check
area: JOBS
title: Ver na vaga se ela continua disponível e quando foi conferida
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: A página da vaga mostra disponível com a data da última checagem quando a verificação respondeu; disponibilidade desconhecida quando nunca foi conferida; vencida quando a checagem tem mais de 14 dias; encerrada na origem depois de um 404/410, com o histórico da candidatura ainda visível; o estado sobrevive a recarga e cabe em 375 px
entry_points: /jobs/<id>
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-relevance-and-availability-catch-up-job15-antes.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-relevance-and-availability-catch-up-job15-disponivel.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-relevance-and-availability-catch-up-disponivel-375px.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-relevance-and-availability-catch-up-vencida.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-relevance-and-availability-catch-up-vencida-375px.png
last_report: docs/qa/reports/2026-10-01-qa-223-verificacoes.md
overlaps: JOBS-detail-owner-view-english
---

Novo em #223 (tarefa 04). A disponibilidade vem dos eventos de verificação
(`job_check_event`); vaga verificada antes dos eventos existirem aparece como
desconhecida até a próxima checagem, com a data da checagem antiga. Vaga
fechada pelo sync aparece encerrada, igual ao selo. Um 403 ou 5xx não muda o
que o último veredito conclusivo provou.

**2026-09-28** (`CH-relevance-and-availability-catch-up`): confirmados
"desconhecida · nunca conferido" (`/jobs/8778`), "desconhecida · conferido em
<data antiga>" para checagem anterior aos eventos (`/jobs/13133`, `/jobs/38`)
e "encerrada — saiu da listagem da fonte" para fechamento pelo sync
(`/jobs/15027`). `open` e `stale` ficaram bloqueados: sem rede de ingestão.

**2026-10-01** (mesma charter, perna de disponibilidade; relatório em
`last_report`), em Postgres descartável com a fonte real `lever:epoch-ai`
(9 vagas) e `JHO_ENV=local JHO_INGESTION_OPT_IN=true` só na CLI:

- Antes da checagem, `/jobs/15`: "disponibilidade desconhecida · nunca
  conferido".
- "Atualizar status" da plataforma na tela, depois `jho jobs verify --run <id>
  --limit 3` (3 vagas, 3 vivas). `/jobs/15`, `/jobs/19`, `/jobs/22`: "disponível ·
  conferido em 2026-10-01" (`data-availability="open"`); sobrevive a `reload`;
  as outras seis seguem "desconhecida · nunca conferido".
- Evento de `/jobs/15` envelhecido 15 dias por SQL no banco descartável (a
  única forma de ver "vencida" sem esperar 14 dias; o resto do caminho é o do
  produto): "disponibilidade vencida · conferido em 2026-09-16"
  (`data-availability="stale"`), sobrevive a `reload`, enquanto `/jobs/19`
  continua "disponível".
- Os dois estados cabem em 375 px (sem rolagem horizontal).

**Fora desta rodada, continua com o dono:** reabrir `/jobs/42` autenticado
como `andreus@zorbit.com.br` para confirmar o histórico de candidatura visível
numa vaga encerrada por 404/410. Nenhuma vaga fechada por 404/410 foi
produzida aqui (não há 404 legítimo numa fonte real de baixo volume); o caminho
roda em E2E-004 com vereditos pelo mesmo `applyVerdict`. O achado de texto da
execução de verificação está em `BUG-20261001-verify-run-shows-capture-completeness-copy`,
ligado ao cenário `ADMN-source-runs-partial-retry`.
