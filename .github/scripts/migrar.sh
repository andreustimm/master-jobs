#!/usr/bin/env bash
# Um destino explícito, sem fallback para dev/staging nem URLs em logs.
set -euo pipefail

if [ -z "${DATABASE_MIGRATION_URL:-}" ]; then
  echo "::error::SUPABASE_MIGRATION_URL ausente. Migração não executada."
  exit 1
fi

# A identidade do destino é validada antes de qualquer DDL. Nenhuma senha sai.
node --input-type=module -e '
import { assertProductionTarget } from "./scripts/migration/production-target.ts";
assertProductionTarget(process.env.DATABASE_MIGRATION_URL);
'

pnpm jho db migrate
# Verificação pontual com a mesma conexão privilegiada; não vira segredo runtime.
DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm jho db check
