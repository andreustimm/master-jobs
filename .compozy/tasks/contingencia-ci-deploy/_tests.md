# Contrato de testes: Contingência de CI e deploy

Companheiro de [_prd.md](_prd.md) e [_techspec.md](_techspec.md). Cada fase é
uma entrega independente (issue própria); os IDs abaixo são o contrato de
aceite **daquela fase**, testável antes de a PR correspondente ficar pronta
(G53/G57). Nenhum destes testes existe hoje — são o contrato para a execução,
não uma descrição de código já escrito (G83).

## Estratégia

- **Automatizado (Vitest):** contratos que não exigem rede real nem a VPS/o
  destino alternativo existirem — leitura de `vercel.json`, do YAML de
  `ci.yml` como texto, e funções puras de decisão (limiares do vigia).
- **Verificação operacional (manual, com observável exigido):** o que só
  existe depois que o dono provisiona a VPS, a conta do provedor alternativo
  ou a zona Cloudflare — cada item lista o comando ou a evidência que prova
  passagem, no espírito de G56 ("`Pass` exige prova que sobrevive a leitura
  independente").
- **Execução:** testes automatizados entram no `pnpm check`/CI normal da PR de
  cada fase; a verificação operacional é registrada na PR (ou no runbook de
  `docs/operations.md`) com o comando e a saída observada, nunca como
  autorrelato sem evidência.

## Matriz de cobertura

| Fase | Comportamento | Unitário | Integração/estrutural | Operacional (manual) |
|---|---|---|---|---|
| Fase 1 | só `main` deploya | — | F1-01, F1-02 | F1-M01 |
| Fase 1 | `DEPLOY_PREVIEW_ENVS` nunca diverge de `vercel.json` | F1-03 | F1-04 | F1-M02 |
| Fase 1 | docs deixam de prometer deploy de `dev`/`staging` | — | F1-05 | — |
| Fase 2 | `runs-on` só pela variável, sem literal novo | — | F2-01, F2-02 | — |
| Fase 2 | PR de fork nunca roteia para o runner próprio | F2-03 | F2-04 | F2-M01 |
| Fase 2 | imagem do runner tem as dependências certas | — | — | F2-M02 |
| Fase 2 | runner é efêmero (não sobrevive entre jobs) | — | — | F2-M03 |
| Fase 3 | limiares 70%/90% decidem a ação certa | F3-01, F3-02, F3-03 | — | — |
| Fase 3 | vigia mora fora dos provedores monitorados | — | F3-04 | F3-M01 |
| Fase 3 | ação automática é sempre reversível e registrada | F3-05 | — | F3-M02 |
| Fase 4 | imagem Docker builda e roda localmente | — | F4-01 | F4-M01 |
| Fase 4 | destino alternativo serve produção de verdade uma vez | — | — | F4-M02 |
| Fase 4 | DNS de failover funciona nos dois sentidos | — | — | F4-M03 |
| Fase 4 | nenhum segredo de produção aparece em texto versionado | F4-02 | — | — |

## Fase 1 — Deploy só em `main`

### Automatizados

- **F1-01** (unitário/estrutural): `vercel.json` tem
  `git.deploymentEnabled.main === true` e
  `git.deploymentEnabled.dev === false` e `.staging === false` quando
  `DEPLOY_PREVIEW_ENVS` está ausente/vazia.
- **F1-02** (estrutural): `git.deploymentEnabled["**"] === false` continua
  presente (nenhuma branch de tarefa deploya).
- **F1-03** (unitário): a função pura que interpreta `DEPLOY_PREVIEW_ENVS`
  (`"", "dev", "dev,staging"`) rejeita valor fora de `{dev, staging}` (nunca
  aceita `main` na lista, porque `main` não depende da variável) e rejeita
  duplicata.
- **F1-04** (integração/estrutural): o script de verificação
  (`scripts/github/verify-deploy-preview-envs.ts`) detecta divergência entre
  o valor lido de `vars.DEPLOY_PREVIEW_ENVS` (via `gh api`, com um fake para
  o teste) e o mapa de `vercel.json`, e sai com código diferente de zero.
- **F1-05** (estrutural): `docs/engineering/deploy.md` e
  `docs/engineering/promotion.md` não contêm mais a afirmação de que a
  promoção gera deploy de `staging` a cada ciclo (grep/parse simples, no
  estilo dos validadores de `pnpm check:instructions`).

### Operacional

- **F1-M01**: depois do merge, um push de teste em `dev` (ou o próximo merge
  real) **não** cria um novo deployment em `jobs-dev.mastertimm.com.br` no
  painel da Vercel — evidência: captura da lista de *Deployments* do projeto,
  filtrada por branch `dev`, sem entrada nova após o timestamp do merge.
- **F1-M02**: rodar `verify-deploy-preview-envs.ts` contra o repositório real
  imediatamente após o merge da Fase 1 e confirmar saída "sem divergência".

## Fase 2 — CI com runner selecionável

### Automatizados

- **F2-01** (estrutural, no estilo de `tests/ci-pipeline.test.ts`): todo
  `runs-on:` em `.github/workflows/ci.yml` casa com a expressão
  `${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}` (ou variação
  aprovada equivalente) — nenhuma ocorrência de `runs-on: ubuntu-latest`
  literal sobrevive.
- **F2-02** (estrutural): um job novo adicionado ao arquivo fixture de teste
  com `runs-on:` literal faz o teste falhar (prova de que o gate pega
  regressão, não só o estado atual).
- **F2-03** (unitário): a condição de guarda de fork, extraída como função
  pura (`isForkPullRequest`-like) sobre um evento fake, retorna `true` para
  `pull_request` cujo `head.repo.full_name` difere de
  `head_repository.full_name`/`github.repository`, e `false` para push do
  próprio repositório e para `pull_request` do próprio repositório.
- **F2-04** (integração/estrutural): o YAML do job (ou do gate único) contém
  a guarda de F2-03 associada a qualquer branch que resolva `runs-on` para
  `self-hosted` — verificado por parse do YAML, não por execução real.

### Operacional

- **F2-M01**: abrir uma PR de teste **a partir de um fork real** (ou simular
  o evento via `workflow_dispatch` com o payload de fork) com
  `vars.CI_RUNS_ON` apontando para o runner próprio, e confirmar que o job
  correspondente não roda nele (fica pendente de aprovação humana do
  "Approve and run", como hoje) — evidência: link do run e do status
  `action_required`/recusado.
- **F2-M02**: `docker run` (ou execução direta na VPS) da imagem do runner e
  `node --version`, `pnpm --version`, `psql --version` (ou `pg_isready` contra
  um Postgres de teste), `google-chrome --version`/`chromium --version`
  respondem as versões esperadas (Node 24.19, pnpm da `packageManager` do
  `package.json`).
- **F2-M03**: dois jobs seguidos no runner próprio não compartilham arquivo
  deixado por um workflow malicioso de teste (gravar um arquivo marcador no
  primeiro job, confirmar ausência no segundo) — prova de efemeridade.
- Checklist de virar a chave (runbook completo): `gh variable set CI_RUNS_ON
  --body '["self-hosted","master-jobs"]'`, um push real em `dev`, CI
  inteiro verde no runner próprio, depois `gh variable set CI_RUNS_ON --body
  '"ubuntu-latest"'` (ou remoção da variável) e novo push confirmando volta ao
  hospedado.

## Fase 3 — Fallback automático e observabilidade de cota

### Automatizados

- **F3-01** (unitário): a função pura de decisão recebe
  `{ vercelDeploys24h, actionsQueueMaxWaitS, actionsStatus }` fake e retorna
  `"ok"` abaixo de 70%, `"aviso"` entre 70% e 90%, `"acao-automatica"` a
  partir de 90% ou quando `actionsStatus` indica indisponibilidade.
- **F3-02** (unitário): amostra ausente ou inválida (rede falhou ao coletar a
  métrica) nunca é interpretada como "ok" — vira estado explícito de
  "amostra indisponível", sem decidir por dado que não existe (o mesmo
  espírito da regra 8, "dado faltante pontua neutro", adaptado a
  infraestrutura: dado faltante nunca finge normalidade).
- **F3-03** (unitário): a mesma amostra processada duas vezes produz a mesma
  decisão (determinístico, sem relógio implícito fora do parâmetro
  `checked_at` explícito).
- **F3-04** (integração/estrutural): o SQL/config do agendador do vigia
  (`supabase/cron/...`, se a Decisão 3 confirmar a opção A) não referencia
  nenhuma tabela ou serviço hospedado em Vercel/GitHub como dependência de
  execução — só Supabase e as APIs externas que ele consulta.
- **F3-05** (unitário): toda transição para `"acao-automatica"` produz um
  registro com o comando de reversão explícito na mesma estrutura de dado
  que grava a ação (nunca uma ação sem o campo de reversão preenchido).

### Operacional

- **F3-M01**: com a Decisão 3 implementada, desligar (ou simular
  indisponível) o provedor monitorado em ambiente de teste e confirmar que o
  vigia continua respondendo — evidência: linha nova em `quota_watch` gerada
  enquanto o alvo monitorado estava fora.
- **F3-M02**: forçar amostra acima de 90% em ambiente de teste e confirmar
  que 1) a variável de repositório muda, 2) uma issue é aberta com o texto do
  que mudou e do comando de reversão, 3) repetir a reversão manual e
  confirmar que o estado volta ao original.

