# Plano B de deploy (Fase 4 da #351, ADR 0030): imagem do dashboard Next.js
# para o Fly.io, região `gru` — publicada manualmente no GHCR, nunca no push
# automático (ver .github/workflows/publicar-imagem-fly.yml). A Vercel
# continua o destino padrão; esta imagem só serve quando o dono decide o
# failover (docs/engineering/deploy.md, "Plano B (Fly.io)").
#
# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-slim

# ---- deps: só o lockfile, para o cache de camada sobreviver a mudança de
# código sem reinstalar o mundo -----------------------------------------------
FROM node:${NODE_VERSION} AS deps
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
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runner: a menor imagem que roda `node server.js`, sem root ------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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
