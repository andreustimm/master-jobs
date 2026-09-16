#!/usr/bin/env bash
#
# Aplica as migrações e confere o resultado.
#
# Chamado pelo passo de produção de `migrate.yml`.
# O ambiente (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) vem desse passo.
set -euo pipefail

if [ -z "${TURSO_DATABASE_URL:-}" ]; then
  echo "::error::TURSO_DATABASE_URL vazia. O passo não definiu o banco."
  exit 1
fi

if [ -z "${TURSO_AUTH_TOKEN:-}" ]; then
  echo "::error::Segredo do token ausente para a branch ${GITHUB_REF_NAME:-?}."
  echo "Defina TURSO_TOKEN_PROD nos"
  echo "segredos do repositório. Sem isto a migração não roda — e o deploy da"
  echo "Vercel acontece de qualquer jeito, contra um banco desatualizado."
  exit 1
fi

# O host aparece no log; o token nunca. Serve para conferir, ao ler a execução,
# que a branch mirou o banco que devia.
echo "Migrando ${TURSO_DATABASE_URL%%\?*}"

pnpm jho db migrate

# Conferir depois de aplicar. Uma migração que aplica e deixa o banco
# inconsistente é pior que uma que falha, porque ninguém fica sabendo.
pnpm jho db check
