## Técnico

### Alterado

- Mapa de E2E seletivo em fragmentos (#531, metade 2): as 53 áreas de `config/e2e-spec-map.json` (editado por 32 % dos PRs, todos no mesmo array) passam a `config/e2e-spec-map.d/<id>.json`, um arquivo por área com o id no nome; o arquivo-base fica com `crossCutting` e `routeAliases`, e o diretório novo é transversal como ele já era. `loadE2EMap` (`scripts/gates/cli.ts`) junta tudo em ordem de id e recusa arquivo com nome diferente do id, arquivo que não é `.json` e área que ficou no arquivo-base; `validateE2EMap` não muda. O conteúdo de cada área é o mesmo (as 53 áreas montadas dos fragmentos são iguais às do JSON original). Efeito visível só na ordem em que `pnpm gates` lista as áreas, agora por id (`--areas mobile,searches,track-selector`); `selectAreas` reordena pela suíte, então nada muda na execução. A classe `tooling` de `validation-impact.json` cobre o diretório novo. `workflow.md` diz onde a área nova entra.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
