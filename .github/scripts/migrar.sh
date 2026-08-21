#!/usr/bin/env bash
#
# Aplica as migrações e confere o resultado.
#
# Um arquivo, chamado pelos três passos de `migrate.yml`, porque a alternativa é
# o mesmo bloco copiado três vezes — e bloco copiado é o que diverge quando
# alguém corrige um só.
#
# O ambiente (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) vem do passo que chama:
# assim cada branch enxerga apenas o segredo do seu banco.
set -euo pipefail

if [ -z "${TURSO_DATABASE_URL:-}" ]; then
  echo "::error::TURSO_DATABASE_URL vazia. O passo não definiu o banco."
  exit 1
fi

if [ -z "${TURSO_AUTH_TOKEN:-}" ]; then
  echo "::error::Segredo do token ausente para a branch ${GITHUB_REF_NAME:-?}."
  echo "Defina TURSO_TOKEN_PROD, TURSO_TOKEN_STAGING e TURSO_TOKEN_DEV nos"
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
