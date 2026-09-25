## Técnico

### Corrigido

- `deep-review`: `build_knowledge.py` registrava `AGENTS.md` duas vezes porque `CLAUDE.md` é symlink para ele, e `build_jobs.py` recusava o `rules.json` com "duplicate source accounting rows" (#328). Agora cada arquivo real conta uma fonte só (caminho resolvido, o mais raso vence). O resumo do `build_jobs.py --level L1` deixou de anunciar o limite de polish, faixa que L1 não gera.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
