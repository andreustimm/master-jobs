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

# 3ª revisão L2 de 29/09/2026, minor 2 — sinaliza ao controller (host) que o
# runner nunca chegou a pegar um job, sem depender de duração de parede: o
# controller não enxerga dentro deste contêiner depois que ele some
# (`--rm`), então o único jeito de distinguir "job real, rápido" de "ninguém
# pegou trabalho nenhum" é este contêiner decidir e sinalizar pelo próprio
# código de saída. 75 (EX_TEMPFAIL de sysexits.h — "falha temporária, tente
# de novo") não colide com o que `run.sh` já usa para os próprios erros.
readonly NO_JOB_PICKED_UP_EXIT_CODE=75

log() { echo "[entrypoint] $*"; }

# PIDs que o repasse de sinal e a limpeza precisam conhecer. Vazios até o
# processo correspondente existir.
DOCKERD_PID=""
RUNNER_PID=""
RUN_STATUS=0

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
  DOCKERD_PID=$!
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && return 0
    sleep 1
  done
  log "dockerd isolado não respondeu a tempo; log em /tmp/dockerd.log"
  cat /tmp/dockerd.log >&2 || true
  return 1
}

# Limpeza na saída (EXIT): para o dockerd interno com SIGTERM e espera ele
# terminar, para que jobs de contêiner aninhados não fiquem pela metade quando
# o `docker stop` do host chega. Sem dockerd (ainda) é no-op; nunca altera o
# código de saída do script.
stop_isolated_dockerd() {
  [ -n "$DOCKERD_PID" ] || return 0
  if kill -0 "$DOCKERD_PID" 2>/dev/null; then
    log "parando o dockerd isolado (pid ${DOCKERD_PID})"
    kill -TERM "$DOCKERD_PID" 2>/dev/null || true
    wait "$DOCKERD_PID" 2>/dev/null || true
  fi
  DOCKERD_PID=""
}

# Repasse de sinal. O entrypoint é o PID 1 do contêiner: o kernel NÃO aplica a
# ação padrão de SIGTERM/SIGINT ao PID 1 sem handler, então sem este trap o
# `docker stop` do host esperava o timeout (10 s) e terminava com SIGKILL,
# sem o `run.sh` nem o dockerd verem sinal nenhum. SIGINT também vira SIGTERM
# para o filho, que é o sinal que o `run.sh` trata.
#
# O `run.sh` do GitHub só instala o próprio trap (`trap 'kill -INT -$PID' INT
# TERM`, que manda SIGINT ao grupo do Runner.Listener) quando
# `RUNNER_MANUALLY_TRAP_SIG` está definida; sem ela ele roda o helper em
# primeiro plano, sem trap, e o SIGTERM mataria só o bash — o Listener e o
# Worker ficariam órfãos até o SIGKILL do kernel ao PID 1 sair. Por isso
# `launch_runner_process` define a variável. E o filho em segundo plano de um
# shell não interativo herda SIGINT IGNORADO (sinal ignorado na entrada não
# pode ser tratado nem reativado, e o helper herdaria o "ignorado"): por isso
# `supervise_runner` lança o filho com job control (`set -m`), que restaura o
# SIGINT padrão e o põe em grupo de processos próprio.
# Se o runner ainda não nasceu, sai direto (o trap de EXIT limpa o dockerd).
# Código de saída: 128 + sinal recebido (143/130). Nunca 75, para o controller
# não ler "nenhum job foi pego" quando na verdade pediram para parar.
TERMINATED_BY=""
on_termination_signal() {
  local name="$1" number="$2"
  TERMINATED_BY="$number"
  log "recebi SIG${name}; repassando SIGTERM ao runner"
  if [ -z "$RUNNER_PID" ]; then
    exit $((128 + number))
  fi
  kill -TERM "$RUNNER_PID" 2>/dev/null || true
}

