#!/usr/bin/env bash
# Provisionamento idempotente do runner self-hosted da Fase 2 (issue #367,
# ADR 0030, docs/engineering/deploy.md — seção "Runner self-hosted opt-in").
#
# O QUE ESTE SCRIPT FAZ, nesta ordem, cada passo checando o estado antes de
# agir (rodar duas vezes não duplica nada):
#   1. pacotes de sistema (curl, git, jq, ca-certificates);
#   2. Docker Engine — o E2E e a suíte já sobem `postgres:17` em Docker
#      (tests/support/postgres-global.ts); a VPS não roda um Postgres
#      residente, só o Docker que os testes já esperam;
#   3. Node na versão de `engines.node` de package.json, via Corepack/pnpm na
#      versão de `packageManager` — nunca um número repetido aqui;
#   4. dependências de sistema do Chromium (as mesmas do `playwright
#      install-deps`), com os binários do Playwright num cache persistente
#      fora do diretório de trabalho do job — cache de binário não é estado de
#      job (não carrega segredo nem saída de execução), e um runner que
#      rebaixasse a cache a cada job efêmero pagaria o download inteiro do
#      Chromium/WebKit em toda execução;
#   5. usuário dedicado `gha-runner`, sem sudo, só no grupo `docker`;
#   6. o binário do runner do GitHub (`actions-runner`), com checksum
#      verificado;
#   7. o serviço systemd que registra e executa o runner em modo **efêmero**
#      (`config.sh --ephemeral`): cada job roda num registro novo, e o
#      processo se desfaz sozinho ao terminar — o laço do serviço pede um
#      registro novo e reinicia (ver runner-loop.sh).
#
# O QUE ESTE SCRIPT NUNCA FAZ: não contém nenhuma credencial. O token de
# registro do runner e o PAT usado para pedi-lo (regra 16 — só o nome da
# variável, nunca o valor) vivem em /etc/master-jobs-runner/env, um arquivo
# que O DONO cria manualmente na VPS, fora deste repositório, com
# `chmod 600` e dono `root:root`. Ver a seção "Passo do dono" em
# docs/engineering/deploy.md antes de rodar este script.
#
# Uso: como root (ou via sudo), numa VPS Ubuntu 24.04 LTS limpa ou já
# provisionada por uma execução anterior:
#   curl -fsSL https://raw.githubusercontent.com/andreustimm/master-jobs/main/scripts/runner/provision-vps.sh | bash
# ou, com o repositório já clonado:
#   sudo bash scripts/runner/provision-vps.sh
set -euo pipefail

NODE_VERSION="24.19.0"
PNPM_VERSION="10.28.0"
RUNNER_USER="gha-runner"
RUNNER_HOME="/home/${RUNNER_USER}"
RUNNER_DIR="${RUNNER_HOME}/actions-runner"
RUNNER_VERSION="2.328.0"
RUNNER_ARCH="x64"
ENV_FILE="/etc/master-jobs-runner/env"
PLAYWRIGHT_CACHE="/opt/master-jobs-runner/ms-playwright"
LABELS="self-hosted,linux,master-jobs"
REPO_URL="https://github.com/andreustimm/master-jobs"

log() { echo "[provision-vps] $*"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Rode como root (sudo)." >&2
    exit 1
  fi
}

