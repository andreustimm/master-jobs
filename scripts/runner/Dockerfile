# Imagem imutável do runner self-hosted efêmero (Fase 2, issue #367, ADR
# 0030). Cada job roda num CONTÊINER descartável criado desta imagem — nunca
# num processo de longa duração no host — para que nenhum estado (nem
# credencial em cache) sobreviva de um job para o próximo (ADR 0030 decisão
# 5; revisão L2 da PR #376, M1).
#
# Build a partir da RAIZ do repositório (o contexto precisa enxergar
# package.json, para ler engines.node/packageManager em vez de repetir a
# versão aqui):
#   docker build -f scripts/runner/Dockerfile -t master-jobs-runner:latest .
#
# O que fica DENTRO da imagem (nunca baixado em tempo de job, por isso o job
# não precisa de sudo nem de rede para dependência de sistema):
#   - Node e pnpm nas versões de package.json;
#   - dependências de sistema e navegadores do Playwright (Chromium, WebKit);
#   - o binário do runner do GitHub, com checksum verificado (M5);
#   - Docker Engine, para um dockerd ISOLADO dentro do próprio contêiner do
#     job (docker-in-docker) — o job NUNCA recebe o socket Docker do host.
#
# Nenhuma credencial de repositório entra na imagem. O `JIT_CONFIG` de cada
# job é passado como variável de ambiente pelo controller (root, fora desta
# imagem) na hora de `docker run`, um valor de uso único gerado pela API do
# GitHub — nunca o PAT de longa duração (revisão L2, C2).
#
# ESTE CONTÊINER NUNCA SOBE COM `--privileged`. `scripts/runner/
# runner-controller.sh` usa `--runtime=sysbox-runc` (instalado por
# `provision-vps.sh`, checksum verificado) para dar ao dockerd interno o que
# ele precisa sem as capacidades amplas de `--privileged` — que, num host de
# verdade, dariam ao job acesso aos dispositivos de bloco do PRÓPRIO HOST
# (montar `/dev/sda`, ler `/etc/master-jobs-runner/env`, o arquivo com o PAT
# que controla até a política de aprovação de fork). Sem sysbox, a
# "isolação" do dockerd interno seria teatro; com ele, o contêiner roda um
# Docker completo por dentro sem escalar poder para fora de si mesmo
# (re-revisão L2 de 29/09/2026, C1). Ver docs/engineering/deploy.md e ADR 0030.
FROM node:24-trixie-slim AS base
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git jq python3 unzip xz-utils util-linux \
    && rm -rf /var/lib/apt/lists/*

# Docker Engine, só para o dockerd ISOLADO de dentro do contêiner do job —
# nunca para montar o socket do host.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && . /etc/os-release \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/build-context
# Só o suficiente para ler engines/packageManager — nenhum outro arquivo do
# repositório entra na imagem, e o `pnpm install` de verdade acontece no
# checkout do próprio job, como em qualquer outro runner.
COPY package.json ./package.json
# Confere que a imagem base serve a MESMA major de engines.node — falha cedo,
# no build, em vez de rodar Node errado em silêncio. A major vem do
# package.json, não de um número repetido aqui: quando o Renovate sobe a tag
# da imagem e o `engines` juntos, esta checagem acompanha sem edição.
RUN node -e "const want = require('./package.json').engines.node.match(/\d+/)[0]; \
  const have = process.versions.node.split('.')[0]; \
  if (have !== want) { \
    console.error('Node ' + process.version + ' não é ' + want + '.x (engines.node) — atualize a tag da imagem base.'); \
    process.exit(1); \
  }" \
    && PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")" \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && echo "pnpm ${PNPM_VERSION} ativado (packageManager de package.json)"

# Dependências de sistema do Chromium/WebKit, sem `|| true`: se a versão do
# Playwright pedir um pacote que a imagem base não tem, o build FALHA aqui —
# nunca em silêncio na hora do job (revisão L2, minor "install-deps sem ||
# true"). `PLAYWRIGHT_VERSION` é um build-arg, não um número solto: quem
# constrói a imagem passa a mesma versão de `playwright` de `package.json`
# (`docker build --build-arg PLAYWRIGHT_VERSION=$(node -p
# "require('./package.json').devDependencies.playwright") ...`) — o padrão
# abaixo só vale enquanto ninguém sobrescrever o build-arg. Caminho fixo, fora
# de qualquer `$HOME`: a instalação acontece como root (antes de `useradd`
# abaixo), e o job depois roda como `runner` — um caminho sob `/opt` evita
# depender de qual usuário instalou. `ci.yml` pula os passos `playwright
# install --with-deps`/`install-deps` quando `runner.environment ==
# 'self-hosted'` (revisão L2, M2): os navegadores já estão aqui.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ARG PLAYWRIGHT_VERSION=1.63.0
RUN npx --yes "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium webkit \
    && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

# GitHub Actions runner — versão e checksum fixos. O checksum abaixo PRECISA
# ser conferido pelo dono na página de release antes do primeiro build real
# (https://github.com/actions/runner/releases/tag/v2.338.0, arquivo
# actions-runner-linux-x64-2.338.0.tar.gz, campo SHA256) — o placeholder
# nunca bate com um download de verdade, e o build FALHA fechado até o dono
# substituí-lo (revisão L2, M5: nunca aceitar tarball sem checksum batendo).
ARG RUNNER_VERSION=2.338.0
ARG RUNNER_ARCH=x64
ARG RUNNER_SHA256=PREENCHER_COM_O_SHA256_PUBLICADO_NA_PAGINA_DE_RELEASE
RUN curl -fsSL -o /tmp/actions-runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz" \
    && echo "${RUNNER_SHA256}  /tmp/actions-runner.tar.gz" | sha256sum -c - \
    && mkdir -p /opt/actions-runner \
    && tar xzf /tmp/actions-runner.tar.gz -C /opt/actions-runner \
    && rm -f /tmp/actions-runner.tar.gz \
    && chown -R root:root /opt/actions-runner \
    && chmod -R a-w /opt/actions-runner \
    && find /opt/actions-runner -type d -exec chmod a+rx {} \; \
    && find /opt/actions-runner -type f -exec chmod a+r {} \; \
    && find /opt/actions-runner -type f -perm -u+x -exec chmod a+rx {} \;

# Usuário não-root que executa o runner e os passos do job. `docker` (grupo
# do dockerd interno, criado pelo pacote `docker-ce`) dá acesso ao daemon
# ISOLADO deste contêiner, nunca ao do host.
RUN useradd --create-home --shell /bin/bash runner \
    && usermod -aG docker runner

# `entrypoint.sh` fica ROOT-OWNED e só leitura para `runner` (M1): mesmo que
# um passo do job seja hostil, ele não reescreve o script que o próximo
# contêiner (que nem existe ainda — é recriado da imagem) vai executar. A
# MESMA garantia vale para `/opt/actions-runner` acima: root:root, sem bit de
# escrita para ninguém (nem para `runner`, nem para o próprio dono fora do
# `root` que constrói a imagem). Como o runner do GitHub grava `.runner`,
# `.credentials` e `_work`/`_diag` DENTRO do próprio diretório de instalação
# — e `runner` precisa de permissão de escrita no diretório para isso —
# `entrypoint.sh` nunca executa a partir de `/opt/actions-runner` diretamente:
# ele copia essa origem imutável para `/run/actions-runner` (camada gravável do próprio contêiner, refeito
# do zero a cada contêiner) e só ali roda `run.sh`. A origem em `/opt` nunca é
# escrita depois do build da imagem.
COPY --chown=root:root --chmod=0555 scripts/runner/entrypoint.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
