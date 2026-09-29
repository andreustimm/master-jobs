## Técnico

### Adicionado

- `runs-on:` dos nove jobs de `.github/workflows/ci.yml` passa a ler `vars.CI_RUNS_ON`, com fallback ao `ubuntu-latest` hospedado quando a variável está ausente ou vazia (issue #367, ADR 0030 decisões 1/2/4/5). A guarda de fork fica embutida na própria expressão: PR cuja `head.repo` difere de `github.repository` sempre resolve para `ubuntu-latest`, mesmo com `CI_RUNS_ON` apontando para o runner próprio.
- `scripts/github/fork-guard.ts` (`isForkPullRequest`, puro) e `tests/ci-runner-selection.test.ts` (F2-01–F2-04 de `.compozy/tasks/contingencia-ci-deploy/_tests.md`): nenhum `runs-on:` literal sobrevive, e a guarda de fork da expressão nunca diverge da função pura testada isolada.
- `scripts/runner/provision-vps.sh` e `scripts/runner/runner-loop.sh`: provisionamento idempotente de Node 24.19, pnpm, Docker, dependências do Chromium/WebKit e um runner self-hosted **efêmero** (systemd + `config.sh --ephemeral`), sem nenhuma credencial embutida — o token de registro é pedido em tempo de execução com um PAT que o dono cola em `/etc/master-jobs-runner/env`, fora do repositório.
- `docs/engineering/deploy.md`, seção "Runner self-hosted opt-in (`CI_RUNS_ON`)": passo do dono para contratar a VPS, provisionar, registrar o runner e ligar/desligar a chave.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
