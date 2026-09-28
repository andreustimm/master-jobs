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

## Revisão L2 da #362 (FIX_BEFORE_SHIP)

| # | Caso | Onde |
|---|---|---|
| R1 | MAJOR: "Piso 20k", "Expectativa: 20k", "Target: USD 180k", "Min 150k", "Remote only, $150/h", "Rate 90/h", "Pay 20k", "USD 15,000/mês", "Engenharia de dados — 20k USD/mês" recusados na entrada (`*Pay`) e esvaziados na saída, nos dois campos | `tests/candidate-public-facts.test.ts` |
| R2 | MINOR 2: `containsPay` e os detectores dos campos curtos em 80 mil quebras + "x" abaixo de 300 ms; saída descarta texto acima do teto | `tests/candidate-public-facts.test.ts` |
| R3 | MINOR 3: e-mail cadastrado fora do padrão genérico recusado na entrada — puro (com `known`) e pela action com banco (do candidato e da conta) | `tests/candidate-public-facts.test.ts`, `tests/candidate-public-facts-action.test.ts` |
| R4 | MINOR 4: telefone sem marca recusado (`*Contact`) e esvaziado; intervalo de anos aceito | `tests/candidate-public-facts.test.ts` |
| R5 | MINOR 5: restauração da área E2E `public-facts` em `try/finally` | `tests/e2e/ui/public-facts.mjs` |

Os 8 testes novos do arquivo puro reprovaram antes da correção (a
linearidade levou 3,7 s); depois, verdes — números na seção abaixo.

Rodado após a correção (28/09): `pnpm typecheck` limpo; facts/action/
public-profile/public-cv **83/83**; `vitest related` do delta **2349
aprovados, 0 reprovados** (9 pulados); E2E isolado `--areas
public-facts,public-profile,public-cv-format` **34/34**.

## Re-revisão L2 da #362 (SHIP com três Minor)

| # | Caso | Onde |
|---|---|---|
| R6 | Minor 1: "Dados\nRate: 150", "IA, rate: 150", "Dados · daily rate 150", "Rate 90" recusados (`*Pay`) e esvaziados | `tests/candidate-public-facts.test.ts` |
| R7 | Minor 2: "90/hr", "90/hrs", "90/yr", "150/mo", "150 por hora", "150 per hour", "90 an hour", "USD15000", "EUR15000", "BRL30000", "Piso 30 000", "30'000", "90 dollars" recusados e esvaziados; "30 mil reais", "15000 euros", "R$ 30 mil", "Piso 2k USD" também | `tests/candidate-public-facts.test.ts` |
| R8 | Minor 3: "Segurança da informação (ISO 27001)", "Qualidade ISO 9001", "IA (ISO/IEC 42001)", "Automação industrial IEC 61131", "Streaming 4K", "Reais problemas de dados", "Projetos reais de IA", "Fintech / euros e câmbio", "Engenharia de dados; 10 mil TPS" aceitos e publicados; "11 91234 - 5678" recusado com `areaContact`; "Dados, 2015 - 2020" aceito | `tests/candidate-public-facts.test.ts` |

Contra a versão anterior (HEAD `38b81b5`, rodada à parte em rascunho), os 27
casos de R6–R8 davam o resultado errado: os 17 de valor eram aceitos, as 9
áreas legítimas recusadas com `areaPay`, e o telefone com `areaPay`. Depois:
`candidate-public-facts` **30/30**.

## Passada final L2 da #362 (FIX_BEFORE_SHIP, fechar por segurança)

| # | Caso | Onde |
|---|---|---|
| R9 | MAJOR: "PJ 30 mil", "CLT 15 mil + benefícios", "Dados — 30 mil/mês", "30 mil por mês", "30 mil mensais", "30mil", "15 mil", "Dados 20 mil líquido", "15 thousand", "1 million", "12,5k", "7.5k", "Dados — 12,5k/mês", "1.5k/h", "9k/mês", "Pay 4k", "4.5K" recusados e esvaziados; "Streaming 4K" e "Vídeo 8K e HDR" aceitos; "10 mil TPS" recusado (falso positivo aceito, substitui a expectativa anterior) | `tests/candidate-public-facts.test.ts` |
| R10 | MINOR 2: "Marketing (target: B2B)", "Growth (conversion rate: 3%)", "Vídeo: frame rate 60 fps" aceitos; "Target: USD 180k", "Target 150", "IA, rate: 150", "Rate 90", "daily rate: $500" recusados; "Equipes de 1 200 pessoas" recusado (falso positivo aceito) | `tests/candidate-public-facts.test.ts` |
| R11 | MINOR 3: "RFC 15000", "NBR 20000/mês", "iso 30000", "Dados (ISO 150000)" recusados; "ISO 27001", "ISO/IEC 42001", "ISO 9001:2015", "RFC 9110" aceitos | `tests/candidate-public-facts.test.ts` |

Contra a versão anterior (`b7b5b81`, rodada à parte em rascunho), 24 de 25
casos de R9–R11 davam o resultado errado. Depois: `candidate-public-facts`
**37/37**.

## Regra estrutural (passada L2 de `546b302`)

A régua de formatos foi substituída por `shortFieldProblem()` (contato →
rótulo de pretensão → número solto). R1–R11 foram consolidados em
`describe("regra estrutural dos campos curtos (#362)")`:

| # | Caso |
|---|---|
| R12 | Os 63 contraexemplos de piso de todas as rodadas (9 originais, rate em qualquer posição, os 13 formatos, mil/k, norma com valor, e os 10 desta rodada: "8K USD", "4K/mês", "150 hourly", "150 mensais", "diária 150", "600 a diária", "150 p/h", "150 per diem", "15kUSD", "Piso ISO 15000") recusados na entrada, nos dois campos, e esvaziados na saída |
| R13 | Aceitos: "Dados & IA", "Inglês C1", "Espanhol B2", "Java/Go", "Web3", "K8s", "S3 e IPv6", "Java21", "ISO 27001", "ISO 27001:2022", "ISO/IEC 42001", "IEC 61131", "RFC 9110", "Segurança da informação (ISO 27001)", "Marketing (target: B2B)", "Growth (conversion rate)", "Projetos reais de IA", "euros e câmbio" |
| R14 | Número sem rótulo → `areaNumber`/`languagesNumber`; "Pretensão a combinar" → `areaPay`; "11 91234 - 5678" → `areaContact` |
| R15 | Falso positivo aceito, recusado com `areaNumber`: "Streaming 4K", "8K HDR", "Dados 2015-2020", "10 mil TPS", "Qualidade iso 9001" |
| R16 | Limite declarado: "vinte mil" passa |
| R17 | Custo: 80 mil quebras + "x" e 80 mil dígitos + "x" abaixo de 300 ms |

Contra `546b302` (rascunho à parte), os 10 casos novos eram aceitos (10 de
10). Depois: facts + action + public-profile **59/59**.
