#!/usr/bin/env bash
# Entrypoint do contêiner efêmero do runner (issue #367, ADR 0030 decisão 5;
# revisão L2 da PR #376, C1/C2/M1/M4; re-revisão de 29/09/2026). Root-owned e
# só leitura dentro da imagem (`--chmod=0555` no Dockerfile) — nem um passo
# hostil do job reescreve o que o PRÓXIMO contêiner vai executar, porque o
# próximo contêiner nem existe ainda: ele nasce de novo desta mesma imagem
# imutável.
#
# Recebe só `JIT_CONFIG` (variável de ambiente, de uso único, gerada pela API
# do GitHub pelo controller do host) — nunca o PAT de longa duração, que fica
# só no processo do controller, fora deste contêiner.
#
# Este contêiner sobe SEM `--privileged` (re-revisão C1): o `docker run` do
# controller usa `--runtime=sysbox-runc`, que dá a este contêiner o
# suficiente para rodar um dockerd interno de verdade sem as capacidades
# amplas de `--privileged` — que, num host real, equivaleriam a dar ao job
# acesso aos dispositivos de bloco do PRÓPRIO HOST (ex.: montar `/dev/sda` de
# dentro do contêiner e ler `/etc/master-jobs-runner/env`, o arquivo que
# guarda o PAT que controla até a política de aprovação de fork). Sem sysbox,
# a "isolação" do dockerd interno seria teatro: o contêiner externo já teria
# o mesmo poder do host. Ver docs/engineering/deploy.md e ADR 0030 para o
# porquê completo.
set -euo pipefail

: "${JIT_CONFIG:?entrypoint.sh exige JIT_CONFIG (gerado pelo runner-controller.sh do host)}"

RUNNER_SOURCE=/opt/actions-runner
# O runner do GitHub grava `.runner`, `.credentials` e `_work`/`_diag` DENTRO
# do próprio diretório de instalação — para isso, `runner` precisa de
# permissão de ESCREVER nesse diretório. `RUNNER_SOURCE` (root:root, sem bit
# de escrita para ninguém desde o build da imagem, M1) nunca é esse
# diretório: `RUNNER_RUNTIME` é uma cópia refeita do zero a cada contêiner,
# só ela é escrita, e desaparece com o contêiner.
RUNNER_RUNTIME=/run/actions-runner

log() { echo "[entrypoint] $*"; }

# M4 — limpa qualquer resquício de execução anterior antes de copiar e rodar.
# Cada contêiner nasce de imagem limpa, então isto não deveria encontrar nada;
# existe como rede de segurança contra uma parada suja que tenha deixado a
# camada gravável do contêiner com estado de uma execução anterior no MESMO
# contêiner (por exemplo, um restart do processo sem recriar o contêiner) —
# nunca entra em crash-loop tentando reusar uma credencial velha.
prepare_writable_runtime_copy() {
  log "recriando a cópia gravável do runner a partir da origem imutável"
  rm -rf "$RUNNER_RUNTIME"
  mkdir -p "$RUNNER_RUNTIME"
  cp -a "${RUNNER_SOURCE}/." "$RUNNER_RUNTIME"
  chown -R runner:runner "$RUNNER_RUNTIME"
  # M1 (re-revisão): `chown` muda o DONO, não o modo. A origem em
  # `RUNNER_SOURCE` está `a-w` (sem bit de escrita para NINGUÉM, nem para o
  # dono) — a cópia herda esse modo do `cp -a`, então sem este `chmod` o
  # usuário `runner` fica dono de arquivos que ele mesmo não pode escrever, e
  # o passo interno do runner que grava `.credentials`/`.runner` falha em
  # silêncio (o processo sai sem pegar job nenhum, sem erro visível no log
  # do controller). Provado localmente, sem registrar runner nenhum: `docker
  # run --rm debian:bookworm-slim bash -c '<mesma sequência de chown/chmod,
  # troca para o usuário não-root, tenta escrever>'` falha sem este `chmod` e
  # passa com ele.
  chmod -R u+w "$RUNNER_RUNTIME"
  # Redundante com o `rm -rf` acima (a cópia vem de uma origem sem esses
  # arquivos), mas explícito por nome, como o M4 pede — se algum dia a
  # origem passar a conter um desses por engano, o entrypoint ainda os
  # remove antes de qualquer config/run.
  rm -f "${RUNNER_RUNTIME}/.runner" "${RUNNER_RUNTIME}/.credentials" "${RUNNER_RUNTIME}/.credentials_rsaparams"
  rm -rf "${RUNNER_RUNTIME}/_work"
}

start_isolated_dockerd() {
  log "iniciando dockerd isolado deste contêiner (nunca o socket do host; runtime sysbox-runc, sem --privileged)"
  # O entrypoint roda como root (padrão do contêiner) só até aqui — o
  # dockerd em si exige, e o runner do GitHub RECUSA rodar como root sem
  # `RUNNER_ALLOW_RUNASROOT`, que este script nunca define.
  dockerd --host=unix:///var/run/docker.sock --group=docker >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && return 0
    sleep 1
  done
  log "dockerd isolado não respondeu a tempo; log em /tmp/dockerd.log"
  cat /tmp/dockerd.log >&2 || true
  return 1
}

main() {
  prepare_writable_runtime_copy
  start_isolated_dockerd

  log "registrando e executando o job com a configuração JIT (uso único), como o usuário 'runner'"
  # `run.sh --jitconfig` registra, roda EXATAMENTE um job e se desfaz sozinho
  # — não é `config.sh` + token de registro reutilizável, e nada aqui grava
  # `JIT_CONFIG` em disco fora da cópia gravável descartável.
  #
  # m1 (re-revisão) — `env -i` constrói o ambiente do zero, em vez de confiar
  # em `su --whitelist-environment` sem `--login`: o comportamento de
  # preservar variável por variável sem uma sessão de login completa varia
  # entre versões de `su`, e um ambiente construído explicitamente (só as
  # quatro variáveis abaixo) não depende dessa sutileza. `su -p` (preserve)
  # aceita o ambiente que `env -i` já deixou pronto, sem o próprio `su`
  # tentar montar outro por cima.
  exec env -i \
    "JIT_CONFIG=${JIT_CONFIG}" \
    "PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}" \
    "HOME=/home/runner" \
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    su -p runner -c "cd '${RUNNER_RUNTIME}' && exec ./run.sh --jitconfig \"\$JIT_CONFIG\""
}

main "$@"
