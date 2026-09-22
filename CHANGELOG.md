# Changelog

Histórico técnico, para quem mexe no código. Os resumos em linguagem simples
exibidos no rodapé ficam em [`USER_CHANGELOG.pt-BR.md`](./USER_CHANGELOG.pt-BR.md)
e [`USER_CHANGELOG.en.md`](./USER_CHANGELOG.en.md).

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado

- Minha conta (`/account`, #236): qualquer papel troca a própria senha e o
  nome de exibição. A troca exige a senha atual, limita a 5 tentativas por
  conta em 15 minutos (tentativa gravada em `auth_event` antes de contada, para
  rajada concorrente não passar junta), derruba todas as sessões da conta e
  abre uma nova para o navegador que pediu; registra `password_changed` e
  `profile_updated`. Novas ações `account:read` e `account:write` na política;
  sessão emprestada lê, mas nunca escreve na conta do alvo. Troca de e-mail
  continua só com admin até haver confirmação por e-mail (`docs/security.md`).
  Link "Minha conta" no menu; rota nas guardas de inglês, largura e axe.

### Corrigido

- Recuperação de senha: em deployment sem `RESEND_API_KEY`/`RESEND_FROM`, o
  adapter de console imprimia o e-mail inteiro — com o link de reset, que é
  credencial — no log das funções da Vercel. `configuredMailer` passa a usar o
  console só em processo local (`isLocalProcess`, a mesma lista de permissão
  do modo aberto) e escolhe `withheldMailer` em qualquer outro ambiente e
  sempre que a chave está presente sem remetente: ele emite um
  alerta com `console.warn` sem destinatário, assunto nem link, e devolve falha,
  para o `auth_event` gravar `reset_send_failed`. O console com corpo completo
  fica restrito ao terminal local sem chave. Checklist humano de ativação do
  Resend em `docs/operations.md` (#237).

- Rede: `assertSafeRemoteUrl` recusa `linkedin.com`, `linkedin.cn`, `lnkd.in`,
  `licdn.com` e subdomínios antes do DNS, e `safeRemoteFetch` repete a
  recusa em cada redirect (regra 1, ADR 0001). URL de vaga vinda de alerta por
  e-mail já chegava à sonda de `jobs verify` e à captura de `scrape run`; agora
  a sonda fica `inconclusive` sem pedido e a captura bloqueia antes do
  `robots.txt` (e registra redirect para o LinkedIn como bloqueio final, sem
  nova tentativa). `getJson` não repete a recusa ao LinkedIn no laço de retry;
  falha de DNS continua sendo repetida.
  Testes com transporte instrumentado provam zero pedido ao LinkedIn (direto e
  por redirect), zero envio em `jho prep`/`buildDossier`, que `growth:` nunca
  vira evidência citada, e um inventário fechado de quem abre transporte de
  saída, com detector exercitado por casos positivos e negativos.

- Descarte de vagas (`jho db prune` e `jho db cleanup --apply`): uma candidatura
  criada enquanto o descarte rodava podia ser apagada em cascata junto com a
  vaga, porque o `DELETE ... WHERE NOT EXISTS (application)` avaliava o
  predicado antes de esperar o lock da candidatura. Os dois comandos passam por
  uma única função, `deleteClosedJobsWithoutApplication`, que trava as vagas
  (`FOR UPDATE`) e reconfere em comando novo. Corrida reproduzida com duas
  conexões reais em `tests/db-decision-integrity.test.ts`.
- `job.company_id` declara `onDelete: "no action"` explicitamente; o DDL não
  muda (nenhuma migration nova). `tests/fk-delete-intent.test.ts` passa a
  exigir política escrita em toda FK, e `cov-db-schema` ganhou o caso adverso
  de ação divergente em `pg_constraint`.
- Upgrade de banco populado provado: `tests/postgres-upgrade.test.ts` migra da
  0003 com dados até a versão atual, conferindo backfill, funil intacto,
  recusa de dado inconsistente, falha sem meia aplicação e retomada.
- Skill `drizzle-safe-migrations` e playbook reescritos para PostgreSQL
  (`drizzle/postgres/`, journal e `when`, transação única, locks, `migrate.yml`);
  `docs/engineering/deploy.md` deixa de proibir o `sslmode` que o código aceita.

- Operações: conexão restrita de produção configurada e validada antes do deploy; runbook corrigido para TLS, pooler e rotação recuperável. Ativação aguarda promoção humana.
- Tela de erro de rota (403, 404 e falha de navegação): o painel começa logo abaixo do cabeçalho em vez de centralizar numa caixa de `100dvh` que o empurrava para baixo da dobra, e o botão "Voltar ao início" centraliza o texto (`inline-flex`), em vez de deixá-lo colado no topo.

### Segurança

- Inventário de entradas (#197): toda página, Route Handler (por método) e
  export de módulo `"use server"` — em qualquer forma e nome de arquivo — é
  descoberto pela semântica do Next e precisa de política ou exceção
  registrada com justificativa; entrada nova sem classificação e exceção órfã
  reprovam. `logoutAction`, `setLocaleAction` e `setAppearanceAction` passam
  a constar como exceções. `tests/entry-denial.test.ts` chama cada action com
  sessão ausente, forjada, expirada, revogada e de conta desabilitada, ids da
  vítima e sessão emprestada, e exige recusa sem escrita, cookie, revalidação,
  `after()` ou rede.
- `JHO_AUTH_MODE=open` só vale na máquina local: em deployment (`VERCEL`
  presente, ou `VERCEL_ENV`/`JHO_ENV` diferente de `local`) o pedido é ignorado, em
  sessão e em `proxy.ts`, pela mesma função de domínio.
- O CV publicado em `/p/[slug]` com os dois consentimentos passa por
  `publicCvText()`: e-mail, telefone com código de país ou DDD entre
  parênteses e o bloco inteiro (parágrafo, item ou tabela entre linhas em
  branco; a seção, quando é título) que traz rótulo de pretensão salarial ou
  palavra de remuneração perto de um valor são retirados. Detecção por padrão, com limite declarado e testado.
- `/recruiter/[candidateId]` autoriza a leitura por `requirePage("candidate:read")`
  depois do vínculo, em vez de decidir fora da política.
- Teste de concorrência: dois resgates simultâneos do mesmo link de
  recuperação trocam a senha uma vez só.

### Alterado

- O overlay opaco de navegação passa a ser só da troca de rota (#220). Filtro,
  ordem, página e densidade em `/jobs` (mesmo `pathname`) viram transição
  suave: `NavigationTransition.soft`, decidido em `transitionStore.begin` por
  `isSameScreenNavigation`, sem overlay nem `inert`; o shell recebe
  `aria-busy` e `data-navigation="soft"`, o `<main>` esmaece por CSS depois de
  120 ms e um aviso `role="status"` usa `transition.updating`. O ciclo do
  store não muda (mínimo de 180 ms, saída e reset): no voltar/avançar o
  roteador confirma a URL antes de o conteúdo chegar, e encerrar no commit
  anunciaria pronto sobre a lista anterior. Na saída o conteúdo volta à
  opacidade plena e `aria-busy` cai no reset. `prolonged` e `offline`
  promovem ao overlay. O E2E passa a afirmar o estado suave nas sete navegações de
  filtro, densidade, tamanho, página e preset.

## [1.21.1] - 2026-09-22

- A tela de vagas calcula lista e total em uma seleção de ids antes de carregar os dados da página, evitando repetir filtros e agrupamento. Páginas além do fim mantêm o total por uma contagem de fallback; o benchmark pode registrar todos os planos com `JHO_PERF_PLANS=1`.

- As facetas do quadro passam a ler o conjunto elegível uma vez e devolver contadores, clusters e fontes em uma consulta, preservando a primeira publicação elegível de cada dimensão e o isolamento por candidato.

## [1.21.0] - 2026-09-22

### Adicionado

- Ferramentas: gestão canônica de tarefas pelo GitHub Project, com CLI remota,
  claims e recibos assinados, revisão/geração, recuperação de operações,
  projeções Compozy descartáveis e gate de vínculo de PR. Escritor em main e
  enforcement dependem do provisionamento e piloto documentados em #191.

## [1.20.9] - 2026-09-22

- Governança: SLOs internos, orçamento de erros e resposta a incidentes definidos; adicionados sonda pública e relatório de métricas DORA com cobertura explícita e histórico por artefatos.

## [1.20.8] - 2026-09-22

### Corrigido

- Promoção para staging vinculada ao SHA aprovado pelo CI, inclusive no
  dispatch. O commit de release passa pelo mesmo CI antes da tag e do
  fast-forward; retentativas preservam o alvo após avanços de dev e a guarda
  de migrações compara o intervalo desse alvo. Um candidato reprovado pode ser
  substituído por uma nova entrada aprovada, sem validar ou etiquetar o anterior.
  A base do versionamento fica registrada por SHA para resistir a tags tardias.
  A PR de produção atualiza sua proveniência e preserva anotações humanas.

## [1.20.7] - 2026-09-22

- Operações: alerta Sentry configurado para erros novos, regressões e alta prioridade em produção, com e-mail para o responsável e intervalo de 30 minutos; disparo validado com canário sintético.

### Alterado

- Novidades são compiladas no build: parsing dos dois históricos e conversão
  segura de Markdown para HTML saem das requisições e do bundle cliente.
  O artefato gerado é privado, selecionado por idioma depois da autenticação,
  e substitui os Markdown no pacote standalone. O modal monta os cards ao abrir
  e os corpos ao expandir; conteúdo, datas locais e interação permanecem iguais.
  Geração determinística e E2E sem os arquivos de origem cobrem o contrato.

## [1.20.6] - 2026-09-22

### Melhorado

- A leitura salarial do quadro compartilha a normalização entre o filtro e a
  escolha da publicação do grupo; a ordenação sem faixa calcula somente as
  linhas participantes. As cotações deixam de ser expandidas em cada uso da
  expressão, preservando valores, ausências, ordem e paginação.
- O benchmark de buscas aceita `JHO_PERF_RUNS`, `JHO_PERF_WARMUPS` e
  `JHO_PERF_JSON` para guardar amostras, volume de SQL, parâmetros, resultados
  de referência e planos `EXPLAIN ANALYZE`.

## [1.20.5] - 2026-09-22

### Corrigido

- Primeiras capturas simultâneas de uma plataforma não falham mais ao criar
  a fonte `~terms`: o insert trata conflito tanto no id quanto no índice único
  de plataforma e handle. A regressão exercita dois consumidores com a primeira
  criação alinhada e confere estado, tentativas e motivo de cada captura.

### Alterado

- Deployments automáticos da Vercel restritos a `main`, `dev` e `staging`.
  Branches de tarefa continuam no CI do GitHub, sem criar previews e consumir
  a cota de builds dos ambientes. A lista de permissão fica em `vercel.json`.

## [1.20.4] - 2026-09-21

### Alterado

- **A função da Vercel passa de `iad1` para `gru1`, ao lado do banco.** O banco
  Supabase está em `sa-east-1` (São Paulo) e as funções rodavam na Virgínia: o
  `x-vercel-id` de produção era `gru1::iad1::…`, e cada ida ao banco atravessava
  o continente sem erro nenhum. `docs/engineering/deploy.md` dizia
  `aws-us-east-1` — sobra do Turso —, e foi corrigido. `PRODUCTION_POOLER_HOST`
  passa a ser exportado de `production-target.ts` para o teste cruzar as duas
  regiões.
- **A sessão é resolvida uma vez por requisição, e só em produção deixa de
  buscar o candidato padrão.** `currentSession()` rodava 3× por carga (layout,
  `SessionBadge`, página), cada uma com `getCandidate()` seguido de
  `resolveSession()`, e o candidato padrão só serve ao modo aberto. `renderSession`
  (`cache()` do React) atende layout, badge e `requireSession`; `guard*` e as
  ações continuam em `currentSession`, sem cache, porque impersonação e troca de
  senha mudam a sessão no meio da requisição.
- **`/jobs` faz de 8 a 10 consultas, não de 10 a 12, e o prelúdio caiu de 5–6
  esperas em série para 1.** Trilhas e câmbio saem em paralelo; `trackScope` e
  `resolveClusterFilter` aceitam a lista de trilhas já lida (antes repetiam
  `listTracks`); `loadLatest` do câmbio virou uma consulta com subconsulta, em
  vez de duas em série; os termos salvos viajam ao lado da contagem escondida
  por faixa. Sempre no máximo duas consultas por estágio, para não furar o teto
  `POOL - 1`.
- **A lista de vagas não calcula mais o tamanho da descrição.** `length()` obriga
  o PostgreSQL a descomprimir o texto inteiro (TOAST) de cada vaga aberta, antes
  do `LIMIT`, para a interface só perguntar se há menos de 200 caracteres.
  `substr(descricao, 200, 1) <> ''` responde o mesmo — idêntico em 199, 200 e 201,
  com acento, emoji, vazio e nulo — e só lê o início: 103 ms → 26 ms na contagem
  do acervo local. A linha do quadro troca `descriptionLength: number` por
  `hasFullDescription: boolean`, e o filtro `hasDescription` e a faceta
  `described` usam o mesmo predicado.

### Adicionado

- **Medição de latência das buscas.** `pnpm perf:jobs` roda 6 cenários de `/jobs`
  (padrão, termo, cluster, faixa salarial, ordenar por pagamento, sem agrupar)
  sobre 10 mil vagas num PostgreSQL hermético e diz o tempo e o número de idas ao
  banco; fica fora do `pnpm check` e `JHO_PERF_OUT` guarda o relatório. Em
  produção, `/jobs` e `/` registram uma linha JSON com rota (sem query string),
  total, região e tempo por estágio quando passam de 1 s, ou sempre com
  `JHO_PERF_LOG=1`. `Server-Timing` não serve a páginas: Server Components não
  escrevem cabeçalho. A análise está em `docs/engineering/performance-buscas.md`.

### Corrigido

- **No celular, um termo salvo longo cortava os controles do próprio cartão.**
  Um termo de uma palavra só, no limite de 60 caracteres, deixava o cartão dele
  em Buscas mais largo que a trilha: APAGAR aparecia só pela borda, e "mover
  para" e MOVER saíam da tela. O cartão é um grid sem `grid-cols-1`, e o nome do
  termo usava `break-words`, que não reduz a largura mínima do conteúdo — a
  coluna implícita crescia até a largura do termo. É o
  `BUG-20260919-mobile-searches-overflow` de volta por outro gatilho: a correção
  de 19/09 tinha tratado a trilha e o rótulo do intervalo. A mesma semente
  mostrou o gêmeo em Vagas, no chip "trazida pelo termo" a 320 px: o chip herda
  `shrink-0` e `whitespace-nowrap` do botão. Agora o cartão tem coluna mínima
  0, o termo e o título da trilha quebram em qualquer ponto, e os chips com
  texto do usuário (trilha e termo) quebram linha. Achado pelo QA de jornada de
  Buscas; `tests/e2e/setup.mjs` semeia o termo longo, e a varredura de larguras
  reprovava sem a correção.

### Testes

- **A região das funções é travada contra a do banco, e o número de consultas de
  `/jobs` é contado.** `tests/function-region.test.ts` deriva a região do host do
  pooler de produção e exige que `vercel.json` fixe a vizinha — com `iad1` ele
  reprova. `tests/db-fan-out.test.ts` ganhou `queriesOf` e afirma que trilhas e
  câmbio são lidos uma vez cada: a régua de pico de conexões não enxerga
  round-trip, porque cada consulta cabe no teto e a soma em série ainda é lenta.
  Ambos foram confirmados contra o código antigo. Também entram
  `tests/auth-render-session.test.ts`, `tests/stage-timer.test.ts`, as bordas
  199/200 de descrição em `tests/jobs-board.test.ts` e o caso do câmbio em
  `tests/fx-context.test.ts` (data mais recente **da base pedida**, e uma consulta).
- **O tracker de QA passa a ser validado em todo `pnpm check` e no CI.**
  `docs/qa/state.csv` é visão gerada e ignorada pelo git, então o esquema dos
  cenários só era conferido quando alguém rodava `materialize_state.py` de
  propósito — e a primeira execução em semanas, na 1.20.3, achou 15 registros
  inválidos. `pnpm check:qa-tracker` roda o validador sem gerar bytecode, entra
  no `pnpm check` e ganha passo próprio no job `qualidade`, que roda os gates um
  a um. Custa menos de um segundo. `tests/qa-tracker-gate.test.ts` impede que o
  gate saia de um dos dois sem alguém perceber, e `__pycache__/` entra no
  `.gitignore`.

### Documentação

- `docs/engineering/performance-buscas.md` registra o diagnóstico de latência das
  buscas (o que foi medido e o que foi inferido), o baseline antes e depois, o
  plano por fases e as decisões de não adotar `cacheComponents` nem Redis agora.
  `docs/operations.md` ganha "A busca está lenta" em Troubleshooting.
- Duas afirmações da 1.20.3 corrigidas, apontadas pela última rodada da revisão
  profunda da PR #170. Os seis cenários em `retest_status: pending` são dois
  com bug `fixed` nunca re-percorrido e quatro cujo reteste antecede a mudança de
  superfície — não três e três. E o registro de regressão do
  `BUG-20260921-job-detail-labels-untranslated` dizia que devolver
  `Ver vaga na origem` ao JSX não reprovaria; depois da correção o texto é valor
  do dicionário e reprova, enquanto a chave existir.
- Backlog: `B-12` (snapshot do Turso) fica **superado** — marca nova ⏹️ —,
  porque o runtime saiu do Turso no corte de 19/09. `B-11` volta a **decisão**:
  a cota que o motivou não existe mais, mas `enqueueStale()` ainda calcula o fit
  por linha, o sync ainda fecha por ausência as janelas parciais, e o cron da
  Vercel continua definido em `vercel.json` — desabilitado desde 03/09, mas a
  um PATCH de voltar a disputar o recheck com o workflow `Varredura de vagas`.
- `AGENTS.md` mostrava 1.609 testes na tabela de estado; são 2.968, mais 263
  verificações E2E, e a cobertura já inclui `cli.ts`. `README.md`,
  `docs/operations.md` e `docs/architecture.md` descreviam o `pnpm check` como
  "typecheck + testes" e passam a listar os gates de changelog e de QA.

## [1.20.3] - 2026-09-21

### Corrigido

- **A tela de detalhe da vaga servia três textos de interface em português com a
  interface em inglês.** `← vagas`, `Ver vaga na origem` e `visto em` eram
  literais no JSX de `app/jobs/[id]/page.tsx` — regra 9 —, e mais três estavam no
  mesmo arquivo em ramos condicionais: `fechada`, `Aplicar →` e
  `de 100 · cluster`. Passam pelas chaves novas da seção `jobDetail` nos dois
  dicionários. Os dois rótulos do cartão de score, `casadas:` e `ausentes:`,
  escaparam do primeiro inventário — só aparecem para quem tem score, e o QA
  percorreu a tela como recrutador — e passam pelas chaves que `/compare` já
  usava, `compare.matchedKeywords` e `compare.missingKeywords`.

  Não é regressão: estão ali desde que a tela existe. O que faltava era medição.
  A varredura de inglês percorre **listas literais** de rotas em
  `tests/e2e/ui.mjs`, e `/jobs/<id>` — a tela mais aberta do produto — nunca
  entrou nelas. Já é a terceira rota descoberta assim.

  E ela não podia entrar como estava: o nome da empresa, a localização e o rótulo
  da fonte vêm do acervo e são acentuados de direito, então sem
  `data-user-content` a varredura reprovaria `São Paulo, State of São Paulo,
  Brazil` como tradução esquecida. A correção faz as duas coisas: marca os três
  campos e põe a rota nas duas varreduras.

  A lista é necessária, não suficiente. A varredura só reprova texto acentuado ou
  que já é valor do dicionário português: dos seis literais, só `← vagas` seria
  pego, e porque já existia como `jobCountries.back`. `Ver vaga na origem` e
  `visto em` passariam mesmo com a rota listada.

- **O seletor de etapa do funil na tela de detalhe não tinha nome acessível.** O
  rótulo visível `mover para` era um `<span>` solto, e o `<select>` do
  `TrackForm` saía sem nome para leitor de tela — `select-name`, WCAG 2 A. Ganhou
  `aria-label` com o mesmo texto. Só a visão do dono renderiza o formulário.

### Testes

- `/jobs/904000103` entra nas **quatro** listas de guarda transversal: as duas
  varreduras de vazamento de português e a de largura real em `tests/e2e/ui.mjs`,
  e a varredura axe de `tests/e2e/a11y.mjs` (contagem `9/9` → `10/10`). É a
  publicação de São Paulo do grupo de países, escolhida por ser acentuada: numa
  localização sem acento, tirar `data-user-content` não reprovaria nada. A
  fixture ganhou palavras-chave casadas e ausentes para que as duas linhas do
  cartão de score renderizem sob a varredura.

  A medição que precedeu a entrada (0px de excesso em 375, 768 e 1024 px, zero
  violações axe) foi feita como recrutador, que não vê o formulário de funil. A
  varredura axe roda como dono, e ali o `select` sem nome reprovaria — o achado
  veio da revisão profunda, e a correção está acima.

- **O tracker de QA não materializava, e o validador só roda sob demanda.**
  `docs/qa/state.csv` é visão gerada e ignorada pelo git, então o único jeito de
  o esquema ser conferido é alguém rodar `materialize_state.py` de propósito —
  e **15 registros inválidos em 15 arquivos** mostram há quanto tempo ninguém
  rodava. Oito tinham `retest_status: verified`, valor que não existe no enum;
  quatro mantinham `retest_status` preenchido — um `pass` e três `verified` —
  depois de a superfície mudar e `qa_status` voltar a `untested`; três
  afirmavam `pass` sem apontar evidência; dois afirmavam `fixed` sem SHA; dois
  usavam `qa_status: blocked`, também inexistente. Todos corrigidos conforme o
  esquema. Seis cenários devem reteste e ficam em `retest_status: pending`:
  dois com bug `fixed` nunca re-percorrido, e quatro cujo reteste antecede uma
  mudança de superfície — três com bug `verified` e um com bug `fixed`. Vazio, no esquema, quer dizer
  "reteste dispensado", e veredito de uma tela que mudou não vale; a história
  continua no relatório que `last_report` aponta. A visão volta a gerar: 56 cenários,
  zero erros.

### Documentação

- `AGENTS.md` afirmava "sete telas em inglês" e são treze. O número saiu de
  cima: o que vale é que as listas são literais, e agora a regra 9 diz que a
  lista decide o que é medido, que os dois critérios só reprovam literal
  acentuado ou já presente no dicionário, e por que rota nova entra nas listas
  no mesmo commit que a cria.
- QA de jornada: `JOBS-detail-owner-view-english` nasce `untested` para a parte
  da tela que só o dono vê — cartão de score e seletor de etapa —, que a persona
  recrutadora não alcança.
- QA de jornada: `JOBS-english-keeps-posting-data` fecha em **Pass** —
  `docs/qa/reports/2026-09-21-execucao-ingles-detalhe.md`,
  `docs/qa/bugs/BUG-20260921-job-detail-labels-untranslated.md` e a carta
  `CH-recruiter-english-board`. A jornada `J-trust-the-filtered-board` fica em
  oito Pass e quatro bloqueados, **nenhum `untested`**.

## [1.20.2] - 2026-09-21

### Corrigido

- **`applyUrl` vazio chegava ao dossiê da varredura como link vazio.** O endereço
  que o revisor recebe era montado com `row.applyUrl ?? row.url`, e `??` não
  protege contra string vazia — a regra 17 deste repositório, a mesma que já
  apagou 4.538 descrições. Várias fontes devolvem `""` para campo que não
  preencheram, então uma vaga com `applyUrl: ""` produzia `url: ""`, e um
  `<a href="">` recarrega a página em que o revisor está em vez de abrir a vaga.
  Passa a usar `firstNonEmpty()`, a função criada neste repositório para isso.

- **`src/cli.ts` importava a tabela `source` e nunca a usava.** Nas linhas 698-699
  o nome é parâmetro de callback e sombreava o import. Import de valor morto,
  removido — e é a remoção que torna possível afirmar, por teste, que nenhum
  leitor de saúde de fonte monta consulta própria.

- **A localização da vaga passa a ser marcada como dado do usuário.** Ela vem do
  acervo — "São Paulo, State of São Paulo, Brazil" tem acento e continua tendo com
  a interface em inglês —, e sem `data-user-content` a verificação de vazamento de
  português acusa dado que nunca foi tradução. Faltava em dois lugares: na linha
  da lista, quando a vaga não é agrupada, e no popover da vaga, que está no DOM
  mesmo fechado e portanto aparece em TODA tela com lista.

  Os dois só apareceram porque `/jobs/<id>/paises` entrou nas varreduras: nenhuma
  das rotas varridas antes tinha fixture com acento na localização. Guarda nova
  achou dois defeitos no primeiro uso.

### Adicionado

- **`/jobs/<id>/paises` entra nas quatro guardas transversais.** Cada uma é um
  array literal de caminhos — as duas varreduras de vazamento de português, a
  medição de largura real em 375/768/1024 px e a varredura axe —, então **rota
  nova não herda nenhuma delas** até alguém editar as quatro. O hub existia desde
  a 1.19.0, com quatro chaves de dicionário só dele, e estava fora de todas.
  A varredura de acessibilidade passou de 8 para 9 páginas.

- Testes para as lacunas que a revisão profunda nomeou e que passavam em silêncio:

  - `E2E-012` coletava a bandeira e a contagem por país e **afirmava só o
    rótulo**: marca vazia, bandeira do país errado, ou a soma das duas cidades
    brasileiras perdida passariam. Agora as três são afirmadas.
  - O teto do filtro salarial estava preso por `10000001` — o limite ANTIGO de dez
    milhões, que continua inválido por estar acima do novo: o caso passava pela
    razão errada. `UT-070` prende 2.000.000 pelos dois lados da borda.
  - `ungrouped` não tinha teste em nenhum nível, e o título do caso de round-trip
    dizia "every new parameter". `UT-071` cobre o parâmetro que carrega a exceção
    e não a regra, inclusive que só `1` desliga e que o link não o escreve à toa.
  - `UT-072` e `UT-073` prendem duas correções da 1.20.1 que subiram sem teste:
    `?pay=%20` é campo vazio e não erro, e as duas faixas invertidas avisam uma
    vez só.
  - O adapter do vigia de timeout — o que decide se algo é **realmente** enviado —
    não tinha teste; os cinco casos existentes cercavam a função pura. Cinco casos
    novos, incluindo o que importa em produção: sem `SENTRY_DSN`, e com DSN em
    branco, nada é enviado.

## [1.20.1] - 2026-09-21

### Corrigido

- **O 504 não estava consertado, e a régua verde era o motivo.** A 1.18.2
  apertou o teto de conexões para `POOL - 1` e corrigiu três **funções** —
  `loadSkillsScreen`, `trackOverview`, `trackSuggestion`. Mas
  `tests/db-fan-out.test.ts` mede função, e tela não é função: quem compõe as
  leituras no corpo do Server Component fica fora da régua por construção. As
  três telas que faziam isso eram justamente as maiores.

  | Tela | Consultas em voo antes | Pool |
  |---|---:|---:|
  | `/` (cockpit, rota da PWA e do pós-login) | 7 | 3 |
  | `/jobs` (a tela mais aberta) | 5, e 6 com faixa salarial | 3 |
  | `/searches` | 4 | 3 |

  `boardFacets` sozinha eram três consultas simultâneas — o pool inteiro dentro
  de uma leitura, antes de qualquer chamador somar. E `loadRates()`, que são
  duas consultas sem cache, ia quatro vezes ao banco na mesma requisição de
  `/jobs`, porque cada leitura que normaliza pagamento buscava o câmbio por
  conta própria.

  A correção segue o padrão que `app/candidate/skills/data.ts` já tinha: a
  composição sai da página e vira função, onde o teste alcança. Nascem
  `app/cockpit-data.ts` e `app/searches/searches-data.ts`, `loadJobsView`
  serializa em pares, `boardFacets` pica em dois, e `BoardFilters.rates` deixa
  quem já carregou o câmbio passá-lo adiante. Três casos novos no teste de
  leque, um por tela — e o de `/searches` foi visto vermelho em 3 antes de
  passar.

- **O vigia de 22 segundos começava depois da autenticação.**
  `requireOwnCandidatePage` já vai ao banco, e a espera por conexão atinge a
  PRIMEIRA consulta da requisição. Travando ali, o temporizador nem era armado;
  e se o trecho anterior comesse oito segundos, o aviso era agendado para
  depois dos 30 e o processo morria antes. Agora ele envolve a requisição
  inteira, e passa a existir também em `/` e `/jobs`, que não tinham nenhum —
  as duas telas do quadro podiam travar sem deixar rastro.

- **O número do cockpit contava um quadro que o cockpit não mostra.** Ele saía
  de `facets.total`, e as facetas anulam cada dimensão na própria contagem de
  propósito, então respondem outra pergunta. Com `/?company=Acme` a lista
  filtrava e o número ficava no total sem filtro; e com agrupamento ligado por
  omissão os dois já divergiam sem ninguém tocar em nada. Passa a vir de
  `countBoard`, que é de onde `/jobs` sempre tirou o dele: a mesma pergunta não
  pode ter duas respostas em duas telas. Os chips também passam a receber
  `groupRepeats`, senão um chip mostrava número maior que o total ao lado.

- **Os chips de filtro e o rodapé contavam coisas diferentes.** Ver acima: sem
  `groupRepeats` nas facetas, o rodapé contava grupos e os chips contavam
  publicações.

- **Fonte que oculta o empregador não agrupa mais.** A chave do grupo é (ATS,
  título, empregador), e no Jobgether — 92% do acervo — dois dos três desabam:
  `company_name` é o rótulo da própria fonte, porque a API não devolve a empresa,
  e o primeiro elemento é `lever`, o ATS e não o board. Sobrava o título, então
  duas vagas de empresas **parceiras diferentes** com o mesmo título viravam a
  mesma vaga em dois países: a de id maior saía do quadro, e o hub apresentava o
  empregador de uma como o segundo país da outra. A chave ganhou um quarto
  elemento que torna cada publicação anônima o próprio grupo — com `''` e não
  `null`, porque `null = null` não é verdade em SQL. O discriminador já existia
  no arquivo; só o agrupamento não perguntava.

- **Grupo cuja publicação de menor id é cortada por um filtro não desaparece
  mais.** `canonicalOfGroup` era um anti-join que não conhecia `minFit`,
  `hideBlocked`, `term` nem `freshDays` — esses moram no `where` de fora. Quando
  a de menor id falhava um filtro, TODAS as irmãs falhavam o teste de canônica e
  o grupo inteiro saía do quadro, com uma irmã casando tudo; e como `countBoard`
  compartilha o predicado, o rodapé concordava com a lista e nada parecia
  errado. O gatilho era a tela padrão: agrupamento ligado e corte em 45, com geo
  valendo 15 dos 100 pontos. Virou `row_number()` sobre o conjunto já filtrado,
  então filtro novo entra sem precisar ser repetido na escolha.

- **O `+N` da fileira de bandeiras leva ao hub**, não à publicação canônica —
  que é o menor id do grupo e portanto o mesmo destino da primeira bandeira.
  Pedir "os outros 34 países" abria a vaga na Holanda, exatamente o "país que
  ninguém pediu" que o hub existiu para remover.

- **Publicação sem localização nenhuma não é mais um link vazio.** A coluna é
  nulável e a ingestão grava `null` sem normalizar; `groupByCountry` devolve
  `name: ""`, e a apresentação usava isso cru — âncora de zero caractere, com
  `title=""` e `aria-label=""`, invisível e sem nome acessível, ainda ocupando um
  dos oito lugares visíveis. Ganhou rótulo do dicionário. A decisão do que
  mostrar e para onde ir saiu do JSX e virou `countryRow` em `src/core/country.ts`,
  função pura, porque nenhuma das duas era alcançável por teste onde estava.

- **Campo de faixa guardava o valor antigo depois de navegação suave.** `useState`
  só lê o inicializador na montagem, e as ilhas eram montadas sem `key`: ir de um
  filtro para outro reconcilia a mesma posição da árvore e não remonta. Três
  caminhos do fluxo normal chegavam nisso — faixa invertida trocada no servidor,
  o "limpar", e os presets de corte —, e em todos o Aplicar seguinte reenviava o
  valor velho, então o aviso nunca saía e a URL nunca estabilizava. O campo de
  piso que existia antes tinha exatamente esta guarda, com o comentário
  explicando por quê; ela saiu junto com o campo. Vale também para as marcas do
  combo de fontes, que são DOM não controlado.

- **O filtro de fonte casava por `like`, então `%` ou `_` no parâmetro alargava
  o filtro.** O valor sempre viajou como parâmetro, logo nunca houve injeção —
  mas metacaractere de `like` dentro de um parâmetro continua sendo
  metacaractere, e a fonte é texto livre lido da URL. `?source=%` montava
  `like '%:%'`, que toda `source_id` casa: o chip aparecia como filtro ativo e o
  quadro mostrava tudo. `?source=_ever` escolhia uma fonte que ninguém marcou.
  Virou igualdade sobre `split_part`, o mesmo recorte que lista as fontes no
  combo — é a regra do vizinho `strpos`, que já raciocinava sobre isso três
  linhas abaixo.

- **Âncora fechada não nomeia mais o grupo.** O contrato de `sameGroupAs` diz
  que o link vale enquanto a publicação que ele nomeia está aberta e dá 404
  quando ela fecha; faltava o predicado. Linha fechada continuava sendo linha, o
  `exists` casava, o filtro de fora derrubava só a âncora, e a página caía na
  primeira irmã: cabeçalho, contagem e lista descrevendo OUTRA publicação sob a
  URL que a pessoa tinha salvo.

- **O hub não diz mais "publicada em 1 países".** O plural estava fixo na frase
  e o número contava marcas, não países — duas cidades do mesmo país davam "1
  países", e um país mais uma localização que não resolve dava "2 países" duas
  linhas acima de "1 sem país identificado". Agora conta só marca com país, e há
  frase para um país e para nenhum. Grupo que encolheu para uma publicação
  redireciona para a tela dela, em vez de virar uma cópia pior do detalhe.

- **O resumo "publicada em N países" não era anunciado.** Ele existia só como
  `aria-label` de um `<span>`, cujo role implícito é `generic` — e ARIA proíbe
  nome acessível nesse role, então o rótulo era descartado. A varredura não
  pegava porque `aria-prohibited-attr` devolve *incomplete*, e não violação,
  quando o elemento tem texto dentro. Ganhou `role="group"`.

- **O chip "ainda não enviadas" aparecia sem escopo de candidato.** Era a única
  das quatro fileiras dependentes de funil fora do portão. Para recrutador ou
  admin puro, o chip não filtrava nada — `repo.ts` ignora `hideApplied` sem
  candidato, de propósito — e o contador anunciava o acervo inteiro, porque somava
  `appliedAt is null` sobre um join que nunca casa. Clicar escrevia `notApplied=1`
  em todo link seguinte e a lista nunca mudava.

- **O campo de piso salarial aceitava 0**, valor que o leitor da URL recusa com
  aviso: digitar `0` (ou usar a seta para baixo do campo numérico) produzia "o
  valor precisa ser um número inteiro de 1 a 2.000.000" para um valor que o
  próprio controle acabara de oferecer. O campo anterior tinha `min={1}`; a
  restrição não veio junto na mudança para o componente compartilhado. No Score o
  piso segue 0, que ali significa "toda nota".

- **O aviso de faixa invertida saía duas vezes.** As duas faixas compartilham a
  chave do dicionário e empilhavam sem conferir, então
  `?fit=80&fitMax=20&pay=5000&payMax=1000` imprimia a mesma frase duas vezes,
  com dois irmãos de mesma `key` do React. É a guarda que o `pay_invalid` doze
  linhas abaixo já usava.

- **`?pay=%20` dizia "valor inválido" em vez de "sem piso".** `bound()` decidia
  se havia valor sem aparar, sendo o único leitor do módulo que não aparava — e
  agora governa dois parâmetros em vez de um. Campo vazio é escolha, não erro.

- **Nome de lugar americano que também é nome de país resolvia para o país
  errado.** A tabela do ICU é a lista completa de países, então dentro de uma
  localização composta o trecho vencia: `"Peru, Indiana"` virava Peru,
  `"Mexico, Missouri"` virava México, `"Lebanon, NH"` virava Líbano. Quando outro
  trecho nomeia um estado americano, o texto prova sozinho que o lugar é nos EUA,
  e o nome ambíguo deixa de decidir. `"Lima, Peru"` continua sendo o Peru.
  Fica de fora `"Atlanta, Georgia"`, onde o único candidato é também o estado e
  nada mais no texto prova nada — separar exigiria tabela de cidades, e a forma
  com o país no fim já acerta.

### Removido

- `GET /api/diag-skills`, a rota que mediu o 504 de dentro do runtime da Vercel.
  Ela se declarava temporária — "sai junto com a correção" — e a correção subiu
  na 1.18.2. Ficar era dívida com três defeitos próprios: `session.candidateId
  ?? 1` fazia um admin sem papel `candidate` ler o candidato 1, que é
  exatamente o que a política nega de propósito; sete passos de sete segundos
  somavam 49 contra os 30 da função, então no pior caso ela não devolvia nada;
  e o texto cru da exceção voltava no corpo sem `redactSecrets`, numa rota que
  se abre justamente quando o banco está ruim — e falha de conexão do
  `postgres` carrega a URL com senha.

### Alterado

- **`deep-review`, `qa-report`, `qa-execution`, `agent-output-audit` e `ship-pr`
  passam a ser invocáveis por agente.** O `disable-model-invocation` saiu do
  frontmatter das cinco.

  O custo do bloqueio apareceu em 2026-09-20: sete PRs seguiram para produção
  sem revisão profunda porque a única pessoa que podia rodá-la estava ocupada
  com o resto. Gate que só um humano dispara não é gate — é fila.

  A garantia que importa nunca foi quem aperta o botão: é a skill recusar
  aplicar correção. Ela revisa e relata; quem corrige decide o que aceitar. Isso
  continua igual, e publicar na PR continua exigindo `--publish`.

## [1.20.0] - 2026-09-20

### Adicionado

- **Um aviso ao Sentry antes de a Vercel matar a função.** O pior defeito deste
  sistema era o único invisível: `FUNCTION_INVOCATION_TIMEOUT` encerra o
  processo aos 30 segundos, o código não lança exceção, nada é reportado, e o
  registro da plataforma traz uma linha só. Foi assim que o 504 de
  `/candidate/skills` conviveu com um Sentry limpo enquanto a tela estava
  quebrada.

  Aos 22 segundos o processo ainda está vivo e consegue falar. `warnIfSlower`
  é domínio puro com porta de relato — o relógio entra injetado porque aqui o
  tempo é a decisão —, e `app/timeout-watch.ts` é o adapter que liga isso ao
  SDK. Ele não corrige nem interrompe nada: faz o travamento deixar rastro, e
  o rastro nomeia a rota.

  Está nas duas telas que já devolveram 504 por disputa de conexão. O aviso
  leva o caminho e deixa a query string para trás, pela mesma peneira do relato
  de erro: o caminho responde "onde travou", a query responde "o que a pessoa
  procurava".

### Corrigido

- Cobertura: `src/core/triage/job-sweep.ts` estava em 0% e é fronteira de
  segurança — o snapshot é o único canal pelo qual descrição de terceiro chega
  ao agente revisor. `src/core/ingest/health.ts` estava em 50%. Adapters
  ganharam o caso de resposta magra, que é a regra 8 aplicada à ingestão.
  Branches de 91,18% para 91,65%; statements de 95,59% para 95,90%.

## [1.19.0] - 2026-09-20

### Adicionado

- **`/jobs/<id>/paises`: o hub da vaga publicada uma vez por país.** A linha
  agrupada representa N publicações, e o clique entregava uma — a de menor id,
  que é escolha de ordenação e não de produto. Quem clicava em "Engineering
  Manager" com sete bandeiras abria a vaga na Holanda sem ter pedido a Holanda.

  A âncora da URL é **qualquer publicação do grupo**, não um id de grupo: o
  agrupamento é de apresentação e não existe registro para apontar. O link vale
  enquanto aquela publicação estiver aberta e devolve 404 quando ela fecha, que
  é a resposta honesta — a regra 3 guarda o registro, não a vitrine.

  O hub é a própria lista de Vagas filtrada pelo grupo, sem agrupar, então cada
  país traz a nota, o salário e o estado no funil que podem divergir entre eles.
  `BoardFilters` ganhou `sameGroupAs`, que entra em `boardConditions` como todos
  os outros filtros.

### Alterado

- **Regra 23: o changelog conta o que mudou; `docs/` conta como é agora.** São
  perguntas diferentes, e só o changelog deixa a segunda envelhecer em silêncio
  — quem chega depois lê uma pilha de "foi alterado" e nunca encontra "é
  assim". Tarefa fechada revisa `docs/`, e PR que não mexe em `docs/` declara
  por quê em uma linha, como a regra 20 já faz com QA. O passo entrou no
  diagrama do fluxo de trabalho.

- Dívida de documentação paga junto: a invariante do pool de três conexões em
  `docs/operations.md`, com o par 200/504 dos logs e o porquê do teto
  `POOL - 1`; `docs/product/jobs-url-contract.md`, novo, porque todo filtro da
  tela Vagas vive na URL e nada documentava isso; `src/core/country.ts` no mapa
  de `docs/architecture.md`; e a faixa de Score em `docs/scoring.md`.

- A linha agrupada perdeu "Vaga", "Site", "Aplicar" e "não me interessa". As
  quatro agem sobre uma publicação específica, e na linha agrupada não há uma —
  há N. A escolha do país vem antes, no hub.

## [1.18.2] - 2026-09-20

### Corrigido

- **O 504 de `/candidate/skills`, achado nos logs da Vercel.** A tela respondia
  200 quando pedida sozinha e 504 quando pedida duas vezes — os logs trazem o
  par cru: um 200, e 266ms depois um 504 na mesma rota.

  `measureSkillDemand` disparava **três** consultas num `Promise.all` contra um
  pool de **três** conexões. Uma requisição sozinha cabe, e é por isso que a
  tela passava em toda a suíte. Mas a instância serverless é reaproveitada entre
  requisições concorrentes: duas na mesma instância pedem seis conexões a um
  pool de três, cada uma espera a outra, e a Vercel mata as duas aos 30s.

  Agora são duas de cada vez, com a consulta pesada sozinha por último, para
  sempre sobrar conexão para o resto da requisição.

- A régua de `tests/db-fan-out.test.ts` era `<= POOL`, que aprova exatamente o
  caminho que esgota o pool. Passa a ser `POOL - 1`, e encontrou mais **três**
  caminhos: `ownEvidence` (criação de trilha), `trackOverview` — este criado
  pela própria correção, que é o argumento a favor da régua em vez da varredura
  — e a saúde das capturas de `/searches`.

- Um caso de browser novo pede a tela de skills **duas vezes ao mesmo tempo** e
  exige 200 nas duas. Era o teste que faltava: toda a suíte pedia uma página por
  vez, e o defeito só existe com duas.

- O caso do currículo na fila reprovava em três de cinco execuções: ele digitava
  no editor enquanto o shell ainda estava `inert`. Tecla perdida não muda o
  currículo, currículo igual não enfileira repontuação, e o cartão lia `idle`.
  Agora espera o shell vivo e confirma que o texto mudou.

## [1.18.1] - 2026-09-20

### Corrigido

- A rota de diagnóstico de `/candidate/skills` passa a dar prazo próprio a cada
  passo. Ela morria junto com a tela — a Vercel mata o processo aos 30s e nada
  voltava —, que é exatamente a cegueira que ela existe para remover. Agora o
  que já mediu volta, e o passo que estourou é nomeado.

  O log da Vercel para o 504 traz **uma linha só**, `Vercel Runtime Timeout
  Error`, sem nenhum registro da aplicação: o processo é morto, não falha. Por
  isso o Sentry nunca viu esse erro, e não veria — a falha mais visível do
  produto é a única invisível na telemetria.

- A lista de vagas agrupada pagava **215ms sobre uma lista de 61ms**: os países
  de cada linha vinham de uma subconsulta correlacionada na projeção, ou seja,
  cinquenta varreduras do acervo para responder cinquenta vezes a mesma
  pergunta. Agora uma consulta só resolve a página inteira, com um join contra
  as linhas já escolhidas: **79ms**, contra 59ms sem agrupar.

  Achado lendo o Sentry: dois dos issues abertos eram `canceling statement due
  to statement timeout` durante a varredura diária, e a consulta nomeada num
  deles é a facet de fontes — a mesma família que o agrupamento tinha acabado
  de encarecer. Medir antes de supor mostrou que o anti-join custava 1ms e a
  subconsulta por linha custava o resto.

## [1.18.0] - 2026-09-20

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
- A tela Vagas filtra remuneração por **faixa**, e não só por piso: dois campos
  e um slider de dois punhos sobre o mesmo par, com moeda e período do lado. O
  teto entra na URL como `payMax`, a consulta ganhou o lado de cima em
  `payCondition`, e `countHiddenBelowMinimum` virou `countHiddenByPayRange`
  porque agora conta os dois lados. Faixa invertida — que só URL escrita à mão
  e campo digitado produzem — troca os lados e avisa, em vez de ignorar.
- O corte de aderência virou **Score**, e virou faixa: `fit` ganhou o par
  `fitMax` e `BoardFilters.maxFit`, no lugar dos chips de 45+/55+/60+/70+. O
  campo aceita só de 0 a 100 e corta o resto enquanto se digita, porque nota
  acima do teto do scorer não existe.
- Filtro **Fonte** em multi-seleção: uma fonte por adapter novo já fazia a
  fileira de chips quebrar em três linhas, e escolher três fontes custava três
  idas ao servidor. `source` repete na URL, `BoardFilters.sourceKinds` recebe a
  lista, e `source=x` sozinho — o formato que ainda circula em link salvo —
  continua valendo.
- Filtro **Empresa**, separado da busca livre. O termo geral varre cargo,
  empresa e descrição, então procurar "Shopify" ali traz toda vaga que cita
  Shopify no texto; este pergunta só pelo empregador, e casa dentro da palavra
  porque "Shopify" precisa achar "Shopify Inc". O valor viaja como parâmetro de
  `strpos`, então `%` num nome de empresa é texto, não curinga.
- Filtro **funil**: "ainda não enviadas" esconde o que já foi enviado. Lê
  `appliedAt`, não o nome do status — o carimbo é posto uma vez, na entrada em
  `applied`, e sobrevive a recusa, desistência e arquivamento; uma lista de
  status precisaria ser editada a cada estado novo e esqueceria quem saiu dele.

### Alterado

- As faixas de filtro passam a compartilhar uma grade de duas colunas, rótulo e
  controles, com um separador antes de "ordenar" porque ordenar não é filtrar.
  Antes cada faixa tinha o mesmo peso e a mesma borda esquerda irregular, que é
  o que fazia uma barra com tudo dentro parecer uma barra sem nada.
- O teto do filtro salarial caiu de 10.000.000 para 2.000.000. Acima disso não
  é salário, e um zero a mais deve ser recusado em vez de esvaziar o quadro em
  silêncio. A escala de arraste continua bem mais baixa — ela é leitura, e
  estica para caber o que for digitado.
- Campo vazio numa faixa passa a dizer o que significa, no próprio campo: "sem
  mínimo", "sem teto", ou o limite real quando existe (0 e 100 no Score). A
  convenção "punho no extremo é sem limite" estava correta e invisível, o que
  fazia o campo parecer ter perdido o valor.
- Trilha, "trazida pelo termo" e cluster ganharam uma frase de apoio cada. As
  três ofereciam chips com as MESMAS palavras — PHP, Laravel — e faziam coisas
  diferentes: a trilha decide qual alvo dá a nota, o termo diz qual busca
  trouxe a vaga, e o cluster é o tipo de posição. O nome sozinho não separava.
- `toParams` devolve pares em vez de objeto: um objeto por nome só consegue
  guardar a última fonte escolhida.

### Corrigido

- O caso que recusa semear QA manual fora de um banco provisionado passa a
  declarar o tempo que precisa. Ele abre quatro processos Node, um por URL
  recusada: 2,2s nesta máquina, e no runner estourou o limite padrão de 5s e
  reprovou uma PR que não tocava o arquivo.
- A lista de uma dimensão não é mais estreitada pelo filtro dela mesma. Contar
  as fontes de um quadro já restrito a duas fontes responde "quais duas você
  escolheu", e o combo só podia perder opções: escolher `ashby` deixava `ashby`
  como a única coisa restante para escolher. Vale igual para cluster.
- `fit=abc` chegava na consulta como `NaN` e o Postgres recusava a página. O
  corte passa a ser preso entre 0 e 100 na leitura da URL, e não confiado.
- Um teste de arquitetura passa a percorrer o grafo real de imports e reprovar
  ilha cliente que alcance Drizzle ou builtin `node:`, parando em módulo
  `"use server"` — a porta legítima. O slider importava uma constante de
  `app/filter-state.ts` e levava o contexto de matching, `node:crypto` e
  `node:dns` para o bundle do browser; `next build` recusou a página inteira
  com um erro que nomeava um esquema de URI, não o import culpado. `pnpm check`
  ficou verde do começo ao fim: type checker não tem opinião sobre em qual
  runtime um módulo termina.
- A conferência pós-deploy reprovou na primeira execução real por defeito dela
  mesma: procurava "número com dois pontos" no HTML e achou o hash de um asset
  (`022.617.46`) em vez da versão. A página passa a declarar
  `data-app-version` e o workflow lê esse atributo; o teste prende os dois lados
  do contrato. Produção estava correta e servindo 1.17.1 o tempo todo.

### O que não é óbvio no diff

- **As entradas acima sobre os filtros e sobre `data-app-version` foram
  restauradas em 2026-09-21**, não reescritas. Elas existiam quando cada
  correção entrou e desapareceram antes da tag: uma branch substituiu o bloco
  `## [Unreleased]` inteiro pelo seu em vez de acrescentar ao que já estava
  ali, e o commit de release fechou a versão sobre o sobrevivente. O gate não
  vê isso — `bodyHasUserContent` só pergunta se há conteúdo AGORA, e uma
  reescrita passa. Ao rebasear sobre notas de outra branch, `## [Unreleased]`
  é append-only.

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
