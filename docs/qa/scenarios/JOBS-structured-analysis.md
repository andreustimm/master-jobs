---
id: JOBS-structured-analysis
area: JOBS
title: Pedir e ler a análise estruturada da vaga
persona: Andreus em triagem
journey: J-read-structured-job-analysis
expected: Pedir a análise deixa a seção pendente mesmo após recarga; depois do processamento cada campo traz valor e trecho do anúncio, o que falta aparece como desconhecido, modelo e custo só para admin, pedir de novo o mesmo texto não cria outra análise e o texto alterado mostra o aviso de desatualizada
entry_points: /jobs/<id>
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28-qa-223-catch-up/CH-structured-analysis-first-read-pending.png
last_report: docs/qa/reports/2026-09-28-qa-223-catch-up.md
overlaps: JOBS-detail-owner-view-english
---

Novo em #223 (tarefa 06). O processamento roda pela CLI (`jho analysis run`)
com a chave de quem opera; a jornada completa pede um provedor configurado ou
o processador com provedor falso do E2E-006.

**Percorrido em 2026-09-28** (`CH-structured-analysis-first-read`, persona
Andreus em triagem), parcial: em `/jobs/8778`, "Request analysis" deixou a
seção como "Analysis pending. It runs outside this page and shows up here
when it finishes. · queued · prompt v1 · schema v1", e o estado sobreviveu a
`reload`. Havia de fato um provedor configurado (`NVIDIA_API_KEY`, NVIDIA NIM
· Kimi K2) — rodei `jho analysis run --yes` como operadora, e o único anúncio
na fila terminou `{"id":1,"status":"failed"}`. Reaberta a vaga, a seção mostra
"The latest attempt did not finish (failed)" com botão "Request a new
analysis"; como admin (`e2e@local.test`) o painel "Attempts (visible to admins
only)" lista "#1 · failed · model nvidia/moonshotai/kimi-k2-instruct · error:
provider_error"; como candidata (`e2e-candidato@local.test`) a mesma vaga
mostra só "did not finish (failed)", sem o painel de tentativas nem o nome do
modelo — a distinção admin/candidato se confirma mesmo numa tentativa
malsucedida.

**Bloqueado, não reprovado:** não forcei uma segunda chamada real ao provedor
(persona fidelity: não insista além de uma tentativa limpa, e o erro é de um
serviço de terceiro, não algo que eu deva mascarar reexecutando às custas do
saldo do dono) — por isso não observei o caminho de sucesso (campos com valor
e trecho, "desconhecido" onde falta evidência, aviso de análise desatualizada
após alterar o texto). `provider_error` não foi registrado como bug: é uma
falha externa que o produto já trata bem (mensagem clara, sem vazar chave nem
stack, botão de tentar de novo). Pré-requisito para fechar: rodar
`jho analysis run --yes` de novo quando o provedor estiver saudável (ou trocar
de modelo com `--model`) e completar a leitura dos campos processados.
