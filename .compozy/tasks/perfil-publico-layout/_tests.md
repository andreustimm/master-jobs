# Contrato de testes — `perfil-publico-layout`

> Revisão L2 (28/09): T10 estava listado como coberto sem nenhum teste tocar
> os cards por `data-testid`. A tabela abaixo separa presença de ausência —
> são predicados diferentes — e só marca "rodado" o que uma execução desta
> sessão realmente confirmou.

| # | Caso | Onde | Por que importa |
|---|---|---|---|
| T1 | `category`, `level` e `occurrences` saem em `PublicSkill`, iguais à linha confirmada | `tests/public-profile.test.ts` | G21: campo novo é explícito, não "a linha toda já é confirmada" |
| T2 | Skill sem `level` sai com `null`, não `undefined` | `tests/public-profile.test.ts` | contrato de tipo estável para quem consome o DTO |
| T3a | E-mail escrito em `level` esvazia a skill inteira, não só o campo | `tests/public-profile.test.ts` | não há "meio-vazamento" — mesma régua do nome/headline |
| T3b | E-mail escrito no `name` (canonicalName) da skill esvazia a skill inteira | `tests/public-profile.test.ts` | a lista de permissão confere o VALOR, não só a coluna — mesma classe do defeito do nome do candidato na 1.22.0 |
| T3c | E-mail escrito na `category` da skill esvazia a skill inteira | `tests/public-profile.test.ts` | idem, para o terceiro campo que agora sai |
| T4 | Skill detectada/rejeitada continua fora (regressão) | `tests/public-profile.test.ts` | regra 6: afirmação de experiência exige confirmação humana |
| T5 | Lista de permissão do perfil inteiro continua exata (sem `email`, `candidateId` etc.) | `tests/public-profile.test.ts` | regressão da fase anterior, com o novo shape de `skills` |
| T6 | `groupPublicSkills()`: categorias em ordem alfabética da CHAVE | `tests/candidate-public-skills.test.ts` | rótulo traduzido não pode reordenar a mesma pessoa em dois idiomas |
| T7 | Dentro do grupo: ocorrências desc, nome asc no empate | `tests/candidate-public-skills.test.ts` | determinístico — não depende da ordem de inserção do banco |
| T8 | Mesma entrada em ordem diferente de chegada dá a mesma saída | `tests/candidate-public-skills.test.ts` | prova a determinação, não só um exemplo |
| T9 | Lista vazia não lança | `tests/candidate-public-skills.test.ts` | perfil sem skill confirmada é caminho normal |
| T10a | Card de seção (Resumo/Experiência/Formação) **aparece** com `data-testid="public-section-<kind>"` quando a seção existe | `checkPublicProfileLayout` (E2E) | a fixture tem as três; prova que a página realmente renderiza o que `cvSections()` devolve, com o gancho que um teste consegue achar |
| T10b | Card de seção **não aparece** quando a seção nunca foi escrita no currículo (não só vazia) | `tests/cv-markdown.test.ts` (unit, `cvSections`) | é o predicado exato de `page.tsx` (`sections.find(s => s.kind === kind)` → `undefined` → `return null`); Jobicy mostra "No data available", aqui a ausência do card é a informação |
| T11 | 375px: hero, CTA "Ver no LinkedIn" e "GitHub" acima da dobra, sem rolagem horizontal | `checkPublicProfileLayout` (E2E) | aceite da issue — recrutador não rola para achar o link |
| T12 | 375px: uma coluna — skills começam no fim (`bottom`) do conteúdo principal, mesmo início horizontal (`left`) | `checkPublicProfileLayout` (E2E) | grid vira coluna única abaixo de `lg:`; comparar só `top` contra o `h1` não distinguia empilhado de lado a lado |
| T13 | ≥1024px: skills ao lado do conteúdo principal (duas colunas) | `checkPublicProfileLayout` (E2E) | aceite da issue |
| T14 | Categorias em ordem alfabética na tela (não só na função pura) | `checkPublicProfileLayout` (E2E) | a função pura ordena; o teste de browser prova que a página usa a ordem |
| T15 | Skill sem caixa alta forçada no badge renderizado | `checkPublicProfileLayout` (E2E, `getComputedStyle`) | bug da fase anterior: ~20 skills em maiúsculas sem agrupamento |
| T16 | "+N" expande e revela as skills além do topo 6, com o `level` confirmado visível | `checkPublicProfileLayout` (E2E) | top N + expansível é o aceite da issue |
| T17 | CV completo recolhido por padrão (`<details>` sem `open`) | `checkPublicProfileLayout` (E2E) | não é mais um `Card` sempre aberto |
| T18 | `level` livre e longo (com espaços) não estoura 375px — o badge quebra linha; um token único longo quebra por `break-words` (não coberto por teste) | `checkPublicProfileLayout` (E2E, `getComputedStyle` + largura) | `Badge` padrão é `whitespace-nowrap`; um nível digitado por um humano não tem limite de tamanho |
| T19 | Perfil não público continua 404 (regressão) | `ui/public-profile.mjs` (E2E, já existente) | G22, inalterado por esta fase |
| T20 | `noindex` mantido (regressão) | `ui/public-profile.mjs` (E2E, já existente) | inalterado por esta fase |
| T21 | `/p/[slug]` sai de `UNMEASURED_PAGES` e é medida por `AXE_SWEEP`, `OVERFLOW_SWEEP`, `ENGLISH_ANONYMOUS_SWEEP` | `tests/e2e-route-coverage.test.ts` + `pnpm test:e2e --areas a11y,mobile,i18n` | aceite da issue: 375px sem overflow, axe sem violação séria, sem vazar português |
| T22 | Nome, headline, localização, o micro-rótulo de seção e o nível de uma skill acentuados sobrevivem à varredura de inglês sem sessão (`data-user-content` isenta, não apaga o acento) | `pnpm test:e2e --areas i18n` (`ENGLISH_ANONYMOUS_SWEEP`) | G30 — sem acento na fixture, uma regressão que removesse `data-user-content` passaria despercebida |
| T23 | O acréscimo de `/p/[slug]` a três varreduras transversais não esgota o limite de 30 requisições/5min do portfólio para o resto da suíte (`clientKey` sem proxy cai no mesmo balde) | `pnpm test:e2e` (suíte completa) | a área dedicada `rate-limit` já isola o próprio teste com `x-forwarded-for` sintético; as varreduras novas não têm essa isolação e somam ao balde compartilhado |

