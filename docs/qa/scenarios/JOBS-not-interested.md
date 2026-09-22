---
id: JOBS-not-interested
area: JOBS
title: Marcar uma vaga como "não me interessa" e desfazer
persona: Andreus em triagem
journey: J-preserve-application-decision
expected: "Não me interessa" na lista ou no detalhe tira a vaga de Vagas e do cockpit, a decisão sobrevive à recarga, a vaga aparece em "Arquivadas" e "restaurar" a devolve às listas enquanto não houve candidatura enviada
entry_points: /jobs; /jobs/<id>; /jobs?fit=0&status=archived; /
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s4-archived-375.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PIPE-save-resume-decision; JOBS-country-only-blocked
---

O caso que motivou: abrir a vaga na origem, ler "United States only" e voltar.
O clique arquiva pela mesma regra do seletor de estágio e grava o evento no
histórico. Arquivada depois de aplicar não oferece "restaurar". Recrutador não
vê o botão. Na lista ele fica logo abaixo do aviso de bloqueio, fora do grupo
vaga/site/aplicar, e mede ao menos 40px de altura no celular.

Full 1.22.0 (2026-09-22): Não me interessa no detalhe (375 px) tira a vaga de Vagas e do cockpit, ela aparece em Arquivadas após reload, e restaurar a devolve.
