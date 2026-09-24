#!/usr/bin/env bash
# Um destino explícito, sem fallback para dev/staging nem URLs em logs.
set -euo pipefail

# Lista de permissão: modo ausente ou desconhecido não migra nada.
# `aditiva` é o disparo automático (push em main); `revisada`, o manual.
case "${MIGRATION_MODE:-}" in
  aditiva) flags=(--additive-only) ;;
  revisada) flags=() ;;
  *)
    echo "::error::MIGRATION_MODE deve ser 'aditiva' ou 'revisada'. Migração não executada."
    exit 1
    ;;
esac

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

# `${flags[@]+...}`: array vazio sob `set -u` estoura no bash 3 do macOS.
if ! pnpm jho db migrate ${flags[@]+"${flags[@]}"}; then
  if [ "$MIGRATION_MODE" = aditiva ]; then
    echo "::error::Migração automática parada. Se o motivo acima é revisão humana, siga docs/engineering/deploy.md (\"Migração que não é aditiva\") e dispare migrate.yml à mão."
  fi
  exit 1
fi
# Verificação pontual com a mesma conexão privilegiada; não vira segredo runtime.
DATABASE_URL="$DATABASE_MIGRATION_URL" pnpm jho db check
