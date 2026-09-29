# syntax=docker/dockerfile:1
#
# Plano B de deploy (Fase 4 da #351, ADR 0030): imagem do dashboard Next.js
# para o Fly.io, região `gru` — publicada manualmente no GHCR, nunca no push
# automático (ver .github/workflows/publicar-imagem-fly.yml). A Vercel
# continua o destino padrão; esta imagem só serve quando o dono decide o
# failover (docs/engineering/deploy.md, "Plano B: Fly.io").

# `node:24-slim` (multi-arch), pinada pelo digest do índice em 2026-09-29 —
# o mesmo padrão de `docker-compose.local.yml` (imagens locais fixadas por
# tag e digest). O índice resolve para a arquitetura certa em cada `docker
# build`; atualizar exige trocar o digest de propósito, não puxar o que a
# tag `24-slim` apontar no dia.
ARG NODE_IMAGE=node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# ---- deps: só o lockfile, para o cache de camada sobreviver a mudança de
# código sem reinstalar o mundo -----------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: nesta camada só existem package.json e o lockfile, então
# o `prepare` do próprio repositório (configura git hooks) não tem
# `scripts/` para achar, e o `postinstall` do Playwright baixaria browsers
# que esta imagem nunca abre. `pnpm build`, na camada seguinte, não depende
# de nenhum dos dois.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- builder: `next build --webpack` produz .next/standalone ---------------
# Nenhum segredo de runtime é necessário aqui: a leitura de DATABASE_URL,
# RESEND_API_KEY etc. acontece só quando o servidor recebe uma requisição, e
# `next.config.ts` já declara os arquivos versionados
# (config/certs/supabase-ca.crt, config/sources.yaml) que o rastreamento de
# arquivos do Next precisa copiar para o pacote — o mesmo mecanismo que já
# funciona no build da Vercel.
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
ENV NEXT_TELEMETRY_DISABLED=1
# `scripts/sw-version.mjs` (o marcador de versão do service worker) lê
# `VERCEL_GIT_COMMIT_SHA` quando presente e, na falta, tenta `git
# rev-parse` — que não existe aqui: `.dockerignore` exclui `.git` de
# propósito (regra 16, contexto de build enxuto). Sem este build-arg, toda
# imagem sairia com o mesmo marcador "sem-revisao", e o PWA nunca detectaria
# uma atualização entre deploys do plano B. O workflow de publicação passa o
# SHA real do commit publicado.
ARG GIT_REVISION=sem-revisao
ENV VERCEL_GIT_COMMIT_SHA=${GIT_REVISION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runner: a menor imagem que roda `node server.js`, sem root ------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# CRITICAL C1 (revisão da #373): sem isto, a varredura recusaria por não se
# reconhecer como produção (`src/core/ingest/guard.ts`). Até a #378, a
# ausência também fazia `isLocalProcess()` tratar o contêiner como a máquina
# do dono; hoje ela exige `JHO_ENV=local` e nega por omissão, então o modo
# aberto e o mailer de terminal já não dependem desta linha — ela continua
# como declaração explícita do ambiente. Declarado aqui E em `fly.toml`
# (defesa em profundidade: qualquer jeito de rodar esta imagem, inclusive
# `docker run` direto fora do Fly, se declara produção).
ENV JHO_ENV=production

# Grupo e usuário dedicados — nunca a conta `node` genérica da imagem base,
# para que um `docker history`/inspeção não confunda este processo com outro
# serviço que reaproveite o mesmo uid por acidente.
RUN groupadd --gid 1101 nextjs \
  && useradd --uid 1101 --gid nextjs --no-create-home --shell /usr/sbin/nologin nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
# Regra 12 (G36) regula só `pnpm dev`/`pnpm start` no laptop do dono; esta é a
# exceção de contêiner documentada em
# docs/engineering/rules/security.md#g36 e docs/engineering/deploy.md: o
# processo do server standalone escuta em todas as interfaces porque o proxy
# do Fly.io fica fora do namespace de rede do container, e este `HOSTNAME`
# nunca é lido fora da imagem — `dev`/`start` continuam presos a 127.0.0.1.
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
