## Técnico

### Alterado

- Dicionário de interface em fragmentos por área (#531, metade 1): `pt-BR.ts` e `en.ts` (≈ 3,6 mil linhas, editados por 38 % dos PRs) passam a só juntar 16 pares `src/core/i18n/<área>.pt-BR.ts` / `<área>.en.ts`. Nenhuma chave nem texto muda — o dicionário despejado antes e depois é idêntico byte a byte —, e `ptBR`, `en` e `Dictionary` seguem exportados dos mesmos arquivos, então nenhum importador muda. O fragmento em inglês é tipado contra o português do mesmo nome (`Translated<…>` em `shape.ts`), e `tests/i18n-fragments.test.ts` reprova par faltando, chave que difere, seção definida por dois fragmentos e fragmento que a junção não entrega. Dois PRs só colidem se mexerem na mesma área; o fragmento mais mexido (`jobs`) aparece em ≈ 23 % dos PRs que tocam o dicionário, contra 100 % antes. G29 diz onde a chave nova entra.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
