## Técnico

### Adicionado

- `runs-on:` dos nove jobs de `.github/workflows/ci.yml` passa a ler `vars.CI_RUNS_ON`, com fallback ao `ubuntu-latest` hospedado quando a variável está ausente ou vazia (issue #367, ADR 0030 decisões 1/2/4/5). A metade da expressão que roteia fork para `ubuntu-latest` é **defesa em profundidade**, documentada como tal (revisão L2 da PR #376, C1): a barreira real é a política `fork-pr-contributor-approval=all_external_contributors`, pré-requisito do dono antes de ligar `CI_RUNS_ON`, nunca alterada por agente.
- `scripts/github/fork-guard.ts` (`isForkPullRequest`, puro) e `tests/ci-runner-selection.test.ts` (F2-01–F2-04 de `.compozy/tasks/contingencia-ci-deploy/_tests.md`, mais a cobertura do skip de instalação do Playwright no runner próprio): nenhum `runs-on:` literal sobrevive, e a guarda de fork da expressão nunca diverge da função pura testada isolada.
- `scripts/runner/Dockerfile` (imagem imutável: Node/pnpm de `package.json`, Playwright pré-instalado, runner do GitHub com checksum verificado) e `scripts/runner/entrypoint.sh`: cada job roda num **contêiner descartável**, com dockerd isolado dentro do próprio contêiner (nunca o socket Docker do host) e uma cópia gravável e descartável do runner — a origem `/opt/actions-runner` nunca é escrita depois do build (revisão L2, C2/M1).
- `scripts/runner/runner-controller.sh` (host, systemd): pede uma configuração JIT de uso único por job (`generate-jitconfig`) e nunca repassa o PAT de longa duração ao contêiner do job; escopo recomendado é fine-grained "Administration: write", não o clássico `repo` (revisão L2, C2).
- `.github/workflows/ci.yml`: instalação do Playwright (`--with-deps`/`install-deps`) pula quando `runner.environment == 'self-hosted'`, já coberto pela imagem (revisão L2, M2).
- `docs/engineering/deploy.md`, seção "Runner self-hosted opt-in (`CI_RUNS_ON`)": pré-requisito de aprovação de workflow de fork, passo do dono para contratar a VPS e provisionar o novo desenho por contêiner, aviso sobre `fromJSON` exigir JSON válido, e runbook de volta (inclusive cancelar/redisparar runs presos no runner próprio).
- ADR 0030: nota de execução datada rebaixando a guarda de `runs-on` a defesa em profundidade e registrando a política de aprovação de fork como a barreira real.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
