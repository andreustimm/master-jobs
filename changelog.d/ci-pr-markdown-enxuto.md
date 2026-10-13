## Técnico

### Alterado

- CI: PR só de documentação não roda `pwa-browser` nem `banco-nas-majors` (#528). Job novo `escopo` (`scripts/github/pr-scope.ts`, lista de permissão de caminhos Markdown; `CHANGELOG.md`, `USER_CHANGELOG*` e `docs/prompts/` ficam de fora porque o build ou o runtime os leem) decide o recorte; `qualidade` e `schema-e-migracao` aceitam esses dois pulados só com `escopo` verde dizendo `completo=false`. `build` não é recortado: o Tailwind varre os `.md` do repositório. Push, chamada da promoção e dispatch rodam sempre a suíte completa. G57 atualizada. Economia estimada: ≈ 18 runner-min por PR só de documentação (17 % dos PRs no diagnóstico de 2026-10-12).

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
