# Contrato de testes — `perfil-publico-opt-in`

Parte A (#327). Presença e ausência são predicados diferentes e têm linhas
separadas. Só entra em "Rodado" o que uma execução desta sessão confirmou.

| # | Caso | Onde | Por que importa |
|---|---|---|---|
| T1 | Formulário válido vira colunas: controlados reconhecidos, livres aparados, vazio → `null`, opt-in só com `on` | `tests/candidate-public-facts.test.ts` | contrato de entrada |
| T2 | Valor controlado fora da lista é recusado (`invalidChoice`) em cada um dos quatro campos e em modelo de trabalho | `tests/candidate-public-facts.test.ts` | requisição forjada não grava valor que nenhum ramo reconhece |
| T3 | Área/idiomas acima do teto são recusados (não truncados) | `tests/candidate-public-facts.test.ts` | truncar grava o que a pessoa não escreveu |
| T4 | Área/idiomas com e-mail ou telefone são recusados (`*Contact`) | `tests/candidate-public-facts.test.ts` | regra 4 do PRD, G21 |
| T5 | Área/idiomas com pretensão salarial são recusados (`*Pay`) | `tests/candidate-public-facts.test.ts` | G21: piso nunca sai |
| T6 | Saída: opt-in `false` → fato `null`/vazio mesmo com valor gravado, para cada um dos sete | `tests/candidate-public-facts.test.ts` | desligado por padrão |
| T7 | Saída: opt-in `true` com valor → fato sai; sem valor → `null` | `tests/candidate-public-facts.test.ts` | ligado aparece |
| T8 | Saída: valor controlado desconhecido gravado por outro caminho não sai; modelo de trabalho deduplicado, em ordem canônica | `tests/candidate-public-facts.test.ts` | a lista de permissão confere o VALOR |
| T9 | Saída: texto livre com contato (inclusive o e-mail cadastrado) ou pretensão gravado por outro caminho sai `null` | `tests/candidate-public-facts.test.ts` | segunda camada, independente da gravação |
| T10 | `containsPay()` pega rótulo de piso e palavra de remuneração perto de valor; não pega "Inglês C1" nem "Engenharia de dados" | `tests/candidate-public-facts.test.ts` | limite declarado, sem falso positivo óbvio |
| T11 | Candidato novo nasce com os sete opt-ins `false` e os valores nulos (banco real) | `tests/public-profile.test.ts` | default da migração |
| T12 | DTO: conjunto exato de chaves inclui `facts` e as sete chaves internas, nada mais | `tests/public-profile.test.ts` | G21: campo novo é explícito |
| T13 | DTO: valores gravados com opt-in desligado não aparecem nem serializados | `tests/public-profile.test.ts` | desligado → ausente |
| T14 | DTO: com opt-in ligado, os sete saem | `tests/public-profile.test.ts` | ligado → presente |
| T15 | Pretensão salarial nunca: nenhuma chave do DTO (em qualquer nível) nomeia salário/piso/remuneração, e texto de pretensão gravado direto no banco com opt-in ligado não sai serializado | `tests/public-profile.test.ts` | aceite explícito da issue |
| T16 | Perfil não público com todos os opt-ins ligados continua `null` (404) | `tests/public-profile.test.ts` | G22 |
| T17 | `setPublicFactsAction` grava só no candidato da sessão; sem sessão, 403 antes de gravar; recusa volta como código | `tests/candidate-public-facts-action.test.ts` | regra 15 |
| T18 | Varredura de actions guardadas com sessão inválida e id forjado cobre a action nova | `tests/entry-denial.test.ts` (existente, descoberta automática) | G39/G40 |
| T19 | Migração nova tem veredito `[]` (aditiva) | `tests/migration-review.test.ts` (existente) | promoção automática |
| T20 | `db:generate` não gera mais nada depois da migração | `pnpm db:generate` | schema e DDL iguais |
| T21 | E2E: com opt-in ligado, faixa de fatos mostra modelo/nível/disponibilidade e "Em resumo" mostra área/idiomas/prazo/aceita mudar | `tests/e2e/public-cv-format.mjs` (`checkPublicFacts`) | ligado aparece no HTML |
| T22 | E2E: outro candidato com os mesmos valores gravados e opt-ins desligados não tem nenhum deles, nem os rótulos, no HTML | `tests/e2e/public-cv-format.mjs` (`checkPublicFacts`) | desligado → ausente do HTML |
| T23 | E2E: 375px sem rolagem horizontal com a faixa e o resumo cheios | `checkPublicFacts` + `OVERFLOW_SWEEP` | regra 11 |
| T24 | E2E: ≥1024px, a lateral (resumo + skills) fica ao lado da coluna principal | `checkPublicProfileLayout` | layout de #326 preservado |
| T25 | E2E: área e idiomas acentuados sobrevivem à varredura de inglês sem sessão; rótulos controlados saem em inglês | `ENGLISH_ANONYMOUS_SWEEP` | G30 |
| T26 | E2E: em `/candidate`, marcar um fato e salvar persiste após reload; o estado é devolvido ao original | `tests/e2e/ui/public-facts.mjs` | edição real, não só banco |
| T27 | axe sem violação séria em `/p/[slug]` e `/candidate` com o cartão novo | `pnpm test:e2e --areas a11y` | acessibilidade |

## Rodado (28/09, nesta sessão)

- **T1–T10:** `vitest run tests/candidate-public-facts.test.ts` — **16/16**.
- **T11–T16:** `vitest run tests/public-profile.test.ts` — reprovou 5 antes da
  implementação (chave `facts` ausente), **25/25** depois.
- **T17:** `vitest run tests/candidate-public-facts-action.test.ts` — **3/3**.
- **T18, T19** e guardas estruturais: `entry-denial`, `migration-review`,
  `postgres-schema`, `cov-db-schema`, `fk-delete-intent`,
  `production-selection`, `e2e-spec-map`, `architecture`, `i18n`, `design`,
  `e2e-route-coverage` — verdes na rodada de 17 arquivos (**383/383**).
  `postgres-schema` reprovou a primeira versão (opt-in `NOT NULL`): o contrato
  da importação exige coluna posterior ao snapshot anulável; a migração foi
  regenerada com opt-in anulável e nulo tratado como desligado (teste em T6).
- **T20:** `pnpm db:generate` depois da migração — "No schema changes".
- `vitest related` sobre o diff: **2358 aprovados, 1 reprovado** (IT-126 em
  `searches-access.test.ts`, igualdade exata das chaves do DTO sem `facts`);
  atualizado com a ampliação explícita e reexecutado: **8/8**.
- **T21–T27:** `node tests/e2e/run-isolated.mjs --areas
  public-cv-format,public-facts,public-profile,visibility,mobile,i18n,a11y` —
  **58/58** verificações e **14/14** páginas sem violação axe. A área
  `public-facts` sozinha (`--areas public-facts`): **13/13**.
- `pnpm typecheck`: limpo.
