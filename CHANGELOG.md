# Changelog

Histórico técnico, para quem mexe no código. Os resumos em linguagem simples
exibidos no rodapé ficam em [`USER_CHANGELOG.pt-BR.md`](./USER_CHANGELOG.pt-BR.md)
e [`USER_CHANGELOG.en.md`](./USER_CHANGELOG.en.md).

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado

- A mesma vaga publicada em vários países passa a ocupar **uma linha**, com a
  bandeira de cada país; clicar numa bandeira abre a publicação daquele país.
  Medido no acervo antes de construir: 391 grupos sobre 2.934 publicações,
  2.543 linhas a menos — 34% do quadro —, e o maior grupo é a mesma vaga em 42
  países. Em todos os grupos cada publicação tem uma localização distinta, o
  que é o que torna a chave (fonte, título, empregador) confiável.
- `src/core/country.ts`: país de uma localização escrita à mão, bandeira e nome
  traduzido. A tabela vem do ICU do próprio Node em vez de uma lista à mão, que
  envelheceria na primeira fonte nova. Cobre 95,3% das localizações dentro dos
  grupos; o resto são cidades soltas, que aparecem como texto.
- Interruptor "agrupar repetidas" na barra de filtros, ligado por padrão. A URL
  carrega a exceção (`ungrouped=1`), não a regra, para o link comum ficar curto.

### Corrigido

- O caso que recusa semear QA manual fora de um banco provisionado passa a
  declarar o tempo que precisa. Ele abre quatro processos Node, um por URL
  recusada: 2,2s nesta máquina, e no runner estourou o limite padrão de 5s e
  reprovou uma PR que não tocava o arquivo.

### O que não é óbvio no diff

- O agrupamento é de **apresentação**: os registros continuam separados, e
  `closedAt` e as chaves estrangeiras das candidaturas não são tocados.
- A linha escolhida é a de **menor id**, nunca a de melhor nota — nota é por
  candidato, e uma linha canônica que mudasse de leitor para leitor faria o
  mesmo link significar vagas diferentes.
- O predicado entra em `boardConditions`, que lista e contagem compartilham, e
  por isso o rodapé conta linhas agrupadas em vez de publicações.
- É um anti-join, não uma subconsulta por linha: o Postgres resolve numa
  passada e o acervo pagou 36ms contra 35ms sem ele. Nenhum índice novo,
  nenhuma migration.
- Uma marca por país, não por publicação: três cidades brasileiras davam três
  bandeiras iguais lado a lado. O rótulo então diz quantas são.
- `DD`, `FX`, `UK` e outros ficam fora da tabela do ICU: o CLDR guarda o
  passado e chama `DD` de "Germany" e `FX` de "France", então uma varredura
  alfabética entregava o código morto. `UK` é reservado e não tem bandeira; o
  código do país é `GB`.

## [1.17.1] - 2026-09-20

### Corrigido

- O CI passou a reprovar **no mesmo commit que tinha passado de manhã**: quatro
  testes falharam às 13:42 UTC e os mesmos verdes às 05:07, na PR de release
  #135. Duas causas, as duas de relógio misturado.
  - `termCapture.createdAt` vinha do padrão do banco (`clock_timestamp()`),
    enquanto `dailyRepeatPaused` compara 36 horas contra esse carimbo usando o
    relógio da aplicação. Dois relógios na mesma conta dão respostas diferentes
    conforme a hora real do dia. O carimbo passa a vir de `clock()`, que é de
    onde vem a decisão, e um teste novo prende isso.
  - Três casos de impersonação fixavam a validade do ator em
    `2026-09-20T12:00:00.000Z`. `authorize` recebe o instante de quem chama e
    nenhum chamador passa um — por decisão de pureza do domínio, o padrão é o
    relógio real —, então a data virou bomba de tempo e explodiu ao passar da
    hora. A validade agora é relativa.

## [1.17.0] - 2026-09-20

### Adicionado

- Tela **`/admin/operacoes`**: o administrador pede varredura, busca por termo,
  reconferência de expiradas ou repontuação, e vê quantas fontes estão sem erro,
  a varredura mais recente e o erro de cada fonte quebrada. A tela **pede**; quem
  executa é o GitHub Actions, porque função web morre em 30s e o sync leva de 18
  a 27 minutos. Contexto novo `src/contexts/operations/` com uma porta —
  `WorkflowDispatchPort` — e o adapter de `workflow_dispatch`; `varredura.yml`
  ganha o input `rotina` e cada passo declara a que rotina pertence, então pedir
  uma fatia não gasta cota das outras. Sem `GITHUB_DISPATCH_TOKEN` o botão
  explica o que falta e a execução diária segue intacta.
- `src/core/ingest/health.ts`: a saúde das fontes numa leitura só, usada pela
  tela e pela CLI (`jho sources list`), que antes montava a própria consulta —
  duas superfícies discordando sobre "fonte quebrada" era questão de tempo.
- Workflow **`fumaca-producao.yml`**: depois de `main` avançar, espera até a
  versão promovida estar realmente servindo — a página de login carrega a versão,
  então a espera tem critério em vez de um `sleep` que testaria o deploy anterior
  — e confere as rotas públicas: `/login` 200, rota autenticada 307, `/p/` de
  slug inexistente 404 e `/offline.html` 200. Os dois defeitos de produção de
  19–20/09 (500 por schema atrasado e 504 em duas telas) foram descobertos por
  alguém abrindo o site; agora há quem repare antes.

## [1.16.0] - 2026-09-20

### Adicionado

- Fonte **Turing** (Greenhouse, 21 vagas no probe): única das treze vitrines de
  outsourcing sondadas em 2026-09-20 com board público legível. São vagas do
  time interno da Turing, a maioria presencial nos EUA — entra porque nomeia o
  empregador e custa uma chamada por varredura.
- `docs/sources-autenticadas.md` ganha a seção das **vitrines de outsourcing e
  staff augmentation**: o que a sondagem encontrou em treze plataformas (Revelo,
  BairesDev, WillDom, Strider, VanHack, TECLA, Jobsity, BEON.tech, Nearsure,
  Howdy, Talently, Index.dev, Turing), por que não há adapter a escrever onde a
  listagem não é pública, a prioridade por evidência, o que o perfil precisa
  dizer, a cadência que mantém a vitrine viva, como medir por canal e o limite
  do LinkedIn para post de recrutador.

