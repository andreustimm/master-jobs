#!/usr/bin/env bash
# Controller do runner self-hosted efêmero (issue #367, ADR 0030 decisão 5;
# revisão L2 da PR #376, C2).
#
# Roda no HOST (fora de qualquer contêiner de job), como o serviço systemd
# `master-jobs-runner-controller.service` instalado por provision-vps.sh.
# Para cada job:
#   1. pede à API do GitHub uma configuração JIT (uso único, escopo de
#      exatamente um runner efêmero) — NUNCA um token de registro reutilizável
#      nem o PAT em si;
#   2. sobe um CONTÊINER DESCARTÁVEL (`--rm`) da imagem imutável
#      (scripts/runner/Dockerfile), passando só a config JIT como variável de
#      ambiente daquele contêiner;
#   3. espera o contêiner terminar (um job = um contêiner = uma vida) e
#      recomeça.
#
# O `GH_RUNNER_REGISTRATION_PAT` só existe no ambiente DESTE processo
# (`EnvironmentFile=` do systemd, arquivo root-only) — nunca é repassado ao
# `docker run` do job. O contêiner do job só recebe `JIT_CONFIG`, que expira
# depois de um uso e não serve para registrar outro runner.
#
# Este controller roda como root porque `docker run --privileged` (exigido
# pelo dockerd isolado de dentro do contêiner do job, scripts/runner/
# entrypoint.sh) já exige o equivalente a root no host — um usuário "sem
# privilégio" só no grupo `docker` teria o mesmo poder sob outro nome. Não
# fingimos uma redução de privilégio que não existe.
set -euo pipefail

: "${GH_RUNNER_REGISTRATION_PAT:?defina em /etc/master-jobs-runner/env}"
: "${RUNNER_REPO:?defina RUNNER_REPO como 'dono/repositorio' (ex.: andreustimm/master-jobs)}"
: "${RUNNER_LABELS:?defina RUNNER_LABELS separado por vírgula (ex.: self-hosted,linux,master-jobs)}"
RUNNER_IMAGE="${RUNNER_IMAGE:-master-jobs-runner:latest}"
RUNNER_GROUP_ID="${RUNNER_GROUP_ID:-1}"

log() { echo "[runner-controller] $*"; }

labels_json() {
  # "a,b,c" -> ["a","b","c"], sem depender de jq para montar (só para ler).
  local IFS=,
  local first=1
  printf '['
  for label in $RUNNER_LABELS; do
    [ "$first" -eq 1 ] || printf ','
    printf '"%s"' "$label"
    first=0
  done
  printf ']'
}

request_jit_config() {
  local name="$1"
  curl -fsSL -X POST \
    -H "Authorization: Bearer ${GH_RUNNER_REGISTRATION_PAT}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${RUNNER_REPO}/actions/runners/generate-jitconfig" \
    -d "{\"name\":\"${name}\",\"runner_group_id\":${RUNNER_GROUP_ID},\"labels\":$(labels_json),\"work_folder\":\"_work\"}" \
    | jq -er ".encoded_jit_config"
}

run_one_job() {
  local name
  name="master-jobs-$(date +%s)-$$"
  log "pedindo configuração JIT para ${name}"
  # `|| jit=""` é obrigatório sob `set -e`: sem ele, uma falha de rede na
  # substituição de comando encerraria o laço inteiro em vez de esperar e
  # tentar de novo (revisão L2, minor).
  local jit
  jit="$(request_jit_config "$name")" || jit=""
  if [ -z "$jit" ]; then
    log "configuração JIT vazia (API fora, ou PAT sem 'Administration: write'); aguardando 30s"
    sleep 30
    return
  fi

  log "subindo contêiner descartável ${name} (sem socket Docker do host)"
  # --privileged: exigido pelo dockerd ISOLADO de dentro do contêiner
  # (entrypoint.sh) — não expõe nem monta o daemon do host. `--rm` garante
  # que nada sobrevive ao fim do job, mesmo se o job travar o próprio
  # contêiner: a próxima iteração nasce de imagem limpa de novo.
  docker run --rm --privileged --name "$name" \
    -e "JIT_CONFIG=${jit}" \
    "$RUNNER_IMAGE"
}

main() {
  log "controller iniciado (repositório=${RUNNER_REPO}, labels=${RUNNER_LABELS}, imagem=${RUNNER_IMAGE})"
  while true; do
    run_one_job || log "job terminou com erro; controller continua o laço"
  done
}

main "$@"
