#!/usr/bin/env bash
# Provisionamento idempotente do HOST do runner self-hosted da Fase 2 (issue
# #367, ADR 0030, docs/engineering/deploy.md — seção "Runner self-hosted
# opt-in"). Revisão L2 da PR #376 (C2): o job roda dentro de um CONTÊINER
# descartável (scripts/runner/Dockerfile + entrypoint.sh), nunca diretamente
# no host — este script só prepara o que o CONTROLLER precisa para subir
# esses contêineres, e nunca contém nem recebe nenhuma credencial.
#
# O QUE ESTE SCRIPT FAZ, cada passo checando o estado antes de agir (rodar
# duas vezes não duplica nada):
#   1. pacotes de sistema mínimos (curl, git, jq);
#   2. Docker Engine no HOST — só para o `docker run --rm` de cada job; o job
#      em si nunca recebe o socket deste Docker (docker-in-docker isolado
#      dentro do próprio contêiner, ver entrypoint.sh);
#   3. a imagem imutável do runner (`docker build`), com Node/pnpm na versão
#      de package.json e o binário do runner com checksum verificado —
#      NENHUMA dessas dependências é baixada em tempo de job;
#   4. o modelo de /etc/master-jobs-runner/env (vazio, 600, root:root) — O
#      DONO preenche o PAT manualmente, nunca este script;
#   5. o serviço systemd `master-jobs-runner-controller.service`
#      (scripts/runner/runner-controller.sh), que pede uma configuração JIT
#      de uso único por job e sobe um contêiner descartável — nunca um token
#      de registro reutilizável, nunca o PAT dentro do contêiner do job.
#
# Uso: como root, com o repositório clonado na VPS (Ubuntu 24.04 LTS):
#   sudo bash scripts/runner/provision-vps.sh
# Este script NUNCA é buscado e executado por `curl | bash`: sem o
# repositório clonado, não há como montar a imagem a partir do Dockerfile.
set -euo pipefail

ENV_FILE="/etc/master-jobs-runner/env"
SERVICE_FILE="/etc/systemd/system/master-jobs-runner-controller.service"
RUNNER_IMAGE="master-jobs-runner:latest"
LABELS="self-hosted,linux,master-jobs"
REPO="andreustimm/master-jobs"

log() { echo "[provision-vps] $*"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Rode como root (sudo)." >&2
    exit 1
  fi
}

require_repo_checkout() {
  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "${script_dir}/../.." && pwd)"
  if [ ! -f "${REPO_ROOT}/scripts/runner/Dockerfile" ] || [ ! -f "${REPO_ROOT}/package.json" ]; then
    echo "Rode a partir de um checkout do repositório (precisa de package.json e scripts/runner/Dockerfile)." >&2
    exit 1
  fi
}

apt_packages() {
  log "pacotes de sistema"
  apt-get update -y
  apt-get install -y --no-install-recommends ca-certificates curl gnupg git jq
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

build_runner_image() {
  log "construindo a imagem imutável do runner (${RUNNER_IMAGE})"
  # `jq`, não `node`: o host não precisa de Node instalado — o job roda
  # inteiro dentro do contêiner, que traz o próprio Node (Dockerfile).
  local playwright_version
  playwright_version="$(jq -r '.devDependencies.playwright' "${REPO_ROOT}/package.json" | sed 's/^[\^~]//')"
  if [ -z "$playwright_version" ] || [ "$playwright_version" = "null" ]; then
    echo "Não consegui ler devDependencies.playwright de package.json." >&2
    exit 1
  fi
  docker build \
    -f "${REPO_ROOT}/scripts/runner/Dockerfile" \
    --build-arg "PLAYWRIGHT_VERSION=${playwright_version}" \
    -t "$RUNNER_IMAGE" \
    "$REPO_ROOT"
  log "build concluído. Se RUNNER_SHA256 ainda for o placeholder do Dockerfile, o build FALHOU de propósito — preencha o valor publicado na página de release do runner e rode de novo."
}

write_env_file_template() {
  if [ -f "$ENV_FILE" ]; then
    log "${ENV_FILE} já existe; não sobrescrevendo (pode ter segredo dentro)"
    return
  fi
  log "criando modelo de ${ENV_FILE} — o DONO preenche o valor, nunca este script"
  mkdir -p "$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<EOF
# Preenchido manualmente pelo dono. Nunca commitar este arquivo.
#
# GH_RUNNER_REGISTRATION_PAT: PAT FINE-GRAINED com a permissão de repositório
#   "Administration: write" — é a única permissão que a API de configuração
#   JIT de runner aceita hoje; não existe uma mais estreita para esta
#   capacidade específica. NUNCA use um PAT clássico com escopo "repo": esse
#   escopo dá leitura/escrita de código, issues e mais, muito além do que
#   registrar um runner precisa. O token nunca é gravado em log nem em banco
#   (regra 16) — só o nome da variável aparece versionado.
GH_RUNNER_REGISTRATION_PAT=
RUNNER_REPO=${REPO}
RUNNER_LABELS=${LABELS}
RUNNER_IMAGE=${RUNNER_IMAGE}
EOF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
}

install_controller_service() {
  log "instalando o serviço systemd do controller"
  install -m 0555 -o root -g root "${REPO_ROOT}/scripts/runner/runner-controller.sh" \
    /usr/local/sbin/master-jobs-runner-controller.sh

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Controller do runner efêmero do GitHub Actions (master-jobs, issue #367)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
# Roda como root: docker run --privileged (exigido pelo dockerd isolado de
# dentro do contêiner do job) já é equivalente a root no host — um usuário
# só no grupo docker teria o mesmo poder sob outro nome (ver o comentário no
# topo de runner-controller.sh).
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/sbin/master-jobs-runner-controller.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable master-jobs-runner-controller.service
  log "serviço instalado e habilitado. Inicie com: systemctl start master-jobs-runner-controller"
  log "ele falha e reinicia até ${ENV_FILE} ter o PAT preenchido (Restart=always tenta de novo)."
}

main() {
  require_root
  require_repo_checkout
  apt_packages
  install_docker
  build_runner_image
  write_env_file_template
  install_controller_service
  log "provisionamento do host concluído. Confira docs/engineering/deploy.md — 'Runner self-hosted opt-in' para os próximos passos do dono, inclusive o pré-requisito de aprovação de workflow de fork."
}

main "$@"