### Corrigido

- `/candidate/skills` e `/searches/tracks/new?term=…` devolviam **504** em
  produção, aos 30s da função da Vercel, enquanto as outras telas respondiam em
  1–5s e as mesmas leituras levavam 600ms num build de produção local contra o
  mesmo banco. O traço que separava umas das outras era o número de consultas
  simultâneas: as duas passavam de três, e o cliente abre três conexões
  (`max: 3`). As leituras dessas telas passam a ser em série, a leitura da tela
  de skills virou `app/candidate/skills/data.ts` para poder ser medida, e
  `tests/db-fan-out.test.ts` conta o pico de consultas em voo — 4 reprova.
  O tamanho do pool agora está documentado como contrato com quem escreve tela.
## [1.15.4] - 2026-09-20

### Corrigido

- `/jobs/<id não numérico>` respondia **500** em produção: `Number("abc")` é
  `NaN` e `NaN` chegando à consulta estoura no PostgreSQL, então endereço errado
  de alguém virava incidente no Sentry. A tela valida o id antes de consultar e
  responde 404, como a tela de trilha já fazia.

## [1.15.3] - 2026-09-19

### Corrigido

- Celular: em 320px, título de vaga sem ponto de quebra ("Werkstudent*in
  Finance (Schwerpunkt Accounting/Controlling) Vollzeit/Teilzeit") passava da
  borda e a tela de detalhe rolava 31px para o lado. O `h1` é item de flex e
  não encolhia abaixo do próprio conteúdo: agora tem `min-w-0 break-words`.
  Achado na revisão da 1.15.2 em produção. A varredura de larguras do E2E passa
  a cobrir 320px e a tela de detalhe, com uma vaga semeada de título longo.

## [1.15.2] - 2026-09-19

### Corrigido

- Varredura diária: o sync passou de uma hora na 1.15.0 e a execução foi
  cancelada antes de buscar os termos, capturar e pontuar. O runner fica nos
  EUA e o banco em São Paulo, e cada vaga custava quatro idas ao banco. Agora a
  observação lê as vagas conhecidas em blocos de cem (`observeRawJobs`, usada
  pelo sync e pela captura de termos), guarda o id da empresa por rodada e
  grava cada lote de notas num único `INSERT … ON CONFLICT` com `excluded.*`:
  menos de duas consultas por vaga e três comandos para 250 notas. O sync ganha
  teto próprio de 45 minutos com `continue-on-error`, os passos seguintes rodam
  com o que já foi gravado e a execução termina vermelha se o sync falhar.

## [1.15.1] - 2026-09-19

### Corrigido

- Celular: a tela Buscas cortava os cartões de termo — o conteúdo da trilha é
  uma grade e o botão "de novo a partir de…" (`whitespace-nowrap`) alargava a
  coluna além do cartão. `grid-cols-1` no conteúdo, ações do termo em grade de
  duas colunas com alvo de 44px até `xl`, e o rótulo do intervalo quebra linha.
  Em tela de toque todo campo tem ao menos `1rem`: o Safari do iPhone dava zoom
  ao focar os selects de 15px e cortava a tela, inclusive em Vagas. A varredura
  de larguras do E2E cobre Buscas e acusa elemento cortado dentro de cartão
  (BUG-20260919-mobile-searches-overflow).
- Celular: em Skills, a evidência de uma skill a auditar com link longo do CV
  em markdown ia a 480px numa tela de 375. A grade do cartão ganha
  `grid-cols-1` e o parágrafo quebra em qualquer ponto (`wrap-anywhere`).
  Revisão logada de 23 telas em 6 tamanhos, retrato e paisagem: nenhuma rolagem
  horizontal e nenhum elemento além da borda.

## [1.15.0] - 2026-09-19

As ADRs citadas como `ADR-0NN` nesta versão são as da feature, em
`.compozy/tasks/term-search-target-tracks/adrs/`; as de `docs/adr/` aparecem
como `ADR 00NN`.

### Adicionado

- Trilhas de alvo (`target_track`): cada candidato tem uma trilha principal e
  até seis ativas, cada uma com títulos, keywords, senioridade e faixas de
  remuneração próprias. A pessoa (restrições, blockers, evidências) continua no
  perfil de matching e é somada ao alvo por `effectiveProfile` antes de
  pontuar (ADR-002, ADR-009).
- `job_score` passa a ter chave `(candidate_id, track_id, job_id)`, com
  migração em três passos: expandir (`0004`), preencher a trilha principal a
  partir do perfil gravado (`0005`) e contrair (`0006`). Candidato sem perfil
  próprio perde as notas herdadas e não é pontuado (M-06).
- Scorer `1.4.0`: a trilha principal pontua toda vaga aberta; trilha aceita só
  as vagas em que um título ou keyword positiva dela aparece com borda de
  palavra. A borda é `TERM_BOUNDARY`, em `src/core/term.ts`, a mesma do filtro
  de termo (ADR-012).
- Todo leitor de `job_score` escolhe a trilha por `scoreTrackFilter` ou
  `primaryScoreFilter`; teste de arquitetura reprova quem lê a tabela sem um dos
  dois. Board aceita trilha escolhida ou "todas"; dossiê, relatório, exportação,
  cockpit e o `max(fit)` de verificação e captura leem a principal.
- `trackFitsForJob` calcula sob demanda, sem gravar, a nota de uma trilha que
  não tem linha para a vaga — base do detalhe por trilha.
- Tabela `saved_term`, que a busca por termo vai usar.
- Contexto `sourcing` com a captura por termo: `requestTermCaptures`,
  `runTermCaptures`, `captureStatusFor`, `attributedJobIds` e `captureHealth`,
  sobre as tabelas `term_capture`, `term_attribution` e `platform_quota`
  (migração `0007`). Uma busca por (plataforma, termo, dia UTC) serve a todos;
  no máximo 100 vagas por plataforma, as mais recentes; atribuição por borda de
  palavra em título, empresa, descrição e tags (ADR-004, ADR-007).
- Busca por termo na Remotive, no RemoteOK (`tag`) e na Himalayas (endpoint de
  busca, paginado por `page`), validadas em 2026-09-19 por
  `jho sources probe <kind> --term <t>`, com fixtures reais em
  `tests/fixtures/term-search/`. `RawJob.tags` carrega as tags da plataforma.
- Livro de cota por plataforma com reserva atômica, respeitado também pela
  sincronização regular: chamada orçada usa `retries: 0`, janela cheia registra
  `quota` na fonte e 429 esgota o dia da plataforma (ADR-010).
- Vaga trazida por captura entra na fonte `<kind>:~terms`, desligada; vaga
  existente mantém fonte, id externo, URLs e payload (`keepExistingSource`).
  `sources.yaml` recusa handle que começa com `~` (ADR-011).
- `jho sources probe` ganha `--term` e passa pela guarda de ingestão.
- Termos salvos no contexto `matching`: `saveTerm` (termo e primeiras
  capturas na mesma transação), `rerunTerm` (uma busca manual a cada 24 horas;
  dentro da janela, só a plataforma que falhou hoje é tentada de novo),
  pausar, retomar, mover, apagar, contagem de vagas novas e `termOverview` com
  o estado de cada plataforma, "sem resultado há 14 dias" e "repetição diária
  parada". Até 20 termos ativos por candidato, um por chave normalizada, cada
  um numa trilha ativa.
- Server Actions de termo em `app/searches/actions.ts`: sessão emprestada salva
  mas não dispara busca (`waiting_sweep`); onde a ingestão não é permitida o
  termo é salvo com `captures_off`; a busca roda depois da resposta, em
  `after()`, com 25 segundos de orçamento.
- `jho terms run`, `jho terms status` e `jho tracks list`; a varredura diária
  ganha o passo "Buscar os termos salvos" entre a sincronização e a
  repontuação. Captura já feita hoje é reaproveitada sem nova chamada.
- Filtro `broughtBy` no leitor do board: vagas que um termo salvo trouxe.
- Tela Vagas: seletor de trilha (principal, aceita ou todas, com rótulo por
  vaga), filtro "trazida pelo termo" com marcador de vaga nova desde a última
  visita (gravada em `after()`, nunca num prefetch), salário mínimo com moeda e
  período, ordenação por salário normalizado e avisos para parâmetro inválido
  (`track_unknown`, `term_*`, `term_unknown`, `pay_invalid`, `cluster_unknown`)
  em vez de erro. O estado continua todo na URL (`app/filter-state.ts`), e o
  trabalho de dados saiu da página para `app/jobs/jobs-data.ts`.
- `annualFactorSql()` e `normalizePayTop` em `src/core/money.ts`: filtro e
  ordenação por salário em SQL com a mesma tabela de fatores do TypeScript e a
  cotação mais recente como lista `VALUES` ligada (ADR-013). Moeda sem
  cotação, período desconhecido ou projeto sem duração ficam "não
  comparáveis"; nada disso chega ao scorer.

- Tela Buscas (`/searches`): trilhas com seus termos e o estado de cada
  plataforma, e as ações de termo (salvar, rodar de novo, pausar, retomar,
  mover, apagar). Editor de trilha em `/searches/tracks/new` — com a sugestão
  para o termo vindo da oferta da tela Vagas — e em `/searches/tracks/<id>`,
  mais tornar principal, arquivar e restaurar. Toda action passa por
  `guardOwnCandidate`; recrutador e admin sem impersonação não alcançam nada
  disso, e `/searches` fica fora do cache do service worker.
- Saúde das capturas em `/admin/captures`: cota do dia e do minuto, capturas
  das últimas 24 horas, último erro e dias seguidos com falha, por plataforma e
  só em agregado (`admin:access`, recusada em sessão emprestada).
- Detalhe da vaga mostra o fit de cada trilha ativa, calculado na hora por
  `trackFitsForJob` quando a trilha ainda não tem linha para a vaga. Vagas e o
  editor de trilha avisam enquanto a repontuação da trilha está na fila
  (`app/score-queue-card.tsx`, extraído da tela do candidato).
- `MutationFeedbackForm` ganha mensagem por código de resultado
  (`resultMessages`), link opcional no aviso (`href` no resultado) e
  `keepFields`, que impede o React de limpar o formulário quando a action
  recusa — o editor de trilha perdia tudo o que fora digitado por uma faixa
  inválida.
- QA vivo: área `SRCH`, jornadas `J-save-term-search`,
  `J-manage-target-tracks` e `J-monitor-term-capture-health`, cenários novos em
  `untested` e `JOBS-work-mode-continuity` de volta a `untested`, porque a
  busca mudou para palavra inteira.

- Teto de 40 buscas por dia por candidato pela tela (`saved_term_request`,
  migração `0008`, aditiva): apagar e salvar de novo não zera a conta; passado o
  teto, o termo salvo espera a varredura (`daily_limit`) e o "rodar de novo" é
  recusado (`request_limit`). Trilha tem teto de tamanho (`track_too_large`:
  60 títulos, 200 palavras positivas e 60 negativas).
- `jho terms run` espera as janelas por minuto do dia (até 20 minutos) em vez de
  sair com termos parados; a varredura segue quando a busca por termo falha em
  todas as plataformas e acusa no último passo.
- Runbook da release em `docs/engineering/deploy.md`: as migrations 0004–0008
  são aplicadas pela CLI antes do merge em `main`, com a varredura desligada, e
  não há rollback para 1.14.x depois da 0006.

- "Não me interessa" (`dismissJobAction`) e "restaurar" (`restoreJobAction`)
  em `app/actions.ts`, pelo mesmo `setApplicationStatus` do seletor: arquivam a
  candidatura e devolvem a `backlog`. Botão em cada linha da lista
  (`TriageButton`), no cockpit e no detalhe da vaga, e preset "Arquivadas"
  (`status=archived`). `archived → backlog` passa a ser transição legal só
  quando não há `applied_at`; `allowedTransitions` recebe `appliedAt`.
- `listBoard`, `countBoard` e `boardFacets` sem `status` escondem a vaga com
  candidatura `archived`; `status=any` mostra tudo. Vale para a tela Vagas, o
  cockpit, o CSV exportado, o relatório e `jho jobs list`.

- Três fontes novas com busca por termo, validadas contra a API real em
  2026-09-19 (`jho sources probe`): `jobicy` (API documentada; `jobGeo` vira a
  frase de restrição de país), `workable` (busca global com
  `location=Brazil&workplace=remote`, paginada por `pageToken`) e `hackernews`
  (fio mensal "Who is hiring?" pela Algolia, só comentário de topo no formato
  "Empresa | Cargo | Local"). Orçamentos no livro de cota: Jobicy 24/dia e
  1/min, Workable 10/min, HN 30/min. `config/sources.yaml` ganha quatro
  entradas; fixtures de resposta real em `tests/fixtures/term-search/`.

- 28 boards Lever de empresas com vaga remota da stack aberta ao Brasil em
  `config/sources.yaml` (CI&T, Oowlish, BriteCore, Ubiminds, Jeeves, RYZ
  Labs, Yuno, VRChat, JetBridge e outras), cada um confirmado com
  `jho sources probe lever <handle>` em 2026-09-19. A Bluelight Consulting
  ficou de fora: 1.321 postagens repetindo 10 cargos, uma por cidade, e a
  cidade entra no `fingerprint`.

### Alterado

- A busca da tela Vagas deixou de ser substring em cargo e empresa: é o termo
  por palavra inteira (`termRegexSql`, ligado como parâmetro) em cargo, empresa
  e texto capturado ou descrição (ADR-005, ADR-012). Toda ordenação termina em
  nota e `job.id`, para a paginação não repetir nem perder vaga.

### Corrigido

- `/admin/users` falhava na hidratação sempre que um recrutador tinha
  vínculo: o formulário de desvincular ficava dentro de um `<p>`, que o parser
  HTML fecha antes do `<form>`.
- A conclusão da fila de repontuação só grava `done` se a tarefa ainda estiver
  em `scoring`: um pedido novo feito durante a execução voltava a `pending` e
  era apagado pela conclusão da execução anterior.
- Vaga fechada e arquivada que reaparecia na sincronização voltava só meio
  aberta: `closedAt` ia a nulo e `archivedAt` ficava, escondendo-a do quadro.
  Reabrir agora limpa os dois, como a verificação de link já fazia (ADR 0020).

- Restrição de país passa a ser elegibilidade (scorer `1.4.1`):
  `locationRestriction()` lê `X only` na localização (Braintrust) e a frase
  `Location restricted to: X only.` que a Himalayas agora acrescenta à descrição
  a partir de `locationRestrictions`, como sinais `regions` de
  `evaluateEligibility`. Vaga restrita a países fora de `acceptable_regions`
  ("United States only", "Spain only") fica `ineligible`, com `geo` zero e
  bloqueador; antes pontuava como remota qualquer. A localização da Himalayas
  continua a lista pura, porque ela compõe o `fingerprint`. Localização sem
  "only" continua neutra.

## [1.14.2] - 2026-09-19

### Corrigido

- A peneira final do relato de erro (`beforeSend`) sai da configuração do SDK
  para `scrubEvent` em `src/core/observability.ts`, pura e testada. Enquanto
  viveu inline no `init`, nenhum teste a exercitava — justamente a função que
  carrega a promessa de privacidade inteira. Ao testá-la, apareceram três
  lacunas reais da versão anterior: `request.headers` não era filtrado (e é
  onde `cookie` aparece), `request.query_string` não era apagado, e
  `request.url` ia com a query string completa. Os três passam a ser tratados,
  e a identidade (`event.user`) é apagada mesmo que `sendDefaultPii` mude de
  padrão numa atualização.
- `scrubEvent` devolve `null` em caso de erro, o que faz o SDK descartar o
  evento. Mandar um evento sem peneirar seria pior que não relatar.

## [1.14.1] - 2026-09-19

### Corrigido

- `register` e `onRequestError` em `instrumentation.ts` passam a nunca propagar
  exceção. `register` roda **antes** de o servidor atender a primeira
  requisição e o Next espera que ela conclua: uma falha ali — SDK que não
  carrega, bug numa atualização — não degradava o relato de erro, impedia o
  servidor de subir. Trocava "não sei o que quebrou" por "quebrou tudo", que é
  pior que não ter relato nenhum, e é o mesmo modo de falha do corte da 1.13.1:
  uma verificação correta em posição de bloquear o processo inteiro. É a guarda
  que `instrumentation-client.ts` já tinha na navegação.
- O teste da guarda simula o SDK estourando, em vez de usar DSN inválido:
  verificado que `Sentry.init` **não** estoura com DSN quebrado — ele registra
  "Invalid Sentry Dsn" e se desativa —, então um teste assim passaria com ou sem
  a guarda e não provaria nada. Com a simulação, remover o `try/catch` reprova.

## [1.14.0] - 2026-09-19

### Adicionado

- Relato de erro do servidor para o Sentry, em `instrumentation.ts`, pelos
  ganchos `register` e `onRequestError` do Next. Motivado por um caso concreto:
  o corte da 1.13.1 devolveu 500 em toda página que toca o banco por 28
  minutos, e quem descobriu foi uma pessoa abrindo o site — nenhuma linha do
  sistema avisou. **Sem `SENTRY_DSN` nada é enviado**, e o SDK nem chega a ser
  importado: ausência de provedor não bloqueia produto, como no
  `RESEND_API_KEY`.
- `src/core/observability.ts` decide o que pode acompanhar um erro, em funções
  puras e sob lista de **permissão**. Sai o caminho da rota; **não sai** a query
  string (termo de busca, faixa salarial e estágio do funil são uso, não
  diagnóstico), nem `cookie`, `authorization`, `x-forwarded-for` ou corpo da
  requisição. `redactSecrets` apaga credencial de URL, esquema `Bearer`, chave
  nomeada e e-mail da mensagem e da pilha — o driver `postgres` traz a URL de
  conexão inteira, com senha, no texto da exceção. A decisão é pura e testada
  porque configuração de SDK some numa atualização de dependência e teste não.
- Não há SDK de browser, e a razão é a CSP: `connect-src 'self'` bloquearia o
  envio **em silêncio**, como já aconteceu com a fonte do Google. `tracesSampleRate`
  fica em zero, porque transação carrega a URL completa com a query string que
  acabou de ser excluída de propósito. Mapas de origem exigem `withSentryConfig`
  e token no build, e ficaram para quando houver conta — registrado em
  `docs/engineering/deploy.md`.

## [1.13.2] - 2026-09-19

### Corrigido

- `sslmode` com valor que não afrouxa nada — `require`, `verify-ca`,
  `verify-full` — passa a ser descartado da URL como qualquer parâmetro de
  pool, em vez de recusado. A integração do Supabase com a Vercel cadastra
  `POSTGRES_URL` com `sslmode=require`, e a recusa derrubou toda página que
  toca o banco no corte de produção da 1.13.1: o erro nomeava a variável certa
  e ainda assim era erro. Pedir `require` não pede menos do que o cliente já
  impõe — verificação de cadeia com CA declarada é mais estrito —, então
  recusar só impedia o provedor de configurar o próprio serviço.
  `disable`, `allow`, `prefer` e qualquer valor fora da lista de permissão
  continuam recusados, e `ssl`, `sslcert`, `sslkey` e `sslrootcert` também:
  trocar a CA ou a identidade do cliente é mudar a política, não declará-la.
  O que o teste não pegava é que nenhuma suíte jamais viu o valor real da
  variável de produção — a URL de teste era montada sem query string.

## [1.13.1] - 2026-09-18

### Corrigido

- O funil pedido numa página além do fim mostrava "nada no funil ainda" para
  quem TEM candidatura: o número vinha da URL e virava `offset` sem ser
  confrontado com o total, e o branch de lista vazia não distingue "não há
  nada" de "não há nada AQUI". As contagens passam a ser lidas antes das
  linhas, e o pedido é limitado à última página real. Encontrado em jornada de
  QA sobre a superfície nova do funil, não por teste automatizado.

## [1.13.0] - 2026-09-18

### Adicionado

- Área do recrutador em `/recruiter`: os candidatos que o autorizaram, com o
  funil de cada um, e `/recruiter/[candidateId]` com o histórico daquele
  candidato. O escopo vem de `session.linkedCandidateIds`, resolvido na carga da
  sessão, e entra em SQL como `inArray` — o banco não chega a ler linha de quem
  está fora, em vez de ler tudo e filtrar depois.
- Candidato inexistente e candidato que existe mas não é acompanhado recebem a
  MESMA resposta, 404. Distinguir os dois contaria que aquela pessoa está
  cadastrada, e existência é informação — mesmo raciocínio de `/p/[slug]`. Id
  malformado cai no mesmo 404, antes de qualquer consulta (F-07, US-002).
## [1.12.0] - 2026-09-18

### Alterado

- A URL do banco passa a ser resolvida por uma ordem declarada em
  `src/core/db/config.ts`, e os nomes que a integração do Supabase com a Vercel
  cadastra valem de primeira classe: runtime lê `DATABASE_URL` → `POSTGRES_URL`
  → `POSTGRES_URL_NON_POOLING`, e migration lê `DATABASE_MIGRATION_URL` →
  `POSTGRES_URL_NON_POOLING` → `POSTGRES_URL`. A diferença entre as listas é
  deliberada: DDL não atravessa pooler em modo transação, e o runtime serverless
  quer o pooler. Exigir a cópia para uma variável genérica criava duas fontes da
  verdade que divergem no dia em que o provedor rotaciona a senha — e o sintoma
  disso é produção fora do ar.
- Parâmetro de pool na URL (`pgbouncer`, `connection_limit`) passa a ser
  descartado em vez de recusado; parâmetro de TLS (`sslmode`, `ssl`,
  `sslrootcert`) continua **recusado**, e agora com erro que nomeia a variável.
  Apagar `sslmode=disable` em silêncio deixaria quem escreveu convencido de que
  havia desligado a verificação de certificado.
- `DATABASE_CA_CERT` aceita o PEM colado na variável, além do caminho de
  arquivo. Num painel serverless não há onde pôr arquivo, e o PEM colado virava
  `ENOENT` com o certificado inteiro no lugar do nome — um erro que não conta o
  que houve. Certificado é chave pública, então aceitar as duas formas não
  afrouxa nada; desligar a verificação continua impossível.
- Erro de configuração de banco nomeia a variável de origem e nunca o valor.

### Corrigido

- O currículo de exemplo passa a ser escrito pela identidade que o banco já
  impõe — `(candidate_id, kind)` onde `is_current` —, e não por rótulo. Procurar
  pelo rótulo não enxergava um currículo corrente gravado com outro nome, e o
  seed tentava inserir por cima: `23505` em
  `candidate_document_one_current_idx`. O `SELECT ... FOR UPDATE` que devia
  fechar a corrida não fechava nada, porque não existe linha para travar quando
  ainda não há currículo — o bug aparecia sob concorrência e, por isso mesmo,
  também sem concorrência nenhuma, bastando um currículo anterior com outro
  rótulo. O caminho virou upsert no índice parcial, com a mesma retentativa dos
  demais.

### Adicionado

- O funil passa a dizer o estado da VAGA ao lado do estágio da candidatura —
  encerrada ou arquivada —, derivado de `jobLifecycleState` no domínio de ciclo
  de vida. Os dois nunca se confundem: a vaga fecha sozinha, o estágio só muda
  por decisão do usuário, e era justamente a candidatura de vaga encerrada que
  ficava sem contexto na tela (F-07, US-001).
- Filtro por estágio e paginação no funil, ambos na URL. O total vem das
  contagens e não da página, então paginar não faz o número piscar; a ordem
  desempata por `id`, senão duas candidaturas salvas no mesmo instante trocam
  de lugar entre páginas e uma some. Estágio desconhecido na URL mostra o funil
  inteiro com um aviso, em vez de uma tela vazia sem explicação.

### Adicionado

- Estado de arquivamento (`job.archived_at`) separado do fechamento da fonte, e
  `jho jobs archive` para inventariar e aplicar. A decisão é pura em
  `src/core/ingest/lifecycle.ts`: fonte manual fica fora, sondagem inconclusiva
  nunca arquiva e fechamento recente espera o corte — a mesma disciplina de
  `probe.ts`, porque as duas escondem vaga boa quando erram. O comando é
  somente leitura por omissão, pagina com teto e reclama cada linha uma vez só
  (`archived_at is null` também na escrita), e não toca em `application` nem em
  `application_event`. Um `alive` posterior desfaz o arquivamento junto com o
  fechamento, na mesma linha, sem duplicar fingerprint (F-07, ADR 0020).

## [1.11.1] - 2026-09-18

### Corrigido

- O seed de fixtures deixa de estourar quando duas execuções se cruzam.
  `ON CONFLICT DO UPDATE` promete resultado atômico para uma sessão, não
  imunidade a corrida: a inserção especulativa escreve no índice único antes de
  descobrir o conflito, e duas sessões que chegam ali recebem `23505` em vez do
  UPDATE. Medido com três seeds simultâneos — falhava em cerca de metade das
  execuções da suíte completa e nunca isolado, que é o formato de defeito que
  passa por revisão. `withDuplicateKeyRetry` reexecuta só escrita idempotente e
  só nesse código; qualquer outro erro, e a chave duplicada que insiste, sobem
  na hora.

## [1.11.0] - 2026-09-18

### Alterado

- A varredura diária declara `JHO_ENV=production` e exige `JHO_SOURCE_ALLOWLIST`
  não vazia, falhando cedo com mensagem própria em vez de morrer no meio do
  primeiro adapter — sem isso, a política da ADR 0021 bloquearia o próprio job
  de produção. A rota de cron da Vercel passa a consultar a política além do
  `CRON_SECRET` e responde 503 com motivo: o segredo prova quem chama, não que
  aquele deployment pode gastar cota, e um preview com o segredo herdado
  continuaria autenticado (F-08).

## [1.10.0] - 2026-09-18

### Adicionado

- Acervo de exemplo declarado em `src/core/db/fixtures.ts` e semeado por
  `jho db seed-fixtures`: dez vagas cobrindo remoto, híbrido, presencial,
  modalidade não declarada, aberta, fechada e reaberta, mais quatro contas que
  exercitam as fronteiras de autorização existentes. O seed é idempotente por
  identidade declarada — reexecutar atualiza, nunca duplica, inclusive sob
  execução concorrente — e valida o corpus antes de escrever, então fixture
  inválida vira erro de configuração em vez de meia carga. Sem PII, sem
  segredo, sem payload bruto, e todas as URLs em `example.test` (F-08, ADR 0021).

## [1.9.0] - 2026-09-18

### Adicionado

- Política de ingestão por ambiente que nega por omissão: `canRunIngestion` é
  pura, produção só passa com allowlist declarada, local exige opt-in explícito
  e dev, staging e preview nunca gastam cota de fonte externa. Ambiente ausente
  ou ilegível normaliza para `preview` — o mais restrito — em vez de virar
  produção por engano. Sync, recheck, probe e captura chamam o mesmo guarda
  antes de resolver adapter ou abrir fila, e o erro operacional nomeia ambiente
  e motivo sem citar host, credencial ou segredo (F-08, ADR 0021).

## [1.8.0] - 2026-09-18

### Adicionado

- O detalhe da vaga exibe o histórico da candidatura lido de
  `application_event` — data, transição e a nota escrita em cada uma —, por uma
  query escopada ao candidato da sessão. Fecha a lacuna registrada em
  BUG-20260917-transition-note-never-readable, onde a nota era aceita e não
  voltava em superfície pública nenhuma. Implementa a opção recomendada no
  relatório de QA; as alternativas eram gravar em `application.notes`, que
  sobrescreve a nota anterior a cada salvamento, ou retirar o campo.

## [1.7.2] - 2026-09-18

### Corrigido

- O seletor de estágio do funil passa a oferecer somente os status alcançáveis
  a partir do atual, derivados de `allowedTransitions` no domínio de Pursuit, e
  uma transição recusada pelo servidor preserva a nota digitada em vez de
  descartá-la com o formulário. `trackAction` devolve a recusa como dado
  tipado, e a mensagem nomeia os dois estágios (BUG-20260910).
- A recusa também revalida o detalhe da vaga e devolve o seletor ao estágio
  gravado, então a lista oferecida deixa de ser a de quando a página abriu.
  Sem isso, o aviso mandava escolher um estágio alcançável enquanto só oferecia
  estágios que seriam recusados de novo (BUG-20260917-stale-stages-after-refusal).
- A nota escrita sobre um estágio que não muda passa a ser gravada como evento
  `note` em vez de descartada em silêncio — caminho que a lista restrita tornou
  o único possível a partir de um estado terminal. `allowedTransitions` degrada
  para um status fora do funil em vez de lançar durante a renderização, e o
  seletor deriva o valor da lista oferecida, então um conflito de concorrência
  não deixa o formulário enviar sem `status`.

## [1.7.1] - 2026-09-16

### Corrigido

- A ingestão local agora preserva valores salariais com centavos e o comando de
  importação carrega automaticamente o `.env` do projeto.

## [1.7.0] - 2026-09-16

### Adicionado

- O ambiente local agora usa a mesma linha PostgreSQL 17 do Supabase, com
  `pgmq` e `pgvector`, e oferece importação segura de uma fixture sanitizada
  de produção sem HTML, filas ou payloads de crawler.
- A proposta de upgrade LTS registra a matriz de versões e os gates para
  manter local, CI, Vercel e Supabase coerentes.

## [1.6.0] - 2026-09-16

### Adicionado

- Preparado o caminho PostgreSQL para o Supabase: schema privado, roles separadas
  para runtime e migration, importação seletiva com rehearsal local e controles
  explícitos para o corte. Nenhum banco remoto foi alterado.

### Alterado

- A preparação da migração agora verifica a preservação do acervo e o rollback
  transacional antes de qualquer corte de produção.

## [1.5.0] - 2026-09-16

### Alterado

- A ingestão passa a guardar apenas texto e metadados úteis das vagas: HTML
  bruto e payload integral de fontes de rede são descartados após normalização.
- O comando `jho db cleanup` inventaria por padrão e, com `--apply`, compacta
  payloads legados e poda vagas fechadas sem candidatura; uma Action semanal
  aplica a retenção em produção.
- As seis contagens de filtros do cockpit agora usam uma única agregação
  condicional, reduzindo leituras completas do acervo nessa jornada.

## [1.4.1] - 2026-09-15

### Corrigido

- O quadro global agora ignora cortes de aderência, cluster, bloqueios e status
  quando a sessão não tem candidato (recrutador ou administrador), preservando
  a visibilidade do acervo sem expor score ou funil de outra pessoa. O detalhe
  e a exportação CSV seguem a mesma regra, e o formulário de candidatura só
  aparece quando há candidato associado.
- O escopo de candidato agora exige o papel `candidate` em cada fronteira de
  sessão; ao remover esse papel, o vínculo antigo fica inativo e não pode
  reabrir score ou funil privado por uma conta administrativa. A associação é
  preservada para uma restauração posterior do papel.

## [1.4.0] - 2026-09-15

### Adicionado

- Filtro de modalidade (remoto, híbrido e presencial) no cockpit e na lista,
  aplicado em SQL antes da paginação e compartilhado por contagem, facetas e CSV.
  A classificação usa metadados declarados pela fonte e localização explícita;
  heurísticas extraídas de palavras da descrição não decidem a modalidade.
  A ausência de modalidade permanece no recorte Todas, sem migração nem novo score.

### Corrigido

- Ver todas preserva o recorte do cockpit, inclusive o corte Todas (`fit=0`);
  avançar na paginação mantém o tamanho de página escolhido.
- O campo de busca acompanha a URL ao limpar o texto e percorrer o histórico.

## [1.3.10] - 2026-08-28

### Corrigido

- Em telefones com a PWA instalada, o cabeçalho mantém o piso de proteção da
  barra de status no retrato e usa apenas o inset físico real em paisagem
  baixa, evitando uma faixa superior artificial de 48px após girar o aparelho.

## [1.3.9] - 2026-08-27

### Corrigido

- A PWA verifica uma nova geração do service worker ao voltar do background,
  ignora o cache HTTP nessa verificação e recarrega uma única vez quando o
  worker atualizado assume o controle, evitando manter o CSS do documento
  anterior depois de um deploy.
- O cabeçalho volta a ocupar 100% da viewport em navegador, PWA, tablet e
  desktop, enquanto somente o conteúdo móvel recebe calhas de 2,5%; a
  navegação completa permanece visível sempre que a medição comprova espaço.
- O changelog deixa de ser lido e renderizado na tela de login; o gatilho da
  modal passa a existir somente com uma sessão válida.
- O gate pós-deploy agora exige os marcadores da geometria atual e rejeita
  explicitamente o seletor obsoleto que aplicava safe area ao wrapper externo.

## [1.3.8] - 2026-08-27

### Corrigido

- Na PWA instalada, o cabeçalho respeita a área segura do sistema em retrato e
  paisagem, preserva a altura prevista pelo design e mantém os controles fora
  da barra de status.
- O shell responsivo usa a largura disponível com calhas simétricas e mantém
  o conteúdo limitado a 1760px em monitores largos.

### Adicionado

- A sincronização pós-produção verifica marcadores do CSS realmente servido e
  sinaliza falha quando o deploy entrega um artefato de estilo antigo, sem
  bloquear a sincronização de versão e branches.
- O hook versionado e o CI agora validam os três changelogs quando a leva pede
  bump, antecipando a falha que antes aparecia só na promoção.
- A sincronização pós-produção cria, de forma idempotente, uma GitHub Release
  para cada tag SemVer e repara automaticamente as ausentes no histórico.

## [1.3.7] - 2026-08-26

### Corrigido

- O cabeçalho mantém apenas um modo de navegação visível mesmo durante uma
  atualização em que o HTML e o CSS publicados ainda não estejam sincronizados.
- Nomes de conta longos não aumentam mais a largura da página nem quebram a
  linha de controles do cabeçalho.

## [1.3.6] - 2026-08-26

### Corrigido

- A navegação global agora usa o logotipo Master Jobs como link para a tela
  inicial, sem repetir o Cockpit na lista de menus.
- O menu compacto pode ser aberto e fechado pelo mesmo botão, inclusive depois
  de uma segunda tentativa em dispositivos móveis.

## [1.3.5] - 2026-08-26

### Corrigido

- O cabeçalho aplica a área segura em qualquer orientação de toque e preserva
  a altura dos controles abaixo da barra do sistema. O shell móvel ocupa 95%
  da tela, e a navegação alterna entre a fileira completa e o menu compacto
  conforme a largura real disponível.

## [1.3.4] - 2026-08-26

### Corrigido

- A navegação responsiva mantém o menu compacto em paisagem até existir espaço
  para a linha completa, e o popover continua ancorado abaixo do cabeçalho com
  área segura durante a rotação.

## [1.3.3] - 2026-08-25

### Adicionado

- Feedback global de mutações para ações da interface: operações de salvar,
  alterar, excluir e atualizar agora anunciam sucesso ou erro no idioma ativo,
  com expiração automática após cinco segundos.

### Corrigido

- A janela de edição de conta agora fecha depois de um salvamento bem-sucedido.
- O carregamento de navegação fica centralizado na área inteira da tela,
  inclusive em dispositivos móveis, e os status de candidatura são traduzidos
  e ordenados alfabeticamente.

## [1.3.2] - 2026-08-25

### Corrigido

- O cabeçalho da PWA instalada preserva uma área segura acima da marca e dos
  controles em dispositivos de toque, inclusive quando o launcher sobrepõe a
  barra do sistema mas reporta inset superior zero. Os insets laterais também
  permanecem aplicados em paisagem, sem criar uma faixa artificial no desktop.

## [1.3.1] - 2026-08-25

### Corrigido

- Recarregar respostas canônicas 403 e 404 não deixa mais uma camada de splash
  inerte sobre a mensagem localizada. Navegações HTML removem cabeçalhos
  internos do App Router, e duplicatas do splash são eliminadas por identidade
  sem interromper a abertura original do documento.

## [1.3.0] - 2026-08-24

### Adicionado

- Coordenador único de navegação para links, formulários GET, histórico do
  navegador e redirecionamentos aceitos, exibindo o splash da marca durante a
  troca de tela com recuperação para falhas e navegação prolongada.
- Shell offline localizado e sem credenciais, com cache estritamente limitado
  a recursos estáticos públicos e exclusão explícita de páginas autenticadas,
  APIs, perfis públicos e respostas RSC.

## [1.2.0] - 2026-08-23

### Adicionado

- Fluxo de QA vivo compartilhado entre Claude Code, Codex e OpenCode, com
  personas, jornadas, cenários, charters, bugs, relatórios e execução por
  navegador real sem duplicar as skills entre os três harnesses.
- Gate axe cumulativo WCAG 2.0/2.1/2.2 AA integrado ao E2E isolado e testes dos
  conversores do tracker executados por `rtk pnpm check` e pelo CI.

### Corrigido

- O editor de currículo agora expõe um nome acessível, e contas desativadas não
  perdem contraste por opacidade aplicada ao card inteiro.

## [1.1.4] - 2026-08-23

### Corrigido

- A área segura da PWA agora ajusta somente o cabeçalho global, preservando o
  espaçamento vertical dos cabeçalhos internos, páginas e diálogos.
- Cockpit, Vagas e modais administrativos passaram a reutilizar o ritmo de
  espaçamento do `DESIGN.md`; o menu administrativo em inglês usa `Users`.
- A edição de conta fecha a modal apenas depois de persistir, anuncia sucesso,
  mantém a modal aberta em falhas esperadas e exibe o erro no idioma ativo.

## [1.1.3] - 2026-08-23

### Corrigido

- O diálogo de novidades agora estabelece altura dinâmica explícita antes de
  distribuir o espaço entre cabeçalho e lista rolável, evitando que o WebKit
  móvel reduza a coleção de versões a uma faixa recortada.

## [1.1.2] - 2026-08-23

### Adicionado

- Modal de novidades redesenhado como diálogo acessível com cards de versão,
  rolagem interna, abertura independente de múltiplas releases e reset para a
  versão mais recente a cada nova abertura.
- Edições localizadas do changelog em `USER_CHANGELOG.pt-BR.md` e
  `USER_CHANGELOG.en.md`, publicadas pelo mesmo instante UTC e exibidas no fuso
  local do dispositivo conforme o idioma ativo.
- Renderização de Markdown editorial por `react-markdown`, limitada a elementos
  seguros e sem imagens, HTML bruto ou protocolos de link perigosos.

### Corrigido

- Pipeline de release bilíngue preserva retomada pré-tag, valida coerência dos
  três changelogs e mantém o histórico legado sem inventar horários.

## [1.1.1] - 2026-08-22

### Infraestrutura

- O fluxo de execução do Compozy passou a isolar cada épico em worktree própria,
  abrir PR para `dev` e arquivar integralmente os artefatos de features já
  concluídas.
- A promoção de releases passou a serializar a reserva da versão e a retomar
  com segurança execuções interrompidas antes da criação da tag.

## [1.1.0] - 2026-08-21

### Adicionado

- **Score por candidato, derivado do currículo** (`M-06`). `job_score` sempre foi
  por candidato e o board sempre foi escopado, mas `candidate_matching_profile`
  estava vazia — as 8.768 pontuações de produção eram todas do candidato 1.
  `deriveMatchingProfile` troca as palavras-chave do perfil padrão pelo que o
  currículo evidencia; `keywords.negative` e `keywords.critical` ficam vazios, e
  restrição/remuneração/alvos continuam herdados.
- **Fila de repontuação por candidato** (`score_task`, ADR 0009). Salvar currículo
  enfileira a repontuação em vez de recalcular na hora. Índice único por
  candidato evita repontuar o acervo inteiro por três salvamentos seguidos.
  Comandos `jho jobs score --every-candidate` e `jho jobs rescore`.
- **Menu do celular** em dropdown abaixo de `sm`, com a linha inteira clicável —
  a fileira rolava na horizontal com scroll suprimido, sobrando um link visível.

### Corrigido

- **Falha do KDF** (`verifyPassword`) engolida pelo `catch` que tratava erro de
  formato: scrypt sob carga falhava por recurso e era reportado como "senha
  errada", contando para o limite de tentativas de quem digitou certo.

### Melhorado

- **Score em lote.** `scoreAll` fazia um `await` por vaga — 8.768 idas e voltas
  HTTP em série contra a Turso. `upsertScore` acumula cem gravações por `batch`.

### Infraestrutura

- **Retomada manual do guard de migração** na promoção `dev → staging`
  (`confirmar-migracao` no `workflow_dispatch`), documentando também o setting
  "Allow GitHub Actions to create and approve pull requests".
- **Skill deep-review** instalada nos três harnesses (symlink).

## [1.0.0] - 2026-08-21

Primeira versão em produção, em `jobs.mastertimm.com.br`. O `package.json`
esteve em `0.1.0` desde o primeiro commit; a marca de cache do service worker
deriva dela, então até aqui nenhum deploy invalidava cache — corrigido junto.

### Adicionado

- **Nome completo na conta** (`AUTH-05`). Coluna `auth_user.full_name`
  anulável, atravessando `Identity` e `Session` até o `session-badge`. Declarar
  o campo como obrigatório no tipo revelou quatro `select` de produção que não
  traziam a coluna — resolvedor de sessão, link mágico, senha e identidade.
- **Edição e exclusão de usuário** em modal de popover nativo, sem JavaScript de
  aplicação. A exclusão recusa a própria conta e o último admin ativo.
- **Pipeline de CI/CD** (`.github/workflows/`): portão de qualidade, verificação
  de sincronia entre `schema.ts` e `drizzle/`, migração por branch e varredura
  diária de vagas.
- **Varredura agendada** (`UI-03`). `varredura.yml` roda `jobs sync`, captura e
  reconferência contra produção. A rota de cron da Vercel processava 25 vagas
  por execução por causa do teto de 30 s do plano gratuito — ciclo de ~17 dias
  contra a meta de 7 de `enqueueStale`.
- **Tela de abertura** inline (`src/core/pwa/splash.ts`), com duração mínima,
  teto absoluto e saída imediata em navegador de automação.
- **Changelog no rodapé**, lido do markdown no servidor.

### Corrigido

- **Área segura da PWA.** `viewportFit: "cover"` estava declarado sem nenhum
  `env(safe-area-inset-*)` para compensar: no app instalado o relógio do sistema
  ficava sobre o nome do aplicativo e a bateria sobre o seletor de idioma.
- **`Number(id)` sem validação em onze comandos** (`B-06`). Os que consultam
  vazavam o `SELECT` inteiro num `DrizzleQueryError`; os que escrevem terminavam
  com código zero sem fazer nada, porque `where id = NaN` não casa com linha
  alguma.
- **`jho tasks done`** (`B-07`) aceitava status fora do vocabulário — a tarefa
  sumia das listagens — e reportava sucesso para id inexistente.
- **`jho dossiers`** (`B-08`) sem destino escrevia em `<cwd>/out/vagas`,
  relativo ao diretório de onde se rodou.
- **Cache do service worker** nunca invalidava: a marca vinha de
  `package.json.version`, fixa em `0.1.0`. Agora é versão + revisão do deploy.
- **Região das funções** movida de `gru1` para `iad1`, junto do banco.

### Infraestrutura

- Turso com três bancos (`master-jobs`, `-staging`, `-dev`) em `aws-us-east-1`,
  variáveis declaradas por branch.
- Três subdomínios na Cloudflare, sem proxy — a nuvem laranja impede a emissão
  do certificado pela Vercel.
- Cobertura de testes de 52 % para **97,7 %** de statements.
