#!/usr/bin/env bash
# Um destino explícito, sem fallback para dev/staging nem URLs em logs.
set -euo pipefail

if [ -z "${DATABASE_MIGRATION_URL:-}" ]; then
  echo "::error::DATABASE_MIGRATION_URL ausente. Migração não executada."
  exit 1
fi

# A identidade do destino é validada antes de qualquer DDL, e o host direto
# (só IPv6, inalcançável do runner) vira o pooler de sessão com a mesma senha.
# Nenhuma senha sai: a URL derivada é mascarada antes de qualquer uso.
DATABASE_MIGRATION_URL=$(node --input-type=module -e '
import { reachableMigrationTarget } from "./scripts/migration/production-target.ts";
process.stdout.write(reachableMigrationTarget(process.env.DATABASE_MIGRATION_URL));
')
echo "::add-mask::${DATABASE_MIGRATION_URL}"
export DATABASE_MIGRATION_URL

pnpm jho db migrate
# Verificação pontual com a mesma conexão privilegiada; não vira segredo runtime.
DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm jho db check
