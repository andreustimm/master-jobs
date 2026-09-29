#!/usr/bin/env bash
# Laço do runner efêmero (issue #367, ADR 0030 decisão 5).
#
# `config.sh --ephemeral` registra o runner para EXATAMENTE um job; ao
# terminar, ele se desfaz sozinho (o token de registro é consumido e o
# processo sai). Este laço pede um token de registro novo à API do GitHub,
# registra, roda `run.sh` até ele sair, limpa o diretório de trabalho do job
# (que pode conter checkout de código e artefato) e repete — para que nenhum
# estado sobreviva de um job para o próximo, mesmo que o runner tenha ficado
# de pé por dias.
#
# Executado pelo serviço systemd `master-jobs-runner.service`, instalado por
# provision-vps.sh, com `EnvironmentFile` apontando para
# /etc/master-jobs-runner/env (fora do repositório, nunca commitado — regra
# 16: só o nome da variável aparece aqui, o valor nunca).
set -euo pipefail

: "${GH_RUNNER_REGISTRATION_PAT:?defina em /etc/master-jobs-runner/env}"
: "${RUNNER_REPO_URL:?defina RUNNER_REPO_URL (ex.: https://github.com/andreustimm/master-jobs)}"
: "${RUNNER_LABELS:?defina RUNNER_LABELS (ex.: self-hosted,linux,master-jobs)}"

RUNNER_DIR="$(cd "$(dirname "$0")" && pwd)"
API_REPO="${RUNNER_REPO_URL#https://github.com/}"

log() { echo "[runner-loop] $*"; }

registration_token() {
  # Token de registro do runner: escopo único, expira em 1 hora, nunca
  # impresso — só usado em memória pelo config.sh, na mesma execução.
  curl -fsSL -X POST \
    -H "Authorization: Bearer ${GH_RUNNER_REGISTRATION_PAT}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${API_REPO}/actions/runners/registration-token" \
    | jq -r ".token"
}

cleanup_workspace() {
  # Tudo que um job efêmero pode ter deixado: checkout, node_modules,
  # artefato de build, diretório temporário do runner. `_work` é onde o
  # runner faz o checkout de cada job.
  find "${RUNNER_DIR}/_work" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
}

main() {
  cd "$RUNNER_DIR"
  while true; do
    log "pedindo token de registro efêmero"
    token="$(registration_token)"
    if [ -z "$token" ] || [ "$token" = "null" ]; then
      log "token de registro vazio; a API pode estar fora ou o PAT inválido. Aguardando 30s."
      sleep 30
      continue
    fi

    name="master-jobs-$(date +%s)"
    log "registrando runner efêmero ${name}"
    ./config.sh --unattended --ephemeral \
      --url "$RUNNER_REPO_URL" \
      --token "$token" \
      --name "$name" \
      --labels "$RUNNER_LABELS" \
      --replace

    log "runner pronto; aguardando um job"
    ./run.sh || log "run.sh saiu com erro; continuando o laço"

    log "job concluído; limpando estado antes do próximo registro"
    ./config.sh remove --token "$token" 2>/dev/null || true
    cleanup_workspace
  done
}

main "$@"
