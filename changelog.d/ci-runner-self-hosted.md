## Técnico

### Adicionado

- `runs-on:` dos nove jobs de `.github/workflows/ci.yml` passa a ler `vars.CI_RUNS_ON`, com fallback ao `ubuntu-latest` hospedado quando a variável está ausente ou vazia (issue #367, ADR 0030 decisões 1/2/4/5). A metade da expressão que roteia fork para `ubuntu-latest` é **defesa em profundidade**, documentada como tal (revisão L2 da PR #376, C1): a barreira real é a política `fork-pr-contributor-approval=all_external_contributors`, aplicada pelo dono em 29/09/2026.
- `scripts/github/fork-guard.ts` (`isForkPullRequest`, puro), `tests/support/ci-workflow.ts` (`resolveCanonicalRunsOn`, mini-avaliador da expressão canônica) e `tests/ci-runner-selection.test.ts` (F2-01–F2-04 de `_tests.md`, prova de equivalência comportamental entre a expressão e a função pura, cobertura do skip de instalação do Playwright, e ausência de `--privileged` em qualquer invocação real de `docker run`/`dockerd`).
- `scripts/runner/Dockerfile` (imagem imutável: Node/pnpm de `package.json`, versão exata de Playwright do `pnpm-lock.yaml`, runner do GitHub com checksum verificado) e `scripts/runner/entrypoint.sh`: cada job roda num **contêiner descartável**, com dockerd isolado dentro do próprio contêiner (nunca o socket Docker do host, nunca `--privileged` — runtime `sysbox-runc`, re-revisão L2 de 29/09/2026, C1) e uma cópia gravável e descartável do runner, com o bit de escrita restaurado após o `chown` (M1) — a origem `/opt/actions-runner` nunca é escrita depois do build.
- `scripts/runner/provision-vps.sh` instala `sysbox-runc` com checksum verificado antes de buildar a imagem do runner.
- `scripts/runner/runner-controller.sh` (host, systemd com `Requires=docker.service`): pede uma configuração JIT de uso único por job (`generate-jitconfig`, cabeçalho `Authorization` passado por `-H @-`/stdin, nunca no `argv`), desregistra runner órfão e aplica backoff exponencial (30s–10min) quando um contêiner termina cedo demais ou o `docker run` falha; escopo recomendado é fine-grained "Administration: write", não o clássico `repo`.
- `.github/workflows/ci.yml`: instalação do Playwright (`--with-deps`/`install-deps`) pula quando `runner.environment == 'self-hosted'`, já coberto pela imagem.
- `docs/engineering/deploy.md`, seção "Runner self-hosted opt-in (`CI_RUNS_ON`)": status atualizado do pré-requisito de aprovação de fork (aplicado), o porquê de `sysbox-runc`, aviso sobre `fromJSON` exigir JSON válido, e runbook de volta restrito a `--workflow ci.yml`, com `gh run rerun` em vez de commit vazio.
- ADR 0030: notas de execução datadas (29/09/2026) rebaixando a guarda de `runs-on` a defesa em profundidade, registrando a aprovação de fork como aplicada, e documentando `sysbox-runc` na decisão do runner efêmero.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
