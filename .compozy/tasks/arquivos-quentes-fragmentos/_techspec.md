# Techspec — #531: arquivos quentes em fragmentos

Diagnóstico de 2026-10-12 (60 PRs em `dev`): `en.ts` e `pt-BR.ts` são editados
por 38 % dos PRs no mesmo objeto; `config/e2e-spec-map.json`, por 32 %;
`AREAS` de `tests/e2e/ui/index.mjs`, por 25 %. Cada merge invalida os PRs
abertos que tocam o mesmo trecho. O comentário de 2026-10-13 na issue adiou a
divisão para uma janela sem PR aberta tocando o arquivo e pediu que ela fosse
fatiada. As metades saem em PRs separados: o dicionário (L1), o mapa de E2E (2a,
L2 só pela palavra de segurança nos ids `auth` e `password-reset`) e `AREAS` por
glob (2b).

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

## Metade 2a — mapa de E2E (segunda PR)

O adiamento de 2026-10-13 citava a #537 mudando `scripts/gates/*`; a lista de
arquivos da #537 e da #539 não toca `scripts/gates/` nem `config/e2e-spec-map.json`
(só `config/validation-impact.json`, na #539), então o conflito esperado era
uma linha de padrão.

`config/e2e-spec-map.json` mantém `schemaVersion`, `mapVersion`, `crossCutting`
e `routeAliases`; `areas` passa a `config/e2e-spec-map.d/<id>.json`, um arquivo
por área com o id no nome. `readE2EMapSource` (`scripts/gates/cli.ts`) junta o
base com o diretório, ordena por id e recusa arquivo de nome diferente do id,
arquivo que não é `.json` (oculto como `.DS_Store` é ignorado) e `areas` no base;
`loadE2EMap` = `validateE2EMap(readE2EMapSource(root))`, e `validateE2EMap` não
muda. `config/e2e-spec-map.d/**` entra em `crossCutting` (editar o mapa já
pedia a suíte inteira) e na classe `tooling` de `validation-impact.json`.

**Ordem.** O mapa antigo listava as áreas em ordem de inserção; a seleção
devolve na ordem do mapa, e passa a ser a dos ids. Muda só a lista que
`pnpm gates` mostra e passa a `--areas`; `selectAreas` reordena pela suíte
(`tests/e2e/ui/index.mjs`), então a execução é a mesma. Duas expectativas de
`tests/e2e-spec-map.test.ts` mudam de ordem, e nada mais.

**Custo conhecido.** Os ids `auth` e `password-reset` são palavra de segurança
no caminho (`review_level.py`, `validation-impact.json`): o PR que criou os
fragmentos é L2 por isso, e o PR futuro que editar um desses dois arquivos
também, além de cair na classe `auth-security` (testes inteiros, `pwa-browser`
e `e2e` no plano local, contra `related-tests` para o arquivo de outra área).
Não vale renomear a área só para escapar do rótulo.

## Metade 2b — `AREAS` por glob (terceira PR)

`AREAS` de `tests/e2e/ui/index.mjs` é descoberto por glob, com a ordem de
execução e o `requires` declarados no próprio módulo da área. A ordem da suíte
é "a única que a suíte inteira já provou", então cada módulo carrega um `order`
que preserva a ordem de hoje. Só depois que a 2a mesclar.

## Fora do escopo

`E2E_ROLES` de `tests/e2e/setup.mjs` (23 % dos PRs), que o diagnóstico lista e
as propostas da issue não cobrem; qualquer mudança de chave, texto ou idioma.
