#!/bin/bash
# `ignoreCommand` da Vercel: exit 0 PULA o build, exit 1 constrói.
#
# Existe porque o plano Hobby limita os deploys por dia, e em 22/09/2026 o
# limite estourou com merges que só mexiam em documentação, testes e
# workflows — o deploy de produção ficou bloqueado por 24 h. Pula apenas
# quando TODO arquivo alterado está numa lista de exclusão: arquivo novo ou
# desconhecido sempre constrói, porque errar para o lado de construir custa um
# deploy, e errar para o outro publica código velho.
set -u

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  base=$(git rev-parse --verify --quiet HEAD^) || { echo "sem commit anterior: constrói"; exit 1; }
fi

changed=$(git diff --name-only "$base" HEAD) || { echo "diff falhou: constrói"; exit 1; }
[ -n "$changed" ] || { echo "nada mudou: pula"; exit 0; }

while IFS= read -r file; do
  case "$file" in
    CHANGELOG.md|USER_CHANGELOG.*.md) echo "muda o que o app exibe: $file"; exit 1 ;;
    docs/*|.compozy/*|tests/*|.github/*|.claude/*|.codex/*|.opencode/*|.deep-review/*) ;;
    *.md) ;;
    *) echo "muda o site: $file"; exit 1 ;;
  esac
done <<< "$changed"

echo "só documentação, testes ou automação: pula o deploy"
exit 0
