#!/usr/bin/env bash
# Controller do runner self-hosted efêmero (issue #367, ADR 0030 decisão 5;
# revisão L2 da PR #376, C2; re-revisão de 29/09/2026, C1/M2/m2).
#
# Roda no HOST (fora de qualquer contêiner de job), como o serviço systemd
# `master-jobs-runner-controller.service` instalado por provision-vps.sh.
# Para cada job:
#   1. pede à API do GitHub uma configuração JIT (uso único, escopo de
#      exatamente um runner efêmero) — NUNCA um token de registro reutilizável
#      nem o PAT em si;
#   2. sobe um CONTÊINER DESCARTÁVEL (`--rm`), com o runtime `sysbox-runc`
#      (NUNCA `--privileged` — ver o porquê abaixo), passando só a config JIT
#      como variável de ambiente daquele contêiner;
#   3. espera o contêiner terminar (um job = um contêiner = uma vida); se o
#      `docker run` falhou (não zero) ou o próprio contêiner sinalizou "nunca
#      peguei um job" (código de saída 75 — `entrypoint.sh` só sai assim
#      quando `run.sh` termina sem o log `_diag/Worker_*.log`, isto é, sem
#      nunca ter executado um job de verdade), desregistra o runner e aplica
#      backoff exponencial antes de tentar de novo. Duração de parede NUNCA
#      decide isso (3ª revisão L2 de 29/09/2026, minor 2): um job curto e
#      legítimo (PR só de documentação, por exemplo) não pode ser tratado
#      como falha só por ser rápido.
#
# O `GH_RUNNER_REGISTRATION_PAT` só existe no ambiente DESTE processo
# (`EnvironmentFile=` do systemd, arquivo root-only) — nunca é repassado ao
# `docker run` do job. O contêiner do job só recebe `JIT_CONFIG`, que expira
# depois de um uso e não serve para registrar outro runner. O PAT também
# nunca aparece no `argv` deste processo (m2, re-revisão): o cabeçalho
# `Authorization` vai para o `curl` via `-H @-` (lido do stdin), não como
# argumento de linha de comando — `ps aux`/`/proc/<pid>/cmdline` de qualquer
# outro processo local não o veem.
#
# Este controller roda como root porque ele precisa de acesso ao Docker do
# host para subir e derrubar o contêiner de cada job. Isso NÃO é o mesmo que
# dar `--privileged` ao contêiner do job: `--privileged`, se usado, daria ao
# contêiner do JOB acesso aos dispositivos de bloco do PRÓPRIO HOST (montar
# `/dev/sda`, ler `/etc/master-jobs-runner/env` — o arquivo com este mesmo
# PAT) — por isso o `docker run` abaixo usa `--runtime=sysbox-runc`
# (instalado por provision-vps.sh, checksum verificado) em vez de
# `--privileged`: o dockerd interno do job funciona de verdade, sem o job
# herdar poder sobre o host (re-revisão L2 de 29/09/2026, C1). Ver
# docs/engineering/deploy.md e ADR 0030 para o porquê completo.
set -euo pipefail

: "${GH_RUNNER_REGISTRATION_PAT:?defina em /etc/master-jobs-runner/env}"
: "${RUNNER_REPO:?defina RUNNER_REPO como 'dono/repositorio' (ex.: andreustimm/master-jobs)}"
: "${RUNNER_LABELS:?defina RUNNER_LABELS separado por vírgula (ex.: self-hosted,linux,master-jobs)}"
RUNNER_IMAGE="${RUNNER_IMAGE:-master-jobs-runner:latest}"
RUNNER_GROUP_ID="${RUNNER_GROUP_ID:-1}"

# M2/minor 2 (re-revisões) — `BACKOFF_SECONDS` cresce em dobro a cada falha
# de verdade (status ≠ 0, ou o sentinel de "nenhum job pego" de
# entrypoint.sh), até o teto, e volta ao piso no primeiro job concluído.
# `NO_JOB_PICKED_UP_EXIT_CODE` precisa bater com o mesmo valor em
# entrypoint.sh (comentado lá também) — os dois lados dessa combinação vivem
# em processos/contêineres diferentes, então não há import para mantê-los
# sincronizados automaticamente.
readonly NO_JOB_PICKED_UP_EXIT_CODE=75
readonly BACKOFF_FLOOR_SECONDS=30
readonly BACKOFF_CEILING_SECONDS=600
BACKOFF_SECONDS=$BACKOFF_FLOOR_SECONDS

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

