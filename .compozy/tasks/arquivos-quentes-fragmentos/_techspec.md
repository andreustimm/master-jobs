# Techspec — #531: arquivos quentes em fragmentos

Diagnóstico de 2026-10-12 (60 PRs em `dev`): `en.ts` e `pt-BR.ts` são editados
por 38 % dos PRs no mesmo objeto; `config/e2e-spec-map.json`, por 32 %;
`AREAS` de `tests/e2e/ui/index.mjs`, por 25 %. Cada merge invalida os PRs
abertos que tocam o mesmo trecho. O comentário de 2026-10-13 na issue adiou a
divisão para uma janela sem PR aberta tocando o arquivo e pediu que ela fosse
fatiada. As duas metades saem em PRs separados (L1).

## Metade 1 — dicionário de interface (esta PR)

Janela aberta: as PRs abertas (#537, #538, #539) são de CI e não tocam
`src/core/i18n/`. Por isso a divisão sai numa PR só, em vez de uma área por PR:
fatiar mantém a janela aberta por semanas e cada fatia reedita o arquivo quente.
A movimentação é mecânica e provada por igualdade do dicionário inteiro, o que
um PR de ≈ 400 linhas por área não provaria melhor.

**Desenho.** O arquivo único vira 16 pares `src/core/i18n/<área>.pt-BR.ts` e
`<área>.en.ts`. Cada fragmento exporta um objeto de **seções** (`jobs`,
`filters`…), não de chaves soltas, para o tipo `Dictionary` continuar sendo
seção → chave → texto. `pt-BR.ts` e `en.ts` mantêm as exportações de hoje
(`ptBR`, `en`, `Dictionary`) e só espalham os fragmentos; nenhum importador
muda.

**Tipos.** `shape.ts` define `Translated<Source>`. `Dictionary` é
`Translated<typeof ptBR>`; cada `<área>.en.ts` é `Translated<typeof
<área>PtBR>`, então a chave que falta ou sobra é erro de compilação no arquivo
da área. Seção ausente de uma junção é erro em `en.ts` (`en: Dictionary`).

**Áreas** (a fronteira segue quem edita junto, medido nos 39 PRs mesclados que
tocaram o dicionário): `account`, `admin`, `candidate` (inclui `copy`),
`cockpit`, `email`, `filters` (inclui `hints`, `presets`, `jobCountries`),
`job-detail`, `jobs`, `operations`, `pipeline`, `public-profile`, `recruiter`,
`recruiter-access`, `scoring`, `searches`, `shell`. O nome evita palavra de
segurança (`auth`, `oauth`, `session`, `password`, `secret`, `security`…), que
eleva qualquer caminho a L2 em `review_level.py` e a classe `auth-security` em
`validation-impact.json` (suíte inteira e `pwa-browser` no plano local): um
fragmento `auth` custaria isso a todo PR que editasse um rótulo de login, e
mover o texto não muda o risco dele. Por isso login e cadastro moram em `account`.

**Custo conhecido.** Área nova é um par de arquivos e duas linhas (import e
espalhamento) em cada junção; essas linhas são o único ponto onde dois PRs de
área nova ainda colidem. Seção com o mesmo nome em dois fragmentos sobrescreve
calada no espalhamento: `tests/i18n-fragments.test.ts` reprova.

## Metade 2 — mapa de E2E (PR seguinte)

`config/e2e-spec-map.json` mantém `schemaVersion`, `mapVersion`, `crossCutting`
e `routeAliases`; `areas` passa a `config/e2e-spec-map.d/<id>.json`, juntado por
`loadE2EMap` e ordenado por id. `validateE2EMap` não muda. `AREAS` de
`tests/e2e/ui/index.mjs` é descoberto por glob, com a ordem de execução e o
`requires` declarados no próprio módulo da área. Fica para depois de decidir o
que as PRs de CI (#537) fazem com `scripts/gates/`.

## Fora do escopo

`E2E_ROLES` de `tests/e2e/setup.mjs` (23 % dos PRs), que o diagnóstico lista e
as propostas da issue não cobrem; qualquer mudança de chave, texto ou idioma.
