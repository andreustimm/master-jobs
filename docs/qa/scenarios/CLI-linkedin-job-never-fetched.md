---
id: CLI-linkedin-job-never-fetched
area: CLI
title: Vaga com URL do LinkedIn é guardada mas nunca buscada nem fechada
persona: Andreus em triagem noturna
journey: J-trust-the-filtered-board
expected: Cadastrar vaga com URL do LinkedIn não faz pedido ao LinkedIn; a verificação de links a trata como inconclusiva e a vaga continua aberta e visível no quadro com a URL como texto
entry_points: jho jobs add <url>; jho jobs verify; /jobs
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/log.txt
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps:
---

Regra 1 (#232). A prova de "nenhum pedido" é por teste de efeito
(`tests/linkedin-acquisition-boundary.test.ts`); a sessão confirma o observável
do usuário: a vaga não some e nada fala em buscar o LinkedIn.

Full 1.22.0 (2026-09-22): Cadastro manual com URL do LinkedIn guarda e exibe a vaga (fonte linkedin.com, link como texto) e ela entra em Aplicáveis hoje. `jho jobs verify --dry-run` recusa rodar no ambiente isolado ('Ingestion blocked in preview'). Humano: numa máquina local com ingestão liberada, rodar `jho jobs verify --dry-run` com a vaga do LinkedIn acima do corte e conferir 'inconclusive' e a vaga aberta.