## Rodado (28/09, após as correções da revisão L2)

- **T1–T9, T3b, T3c, T10b:** `pnpm vitest related tests/public-profile.test.ts tests/candidate-public-skills.test.ts tests/cv-markdown.test.ts --run` — **44/44**.
- **T10a, T11–T18, T22 (público-cv-format):** `pnpm test:e2e --areas public-cv-format,mobile,i18n,public-profile` — **46/46** (inclui a fumaça `auth`).
- **T19–T21:** mesma rodada acima (`mobile`, `i18n`, `public-profile`).
- **T22 (axe):** `pnpm test:e2e --areas a11y` — **14/14** páginas sem violação, incluindo "a11y public profile".
- **T23:** `pnpm test:e2e` (suíte completa, sem `--areas`) — **411/411** verificações de `ui.mjs` + **14/14** de `a11y.mjs`; nenhum 429 fora dos dois esperados na área dedicada `rate-limit` ("T5 · respostas 200 e 404 consomem o mesmo balde" e "rajada no portfólio é recusada com 429", ambos com `x-forwarded-for` sintético isolado). O balde compartilhado (`clientKey` sem proxy) absorveu as novas visitas de `/p/[slug]` em `AXE_SWEEP`, `OVERFLOW_SWEEP` e `ENGLISH_ANONYMOUS_SWEEP` sem recusar nada.
- `pnpm typecheck`: limpo em todas as rodadas.