# Lança o `run.sh --jitconfig` já no usuário 'runner', SEM camada intermediária:
# `setpriv` troca o uid/gid/grupos e faz `exec` no `run.sh`, então o PID que o
# entrypoint guarda em `$!` é o do próprio `run.sh`. Com `su -c`, o `su` ficava
# entre os dois e o repasse dependia de a versão do `su` encaminhar o sinal.
# `setpriv` vem do util-linux, já instalado na imagem (Dockerfile).
#
# m1 (re-revisão) — `env -i` constrói o ambiente do zero (só as cinco
# variáveis abaixo; `RUNNER_MANUALLY_TRAP_SIG` está explicada no repasse de
# sinal), sem depender do que `su` preserva ou não sem `--login`.
#
# Roda em subshell em segundo plano (chamador usa `&`); o `cd` e o `exec` não
# vazam para o shell principal.
launch_runner_process() {
  cd "$RUNNER_RUNTIME"
  exec env -i \
    "JIT_CONFIG=${JIT_CONFIG}" \
    "PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}" \
    "HOME=/home/runner" \
    "RUNNER_MANUALLY_TRAP_SIG=1" \
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    setpriv --reuid=runner --regid=runner --init-groups \
    ./run.sh --jitconfig "$JIT_CONFIG"
}

# Roda o runner em segundo plano e espera ele terminar de verdade, deixando o
# status em RUN_STATUS. O `wait` volta assim que um trap dispara, com status
# > 128, ainda com o filho vivo — por isso o laço: só sai quando o filho não
# existe mais (um zumbi ainda existe para `kill -0`, então o próximo `wait`
# colhe o status real). Se um sinal de término chegou, sai aqui com 128+sinal.
supervise_runner() {
  set -m
  launch_runner_process &
  RUNNER_PID=$!
  set +m
  while true; do
    wait "$RUNNER_PID" && RUN_STATUS=0 || RUN_STATUS=$?
    kill -0 "$RUNNER_PID" 2>/dev/null || break
  done
  RUNNER_PID=""

  if [ -n "$TERMINATED_BY" ]; then
    log "runner encerrado após pedido de parada (status do run.sh: ${RUN_STATUS}); saindo com $((128 + TERMINATED_BY))"
    exit $((128 + TERMINATED_BY))
  fi
}

main() {
  trap 'on_termination_signal TERM 15' TERM
  trap 'on_termination_signal INT 2' INT
  trap stop_isolated_dockerd EXIT

  prepare_writable_runtime_copy
  start_isolated_dockerd

  log "registrando e executando o job com a configuração JIT (uso único), como o usuário 'runner'"
  # `run.sh --jitconfig` registra, roda EXATAMENTE um job e se desfaz sozinho
  # — não é `config.sh` + token de registro reutilizável, e nada aqui grava
  # `JIT_CONFIG` em disco fora da cópia gravável descartável.
  #
  # SEM `exec` aqui (3ª revisão, minor 2): o entrypoint precisa continuar
  # vivo depois do `run.sh` para decidir o código de saída certo, e para
  # repassar o sinal de parada (ver `supervise_runner`).
  supervise_runner
  local run_status="$RUN_STATUS"

  if [ "$run_status" -ne 0 ]; then
    log "run.sh terminou com status ${run_status} — falha do PROCESSO do runner, não do job"
    exit "$run_status"
  fi

  # minor 2 — a duração da parede pune job curto legítimo (uma PR só de
  # documentação, por exemplo, termina em segundos). O sinal correto é a
  # presença do log do Worker: o runner só cria `_diag/Worker_*.log` quando
  # de fato pega e executa um job; `run.sh` saindo 0 sem isso significa que a
  # configuração JIT expirou ou nunca foi atribuída a um job — infraestrutura
  # falhando, não o job sendo rápido.
  if ! compgen -G "${RUNNER_RUNTIME}/_diag/Worker_*.log" > /dev/null; then
    log "run.sh saiu 0 mas sem log de Worker: nenhum job foi pego, sinalizando ao controller"
    exit "$NO_JOB_PICKED_UP_EXIT_CODE"
  fi

  log "job concluído (run.sh saiu 0 e há log de Worker) — o resultado do job em si já foi reportado ao GitHub pelo próprio runner"
  exit 0
}

# Só executa quando chamado como programa (ENTRYPOINT); `source` por um teste
# define as funções sem rodar `main`.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi

