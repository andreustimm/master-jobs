# Contrato de testes — #531

Metade 1, dicionário (`tests/i18n-fragments.test.ts`, sem rede nem banco):

- Todo `<área>.pt-BR.ts` tem o par `<área>.en.ts`, e as áreas dos dois lados
  são as mesmas.
- Por área, o inglês tem exatamente as seções e as chaves do português; a falha
  nomeia a área e a seção.
- Uma seção é definida por um fragmento só, em cada idioma; a falha nomeia os
  dois fragmentos.
- Cada fragmento exporta uma constante só.
- A junção entrega o fragmento inteiro: `ptBR[seção]` e `en[seção]` são o objeto
  do fragmento. Fragmento esquecido na junção reprova com o nome dele.
- Não sobra seção na junção que nenhum fragmento tenha.

Já cobertos por `tests/i18n.test.ts`, sem mudança: o dicionário inteiro cobre as
mesmas chaves nos dois idiomas, nenhuma string vazia, a maioria é tradução e não
cópia.

Prova de equivalência (manual, no PR): o dicionário despejado antes e depois
(`ptBR` e `en`, chaves ordenadas) é idêntico byte a byte — 176.269 bytes, 65
seções por idioma. Sonda negativa: tirar `eyebrow` de `cockpit.en.ts` quebra
`tsc` em `cockpit.en.ts(11,3): TS2741`; fragmento extra com seção repetida,
chave a mais e fora da junção reprova três verificações do teste novo.

Metade 2a, mapa de E2E (`tests/e2e-spec-map.test.ts`, com diretórios
temporários, sem rede nem banco):

- A seleção devolve as mesmas áreas com o mapa fragmentado; muda só a ordem,
  que passa a ser por id (duas expectativas: as áreas de `app/searches/page.tsx`
  e o `--areas` que `pnpm gates` monta para ela).
- O loader junta um arquivo por área em ordem de id, e o id que é prefixo de
  outro vem antes (`jobs` antes de `jobs-new`).
- Arquivo oculto (`.DS_Store`) é ignorado; arquivo com nome diferente do id,
  arquivo que não é `.json` e `areas` no arquivo-base reprovam, cada um com a
  mensagem que nomeia o arquivo; diretório sem nenhuma área falha fechado
  (`areas ausentes`).
- `tests/recruiter-directory.test.ts` lê o mapa por `loadE2EMap` em vez do JSON.

Prova de equivalência (manual, no PR): as 53 áreas montadas dos fragmentos são
iguais às do JSON original (`deepStrictEqual` sobre o conteúdo, ordenadas por
id), `routeAliases`, versões e `crossCutting` (original mais
`config/e2e-spec-map.d/**`) idem.

Metade 2b, `AREAS` por glob: `selectAreas` devolve a mesma ordem e os mesmos
fechos de `requires` que hoje para qualquer lista, e `tests/e2e-spec-map.test.ts`
continua provando que o mapa conhece exatamente as áreas do executor.
