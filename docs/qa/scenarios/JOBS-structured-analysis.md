---
id: JOBS-structured-analysis
area: JOBS
title: Pedir e ler a análise estruturada da vaga
persona: Andreus em triagem
journey: J-read-structured-job-analysis
expected: Pedir a análise deixa a seção pendente mesmo após recarga; depois do processamento cada campo traz valor e trecho do anúncio, o que falta aparece como desconhecido, modelo e custo só para admin, pedir de novo o mesmo texto não cria outra análise e o texto alterado mostra o aviso de desatualizada
entry_points: /jobs/<id>
qa_status: blocked-verify
bug_ids: BUG-20261001-analysis-provider-error-hides-cause
fix_status: pending
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-structured-analysis-first-read-pendente.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-structured-analysis-first-read-falhou.png
last_report: docs/qa/reports/2026-10-01-qa-223-verificacoes.md
overlaps: JOBS-detail-owner-view-english
---

Novo em #223 (tarefa 06). O processamento roda pela CLI (`jho analysis run`)
com a chave de quem opera; a jornada completa pede um provedor configurado ou
o processador com provedor falso do E2E-006.

**2026-09-28** (`CH-structured-analysis-first-read`): "Pedir análise" deixa a
seção pendente e ela sobrevive a `reload`; a única tentativa com o provedor
terminou `provider_error`; o admin vê o painel "Tentativas" com o modelo, a
candidata não vê painel nem modelo.

**2026-10-01** (mesma charter, relatório em `last_report`), em Postgres
descartável, com uma vaga cadastrada em `/compare` (texto próprio, em inglês,
sem salário):

- Pendente depois de pedir ("Análise pendente… na fila · prompt v1 · esquema
  v1"), igual após `reload`.
- `jho analysis run --max 1 --yes` terminou `{"id":1,"status":"failed"}`; a
  tela mostra "A última tentativa não terminou (falhou)"; admin lê "modelo
  nvidia/moonshotai/kimi-k2-instruct · erro: provider_error"; `bruno@local.test`
  (candidato) lê só "não terminou (falhou)", sem painel, modelo nem erro.
- Texto da vaga alterado pelo mesmo `/compare` (mesma identidade): a seção
  mostra "A vaga mudou depois desta análise: os campos abaixo leem o texto
  anterior", mesmo numa tentativa falha, sem campo nenhum abaixo (incômodo
  pequeno, registrado nos paper cuts do relatório).

**Bloqueado, não reprovado, com a causa exata.** O provedor NVIDIA NIM
responde e a chave autentica (chave de controle inválida dá 401), mas: os três
modelos NIM do cadastro estão desligados — `moonshotai/kimi-k2-instruct`
(o padrão) HTTP 410, fim de vida em 2026-05-12; `qwen/qwen3-coder-480b-a35b-instruct`
HTTP 410, em 2026-06-11; `meta/llama-3.1-405b-instruct` HTTP 404 — e cinco
modelos vivos do catálogo do provedor devolvem HTTP 403 "Authorization failed"
para esta chave. Sem um modelo autorizado não há caminho de sucesso para
observar: campos com valor e trecho, "desconhecido" onde falta evidência,
versão visível ao candidato, custo ao admin, pedir de novo o mesmo texto sem
criar outra análise e o aviso de desatualizada sobre uma análise concluída.
Nenhum resultado foi simulado. O defeito de diagnóstico (a tela só diz
`provider_error`; o cadastro oferece modelos desligados) é
`BUG-20261001-analysis-provider-error-hides-cause`.

Pré-requisito para fechar: uma chave de provedor autorizada para pelo menos um
modelo vivo (autorizar a chave NVIDIA na conta do dono, ou configurar outro
provedor), e então `jho analysis run --yes [--model <id>]` sobre uma vaga com
análise pendente.