# m2 (re-revisão) — chama a API do GitHub com o cabeçalho `Authorization`
# fora do `argv`: `-H @-` faz o curl ler a linha do cabeçalho do stdin, em
# vez de recebê-la como argumento de linha de comando (visível em
# `ps`/`/proc`). Sem `-L`/`--location` de propósito: o próprio manual do curl
# avisa que cabeçalho passado por `-H` é reenviado em qualquer redirecionamento,
# inclusive para outro host — a API do GitHub não deveria redirecionar uma
# chamada destas, e não seguir automaticamente elimina esse risco por completo
# em vez de confiar nisso. `$1` é o método HTTP, `$2` o caminho (sem o host),
# `$3` (opcional) o corpo da requisição.
gh_api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    printf 'Authorization: Bearer %s\n' "$GH_RUNNER_REGISTRATION_PAT" \
      | curl -fsS -X "$method" \
          -H @- \
          -H "Accept: application/vnd.github+json" \
          -H "Content-Type: application/json" \
          -d "$body" \
          "https://api.github.com${path}"
  else
    printf 'Authorization: Bearer %s\n' "$GH_RUNNER_REGISTRATION_PAT" \
      | curl -fsS -X "$method" \
          -H @- \
          -H "Accept: application/vnd.github+json" \
          "https://api.github.com${path}"
  fi
}

request_jit_config() {
  local name="$1"
  local body
  body="{\"name\":\"${name}\",\"runner_group_id\":${RUNNER_GROUP_ID},\"labels\":$(labels_json),\"work_folder\":\"_work\"}"
  gh_api POST "/repos/${RUNNER_REPO}/actions/runners/generate-jitconfig" "$body"
}

# M2 (re-revisão) — desregistra um runner que a API criou mas que não chegou
# a pegar um job de verdade (contêiner morreu cedo, `docker run` falhou).
# Melhor esforço: se a API já removeu sozinha (o runner terminou o próprio
# ciclo efêmero) ou a chamada falhar, só registra e segue — nunca trava o
# laço por causa da limpeza.
delete_orphan_runner() {
  local runner_id="$1"
  [ -n "$runner_id" ] || return 0
  log "desregistrando runner órfão ${runner_id} (não chegou a completar um job)"
  gh_api DELETE "/repos/${RUNNER_REPO}/actions/runners/${runner_id}" >/dev/null 2>&1 \
    || log "não consegui desregistrar ${runner_id} (pode já ter sumido sozinho); seguindo"
}

apply_backoff() {
  log "aguardando ${BACKOFF_SECONDS}s antes de tentar de novo"
  sleep "$BACKOFF_SECONDS"
  local next=$((BACKOFF_SECONDS * 2))
  if [ "$next" -gt "$BACKOFF_CEILING_SECONDS" ]; then
    next=$BACKOFF_CEILING_SECONDS
  fi
  BACKOFF_SECONDS=$next
}

reset_backoff() {
  BACKOFF_SECONDS=$BACKOFF_FLOOR_SECONDS
}

run_one_job() {
  local name
  name="master-jobs-$(date +%s)-$$"
  log "pedindo configuração JIT para ${name}"
  # `|| response=""` é obrigatório sob `set -e`: sem ele, uma falha de rede
  # na substituição de comando encerraria o laço inteiro em vez de esperar e
  # tentar de novo.
  local response
  response="$(request_jit_config "$name")" || response=""
  if [ -z "$response" ]; then
    log "configuração JIT vazia (API fora, ou PAT sem 'Administration: write')"
    apply_backoff
    return
  fi

  local runner_id jit
  runner_id="$(printf '%s' "$response" | jq -er '.runner.id')" || runner_id=""
  jit="$(printf '%s' "$response" | jq -er '.encoded_jit_config')" || jit=""
  if [ -z "$jit" ]; then
    log "resposta da API sem encoded_jit_config"
    delete_orphan_runner "$runner_id"
    apply_backoff
    return
  fi

  log "subindo contêiner descartável ${name} (runtime sysbox-runc, sem --privileged, sem socket Docker do host)"
  local status
  # `&& status=0 || status=$?`, não `; status=$?`: sob `set -e`, um comando
  # simples que falha encerra o script ANTES de chegar na linha seguinte —
  # só uma lista `&&`/`||` protege a captura do status de saída.
  docker run --rm --runtime=sysbox-runc --name "$name" \
    -e "JIT_CONFIG=${jit}" \
    "$RUNNER_IMAGE" && status=0 || status=$?

  if [ "$status" -eq 0 ]; then
    log "contêiner ${name} concluiu um job (o resultado do job em si já foi reportado ao GitHub)"
    reset_backoff
    return
  fi

  if [ "$status" -eq "$NO_JOB_PICKED_UP_EXIT_CODE" ]; then
    log "contêiner ${name} terminou sem pegar job nenhum (sentinela ${NO_JOB_PICKED_UP_EXIT_CODE})"
  else
    log "contêiner ${name} terminou com status ${status} (falha do processo do runner)"
  fi
  delete_orphan_runner "$runner_id"
  apply_backoff
}

main() {
  log "controller iniciado (repositório=${RUNNER_REPO}, labels=${RUNNER_LABELS}, imagem=${RUNNER_IMAGE})"
  while true; do
    run_one_job || log "job terminou com erro inesperado; controller continua o laço"
  done
}

main "$@"
