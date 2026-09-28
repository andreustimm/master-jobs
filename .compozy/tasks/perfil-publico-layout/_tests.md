# Contrato de testes — `perfil-publico-layout`

| # | Caso | Onde | Por que importa |
|---|---|---|---|
| T1 | `category`, `level` e `occurrences` saem em `PublicSkill`, iguais à linha confirmada | `tests/public-profile.test.ts` | G21: campo novo é explícito, não "a linha toda já é confirmada" |
| T2 | Skill sem `level` sai com `null`, não `undefined` | `tests/public-profile.test.ts` | contrato de tipo estável para quem consome o DTO |
| T3 | E-mail escrito em `level` esvazia a skill inteira, não só o campo | `tests/public-profile.test.ts` | não há "meio-vazamento" — mesma régua do nome/headline |
| T4 | Skill detectada/rejeitada continua fora (regressão) | `tests/public-profile.test.ts` | regra 6: afirmação de experiência exige confirmação humana |
| T5 | Lista de permissão do perfil inteiro continua exata (sem `email`, `candidateId` etc.) | `tests/public-profile.test.ts` | regressão da fase anterior, com o novo shape de `skills` |
| T6 | `groupPublicSkills()`: categorias em ordem alfabética da CHAVE | `tests/candidate-public-skills.test.ts` | rótulo traduzido não pode reordenar a mesma pessoa em dois idiomas |
| T7 | Dentro do grupo: ocorrências desc, nome asc no empate | `tests/candidate-public-skills.test.ts` | determinístico — não depende da ordem de inserção do banco |
| T8 | Mesma entrada em ordem diferente de chegada dá a mesma saída | `tests/candidate-public-skills.test.ts` | prova a determinação, não só um exemplo |
| T9 | Lista vazia não lança | `tests/candidate-public-skills.test.ts` | perfil sem skill confirmada é caminho normal |
| T10 | Card de seção (Resumo/Experiência/Formação) não aparece sem a seção correspondente | `checkPublicCvFormat` (E2E, regressão) + inspeção manual do componente | Jobicy mostra "No data available"; aqui a ausência de card é a informação |
| T11 | 375px: hero, CTA "Ver no LinkedIn" e "GitHub" acima da dobra, sem rolagem horizontal | `checkPublicProfileLayout` (E2E) | aceite da issue — recrutador não rola para achar o link |
| T12 | 375px: uma coluna — skills abaixo do conteúdo principal | `checkPublicProfileLayout` (E2E) | grid vira coluna única abaixo de `lg:` |
| T13 | ≥1024px: skills ao lado do conteúdo principal (duas colunas) | `checkPublicProfileLayout` (E2E) | aceite da issue |
| T14 | Categorias em ordem alfabética na tela (não só na função pura) | `checkPublicProfileLayout` (E2E) | a função pura ordena; o teste de browser prova que a página usa a ordem |
| T15 | Skill sem caixa alta forçada no badge renderizado | `checkPublicProfileLayout` (E2E, `getComputedStyle`) | bug da fase anterior: ~20 skills em maiúsculas sem agrupamento |
| T16 | "+N" expande e revela as skills além do topo 6, com o `level` confirmado visível | `checkPublicProfileLayout` (E2E) | top N + expansível é o aceite da issue |
| T17 | CV completo recolhido por padrão (`<details>` sem `open`) | `checkPublicProfileLayout` (E2E) | não é mais um `Card` sempre aberto |
| T18 | Perfil não público continua 404 (regressão) | `ui/public-profile.mjs` (E2E, já existente) | G22, inalterado por esta fase |
| T19 | `noindex` mantido (regressão) | `ui/public-profile.mjs` (E2E, já existente) | inalterado por esta fase |
| T20 | `/p/[slug]` sai de `UNMEASURED_PAGES` e é medida por `AXE_SWEEP`, `OVERFLOW_SWEEP`, `ENGLISH_ANONYMOUS_SWEEP` | `tests/e2e-route-coverage.test.ts` + `pnpm test:e2e --areas a11y,mobile,i18n` | aceite da issue: 375px sem overflow, axe sem violação séria, sem vazar português |

Rodado: T1–T9 e T18 (regressão) em `pnpm vitest related`; T10–T17, T19, T20 em
`pnpm test:e2e --areas public-cv-format` (19/19), `--areas i18n,mobile,public-profile`
(35/35) e `--areas a11y` (14/14 páginas, incluindo "a11y public profile").
