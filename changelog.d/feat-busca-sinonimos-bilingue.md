## Técnico

### Adicionado

- Busca de Vagas: dicionário bilíngue de sinônimos pt-BR/en (`config/search-synonyms.yaml`, validado por Zod em `src/core/synonyms.ts`) que expande cada termo solto da consulta em um grupo `OU` no filtro (`queryCondition`, `fieldMatches`, grupo de proximidade, `EXISTS` do vazio e facetas). Frase entre aspas continua literal. Atrás de `SEARCH_SYNONYMS_ENABLED`, desligada por padrão: sem a flag o SQL e a ordem são os de antes. Sem migração, sem mudança no scorer. A linha diz qual sinônimo casou (`matchedSynonyms`). Refs #370 (Fase 0); as fases de vetor e a emenda A7 ao ADR-001 seguem pendentes do dono.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
