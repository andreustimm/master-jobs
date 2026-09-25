## Técnico

### Corrigido

- O `ignoreCommand` da Vercel (`scripts/vercel-ignore-build.sh`) pulava o
  build quando o diff era vazio — o que só acontece num redeploy manual do
  mesmo commit, feito para aplicar uma variável de ambiente nova. Agora esse
  caso constrói.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
