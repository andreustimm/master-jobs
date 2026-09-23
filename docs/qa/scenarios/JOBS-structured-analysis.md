---
id: JOBS-structured-analysis
area: JOBS
title: Pedir e ler a análise estruturada da vaga
persona: Andreus em triagem
journey: J-read-structured-job-analysis
expected: Pedir a análise deixa a seção pendente mesmo após recarga; depois do processamento cada campo traz valor e trecho do anúncio, o que falta aparece como desconhecido, modelo e custo só para admin, pedir de novo o mesmo texto não cria outra análise e o texto alterado mostra o aviso de desatualizada
entry_points: /jobs/<id>
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-detail-owner-view-english
---

Novo em #223 (tarefa 06). O processamento roda pela CLI (`jho analysis run`)
com a chave de quem opera; a jornada completa pede um provedor configurado ou
o processador com provedor falso do E2E-006.
