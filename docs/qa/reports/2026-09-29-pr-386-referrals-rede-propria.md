# Execução de QA — 2026-09-29 — PR #386 (issue #379, rede de contatos por candidato)

Escopo: QA targeted do cenário `AUTH-referrals-own-network-only`. Uma conta
candidata nova não pode ver em `/referrals` a contagem de empresas nem os nomes
da rede de contatos de outra conta.

## Ambiente

E2E hermético do CI da PR #386, commit `3d0ea6c`, job `e2e-navegador`
(https://github.com/andreustimm/master-jobs/actions/runs/36586008561/job/109466388797).
O banco PostgreSQL é descartável e a aplicação roda em build standalone. O
login é real, por senha, com as contas por papel de `tests/e2e/setup.mjs`. O
driver é Playwright (`tests/e2e/ui/roles.mjs`). Nenhum mock substitui a sessão
ou o banco.

Dado de teste: o dono (`e2e@local.test`, candidato `default`) tem o contato
fixture "Task 04 referral contact", em "Task 04 Typical Lab", empresa com vaga
aberta. A candidata pura (`e2e-candidato@local.test`) tem candidato próprio e
nenhum contato.

## Matriz

| # | Passo | Persona | Status | Evidência |
|---|---|---|---|---|
| 1 | Candidata entra com senha, abre `/referrals` e vê a rede vazia (`referrals-empty-network`), sem contagem (`referrals-network-count`), sem linha de indicação (`referral-job-*`) e sem o nome do contato do dono no texto da tela | Candidato após falha | **Pass** | log do job, linha "✓ #379 candidato não vê a rede de contatos de outra conta em /referrals" |
| 2 | Mesma leitura depois de recarregar a página | Candidato após falha | **Pass** | mesmo check: o laço relê depois de `reload()` |
| 3 | O dono continua vendo a indicação pela própria rede | Andreus | **Pass** | fluxos canônicos de `/referrals` (`canonical-flows.mjs`) na mesma execução, 431/431 |

## Fora desta execução

- Não houve percurso manual com as contas reais de produção.
- A rede gravada antes da migration 0031 fica sem dono e oculta, inclusive
  para o dono, até o backfill da #405. O reteste do dono com a rede antiga
  pertence à #405.
- Localmente, o E2E isolado reprovou em áreas fora deste diff: a guarda de
  inglês em `/p/e2e-cv-formatado` numa rodada, e `savedStage` em
  `pipeline.mjs` em duas. No CI deste commit, a suíte passou inteira.
