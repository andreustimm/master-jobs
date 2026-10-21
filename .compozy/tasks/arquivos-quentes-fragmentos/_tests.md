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

Metade 2 (PR seguinte): a seleção de E2E devolve a mesma resposta com o mapa
fragmentado (`tests/e2e-spec-map.test.ts` sem mudar de expectativa, salvo a
ordem das áreas, que passa a ser por id), id duplicado entre fragmentos reprova,
e fragmento cujo nome difere do `id` reprova.
