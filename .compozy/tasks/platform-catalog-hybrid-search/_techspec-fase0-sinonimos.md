# Techspec: Fase 0 — sinônimos bilíngues na busca (issue #370)

Refs #370. Tamanho M. Implementa a Fase 0 da recomendação de 02/10/2026 da
issue: um dicionário bilíngue pt-BR/en, determinístico, que expande cada termo
solto da consulta em um grupo `OU` de equivalentes. Fica atrás de
`SEARCH_SYNONYMS_ENABLED` (desligada por padrão), sem migração e sem tocar o
scorer. As fases de vetor (EmbeddingPort, pgvector, indexação, NIM) ficam fora e
dependem de D1b em [`_decisao-embedding-sem-openai.md`](_decisao-embedding-sem-openai.md).

Contrato de testes: UT-022 a UT-024, IT-017 e E2E-007 em [`_tests.md`](_tests.md).
Emenda proposta (pendente do dono): PRD A7 e ADR-001.

## O que muda

| Peça | Arquivo | Papel |
|---|---|---|
| Lista curada | `config/search-synonyms.yaml` | Grupos de termos equivalentes, editados à mão. |
| Validação | `src/core/synonyms.ts` | Puro. Zod valida a forma; cada entrada passa por `validateTerm`; termo repetido derruba a carga. Indexa por `termKey`. |
| Composição | `src/core/synonyms-load.ts` | Lê a flag e o arquivo (síncrono, em cache). Desligada: lista vazia sem tocar o disco. Arquivo ilegível com a flag ligada: lista vazia e defeito no log. |
| Expansão | `src/core/search.ts` | `expandTerms` e `synonymMapOf`: cada termo vira `{ term, alternatives }`; frase entre aspas não entra. `explainMatch` ganha o sinal `synonym`. |
| Filtro | `src/core/db/repo.ts` | `QueryPart` passa a carregar alternativas; `queryCondition` junta com `or` dentro do grupo e `and` entre grupos; `fieldMatches`, o grupo de proximidade, o `EXISTS` do vazio e as facetas usam as mesmas alternativas. `matchedSynonyms` na linha. |
| Estado da URL | `app/filter-state.ts` | `readFilters` expande com a lista da composição; `toBoardFilters` repassa `synonyms`. A URL continua levando só o `q` cru. |
| Tela | `app/joblist.tsx`, i18n | Nota "também buscou: engineer" por linha, com o termo marcado `data-user-content`. |

## Decisões

1. **Termo inteiro, não palavra solta.** Texto fora de aspas é UM termo
   (`engenheiro de dados` é um termo). Só o termo digitado inteiro expande;
   combinações ficam como entradas da lista (`engenheiro de dados` ↔
   `data engineer`). Expandir palavra a palavra mudaria o significado do termo.
2. **Chave do filtro, com acento.** A lista usa `termKey` (sem caixa, espaço nem
   hífen) e distingue acento como o filtro: `sênior` e `senior` são entradas
   distintas e `lider tecnico` precisa estar listado ao lado de `líder técnico`.
3. **O SQL com a flag desligada é o de antes.** Um grupo de uma alternativa gera
   exatamente a condição anterior; o pré-filtro trigrama `like` vale por
   alternativa e cada padrão segue como parâmetro ligado.
4. **Só amplia.** A condição é `termo OU sinônimos`. Frase entre aspas é literal.
   Vaga inelegível só entra no conjunto; o bloqueador continua no score.
5. **Falha aberta no runtime, fechada no CI.** Lista inválida com a flag ligada
   devolve a busca de antes e registra o defeito; o teste que carrega
   `config/search-synonyms.yaml` reprova a lista inválida antes do merge.
6. **Sem CLI.** `jho jobs list` não aceita termo de busca; o caminho de termo
   único (`BoardFilters.term`) expande pelo mesmo mapa quando o chamador o passa.

## Fora de escopo (pendente do dono)

- Ligar a flag em preview ou produção (env da Vercel).
- Curadoria da lista inicial (pares amplos como `dados`/`data`, `gerente`/`manager`).
- D1b e as fases de vetor 1–3; D4 (`vector` no Supabase); NIM.