## Fase 4 — Deploy de produção com alternativa

### Automatizados

- **F4-01** (integração, pode rodar em CI): `docker build` da imagem proposta
  termina com sucesso e `docker run` seguido de uma requisição HTTP simples
  (`/api/health` ou equivalente) responde `200` dentro de um timeout curto,
  com `DATABASE_URL` apontando para um Postgres de teste efêmero (mesmo
  padrão de `tests/support/postgres-global.ts`).
- **F4-02** (estrutural): nenhuma camada da imagem construída
  (`docker history --no-trunc`) contém um valor que bata com o padrão de um
  segredo conhecido (reaproveita a lógica de `redactSecrets`/padrões de
  `src/core/observability.ts` como lista de detecção, adaptada a texto de
  camada de imagem).

### Operacional

- **F4-M01**: publicar a imagem no GHCR uma vez e confirmar
  `docker pull ghcr.io/andreustimm/master-jobs:<tag-de-teste>` funciona a
  partir de uma máquina fora da rede do dono.
- **F4-M02**: implantar a imagem no destino alternativo escolhido (Decisão 4),
  com os segredos de um ambiente de teste (nunca os de produção), e confirmar
  que a aplicação responde no domínio temporário do provedor — login,
  `/p/<slug>` de um perfil de teste devolvendo o esperado, e nenhuma rota
  autenticada respondendo sem sessão (mesma checklist de "O que confirmar
  depois de subir" do `deploy.md`, itens 1–2).
- **F4-M03**: no exercício de failover, trocar o CNAME de um subdomínio de
  teste na Cloudflare para o destino alternativo, confirmar propagação
  (`dig +trace`) dentro do TTL declarado, confirmar TLS válido, e então
  reverter o CNAME e confirmar volta ao estado original — os dois sentidos do
  runbook, não só a ida.

## Fora do contrato desta entrega

Testes de UI/E2E (Playwright) não se aplicam: nenhuma das quatro fases altera
`app/`, `components/` ou qualquer rota visível ao candidato/recrutador. A
regra 11 (toda tela funciona em 375px) e a regra 9 (texto de UI no
dicionário) não incidem sobre este contrato. Se uma fase futura expuser
estado do vigia numa tela administrativa, esse trabalho abre seu próprio
contrato de testes E2E, fora desta entrega.