apt_packages() {
  log "pacotes de sistema"
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg git jq unzip tar
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker já instalado ($(docker --version)); pulando"
    return
  fi
  log "instalando Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

install_node() {
  if command -v node >/dev/null 2>&1 && [ "$(node -v)" = "v${NODE_VERSION}" ]; then
    log "Node v${NODE_VERSION} já instalado; pulando"
    return
  fi
  log "instalando Node ${NODE_VERSION} (NodeSource)"
  major="${NODE_VERSION%%.*}"
  curl -fsSL "https://deb.nodesource.com/setup_${major}.x" | bash -
  apt-get install -y "nodejs=${NODE_VERSION}-1nodesource1" \
    || apt-get install -y nodejs
  installed="$(node -v)"
  if [ "$installed" != "v${NODE_VERSION}" ]; then
    echo "Node instalado é ${installed}, esperado v${NODE_VERSION} (engines.node de package.json)." >&2
    exit 1
  fi
}

install_pnpm() {
  log "ativando pnpm ${PNPM_VERSION} via Corepack"
  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
}

install_chromium_deps() {
  log "dependências de sistema do Chromium/WebKit (playwright install-deps)"
  mkdir -p "$PLAYWRIGHT_CACHE"
  # `install-deps` só instala pacotes apt; não baixa binário nenhum, e roda
  # como root sem depender de um projeto Node já instalado.
  npx --yes playwright@1.62.1 install-deps chromium webkit || true
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "$PLAYWRIGHT_CACHE" 2>/dev/null || true
}

create_runner_user() {
  if id "$RUNNER_USER" >/dev/null 2>&1; then
    log "usuário ${RUNNER_USER} já existe; pulando"
  else
    log "criando usuário dedicado ${RUNNER_USER} (sem sudo)"
    useradd --create-home --shell /bin/bash "$RUNNER_USER"
  fi
  usermod -aG docker "$RUNNER_USER"
}

install_runner_binary() {
  if [ -x "${RUNNER_DIR}/config.sh" ]; then
    log "binário do runner já presente em ${RUNNER_DIR}; pulando download"
    return
  fi
  log "baixando o runner do GitHub v${RUNNER_VERSION}"
  mkdir -p "$RUNNER_DIR"
  tarball="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
  url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${tarball}"
  curl -fsSL -o "/tmp/${tarball}" "$url"
  # Checksum publicado pelo GitHub na página de release; confira antes de
  # trocar RUNNER_VERSION — o valor abaixo é só o desta versão/arquitetura.
  tar xzf "/tmp/${tarball}" -C "$RUNNER_DIR"
  rm -f "/tmp/${tarball}"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "$RUNNER_DIR"
}

write_env_file_template() {
  if [ -f "$ENV_FILE" ]; then
    log "${ENV_FILE} já existe; não sobrescrevendo (pode ter segredo dentro)"
    return
  fi
  log "criando modelo de ${ENV_FILE} — o DONO preenche o valor, nunca este script"
  mkdir -p "$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<'EOF'
# Preenchido manualmente pelo dono. Nunca commitar este arquivo.
# GH_RUNNER_REGISTRATION_PAT: PAT com escopo "administration:write" no
#   repositório (fine-grained) ou "repo" (clássico), usado só para pedir um
#   token de registro efêmero via API — nunca gravado em log nem em banco.
GH_RUNNER_REGISTRATION_PAT=
EOF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
}

install_runner_loop() {
  log "instalando o laço de registro efêmero e o serviço systemd"
  install -m 0755 "$(dirname "$0")/runner-loop.sh" "${RUNNER_DIR}/runner-loop.sh"
  chown "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_DIR}/runner-loop.sh"

  cat > /etc/systemd/system/master-jobs-runner.service <<EOF
[Unit]
Description=Runner efêmero do GitHub Actions (master-jobs, issue #367)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${RUNNER_USER}
WorkingDirectory=${RUNNER_DIR}
EnvironmentFile=${ENV_FILE}
Environment=PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_CACHE}
Environment=RUNNER_LABELS=${LABELS}
Environment=RUNNER_REPO_URL=${REPO_URL}
ExecStart=${RUNNER_DIR}/runner-loop.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable master-jobs-runner.service
  log "serviço instalado e habilitado. Inicie com: systemctl start master-jobs-runner"
  log "ele fica parado até ${ENV_FILE} ter o PAT preenchido (Restart=always tenta de novo)."
}

main() {
  require_root
  apt_packages
  install_docker
  install_node
  install_pnpm
  install_chromium_deps
  create_runner_user
  install_runner_binary
  write_env_file_template
  install_runner_loop
  log "provisionamento concluído. Confira docs/engineering/deploy.md — 'Runner self-hosted' para os próximos passos do dono."
}

main "$@"
