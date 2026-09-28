---
id: ADMN-source-runs-partial-retry
area: ADMN
title: Buscar em todas com uma fonte falhando e tentar de novo só a falha
persona: Andreus em triagem
journey: J-operate-source-catalog
expected: A execução de todas fica parcial com uma linha por fonte, a que falhou mostra desconhecido nas contagens em vez de zero; Tentar de novo cria outra execução ligada à original, que não muda; a lista de execuções é paginada e cabe em 375 px
entry_points: /admin/execucoes
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-admin-source-catalog-first-walk-execucoes-375px.png
last_report: docs/qa/reports/2026-09-28-qa-223-catch-up.md
overlaps: ADMN-source-catalog-operate
---

Novo em #223 (tarefa 03). A captura por termo não aparece como execução: a
tela aponta para o agregado em /admin/captures.

**Percorrido em 2026-09-28** (`CH-admin-source-catalog-first-walk`, persona
Andreus em triagem), parcial, numa execução de UMA fonte (não "todas"): rodei
`greenhouse:qa-catalog-223` (handle inexistente) com
`JHO_ENV=local JHO_INGESTION_OPT_IN=true` e ela terminou "failed" com as
contagens em "unknown" — nunca zero, confirmando a regra G10 mesmo fora do
caso "parcial" propriamente dito. "Try again" criou a execução #3 com
"New attempt of run #1", e a execução #1 permaneceu "failed" sem mudar depois
do clique. `/admin/execucoes` mostrou "Page 1 of 1" (mecanismo de paginação
presente, não exercitado com várias páginas) e coube em 375 px sem estouro.

**Bloqueado, não reprovado:** não produzi uma execução "de todas as fontes"
genuinamente parcial (uma linha por fonte, com uma falhando entre várias que
sucedem). Clicar em "Fetch from all" com rede real ligada dispararia sync
contra ~15 fontes reais já cadastradas neste banco local COMPARTILHADO
(arbeitnow, ashby×5, braintrust, careers:anthropic, greenhouse:stackblitz,
himalayas, lever:jobgether com 4056 vagas, remoteok, remotive×2) — efeito
colateral grande demais para uma sessão de QA (milhares de upserts, fechamento
de vagas de outras sessões) e por isso não executei. Pré-requisito para
fechar com segurança: rodar num Postgres local descartável (não o
`master-jobs-local-supabase-db` compartilhado), com 2-3 fontes de teste
próprias (uma saudável, uma propositalmente quebrada) cadastradas do zero, e
então `jho jobs sync --run <id>` (all sources) com o mesmo opt-in de
ingestão local.
