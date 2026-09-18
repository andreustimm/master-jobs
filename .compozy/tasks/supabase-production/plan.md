# Migração de produção para Supabase

Data: 2026-09-16 (atualização). Branch: `codex/supabase-production`, base `origin/dev` (`bb1a6b4781e9122ed9a8bc647e2e04fbdcf8bf78`).

## Escopo decidido

- Destino: Master Timm / master-jobs, ref `bujawvnxwtmneiggizje`, São Paulo (`sa-east-1`).
- Um ambiente remoto e um schema de aplicação: `production`.
- Next.js permanece na Vercel; autenticação própria e regras de autorização permanecem.
- Sem schemas de clientes, Supabase Auth, branches remotas ou novos projetos.
- Migrations versionadas geradas por Drizzle. Dump contém dados, não é o mecanismo de evolução do schema.
- Produção atual permanece fonte autoritativa até o corte. Nunca usar snapshot local não comprovado como substituto silencioso.

## Plano e critérios de conclusão

| Etapa | Trabalho | Evidência exigida | Estado |
|---|---|---|---|
| 1 | Inventariar código, origem, dump e destino | origem/data/hash/tamanho, integridade, FKs, tabelas e contagens | Snapshot auditado; export final ainda precisa ser renovado no corte |
| 2 | Definir schema PostgreSQL e baseline de migrations | SQL gerado; mesmos campos, índices, PKs/FKs e ON DELETE | Concluída em PostgreSQL 17 local; geração sem drift |
| 3 | Migrar driver e adapters | consultas PostgreSQL; transações, retorno de IDs, busca e filas equivalentes | Concluída localmente; conexão remota e deploy ainda pendentes |
| 4 | Implementar importação e conferência | dry-run, destino vazio, hashes por tabela, transação/retomada segura e sequences ajustadas | Concluída no rehearsal; importação remota ainda pendente |
| 5 | Ensaiar em PostgreSQL local | aplicação das migrations do zero e reaplicação sem efeito; carga e verificação | Concluída novamente em 15/09 após o alinhamento com `dev` |
| 6 | Validar aplicação | check, E2E e jornadas login/papéis/CV/funil/importação/filas/export | Gates locais verdes; QA targeted ainda not-ready por bug preexistente |
| 7 | Preparar infraestrutura e deploy | credenciais separadas runtime/migração; schema privado; deploy após migrations | Pendente — inventário verificado em 17/09, ver "Preflight do corte" |
| 8 | Carga final e corte | fonte congelada, backup final, igualdade dos dados, smoke e retorno documentado | Pendente |

### Atualização de validação — 15/09

- A branch foi rebaseada sobre `dev` em `bb1a6b4` antes da validação; o filtro de
  modalidade foi adaptado para PostgreSQL (`json ->>`, regex `~*` e booleano),
  e a seleção preserva o `workplaceType` mínimo no snapshot.
- `pnpm check` com Docker PostgreSQL 17: 163 arquivos, 2.201 testes passados,
  7 skips; statements 95,95%, branches 92,31%, functions 96,2% e lines 96,85%.
- `pnpm test:e2e`: 224/224 verificações funcionais, 8/8 páginas sem violações
  axe WCAG 2.2 AA; os cenários de remoto, híbrido, presencial, busca, GET,
  paginação e volta passaram.
- O caminho de importação bem-sucedida foi exercitado em PostgreSQL 17 local,
  verificando linhas gravadas, `workplaceType` e rejeição de um segundo import.
- `pnpm db:rehearse-production data/migration/production-20260909.db`:
  30 tabelas, 520 registros, 1.851.392 bytes de relações, replay inalterado,
  rollback, destino ocupado e identity verificados.
- Nenhum DDL, DML, segredo ou importação foi enviado ao Supabase. A migração
  continua bloqueada por credencial PostgreSQL válida, provisionamento das roles
  e secrets de runtime/migrator, export final com escritores congelados, QA Full,
  revisão profunda e aprovação humana de `staging` para `main`.

## Migrations

### Inspeção remota oficial — 10/09 UTC

- CLI 2.109.0 autenticado; projects list confirmou master-jobs,
  bujawvnxwtmneiggizje, organização zihaubxybznoxsuatbxh, sa-east-1,
  ACTIVE_HEALTHY, PostgreSQL 17.6.1.166.
- Vínculo local criado pelo CLI dentro do diretório ignorado
  data/migration/supabase-target; project-ref lido e conferido antes da consulta.
- `supabase db query --linked --workdir data/migration/supabase-target`
  oferece consulta via API de gerenciamento. SELECT de metadados retornou:
  database postgres, role postgres, 10.448.019 bytes, schema production ausente,
  zero tabelas da aplicação. O CLI informou Initialising login role.
- Nenhum DDL nem DML da aplicação executado remotamente. Não usar db push
  como segundo migrator: journal Drizzle continua sendo a fonte versionada.
- Senha recusada não bloqueia mais a inspeção via API. Credencial PostgreSQL
  direta válida continua pendente para o migrator e runtime; não foi redefinida.

### QA de jornada — execução local em andamento

Tier Targeted desta branch: persistência do funil, currículo/fila, fronteiras
de autenticação e abertura direta como canária. Não substitui o Full exigido
antes da PR humana staging → main, que inclui todas as jornadas P0/P1 e personas.
Reutilizar charters existentes; acrescentada somente a jornada de decisão no
funil, ausente do tracker. Nenhuma mudança de audiência ou nova persona.

| Ordem | Jornada | Charters | Estado |
|---|---|---|---|
| 1 | J-preserve-application-decision | CH-save-resume-application | Fail: formulário limpa rascunho de transição rejeitada; defeito preexistente, decisão humana pendente |
| 2 | J-switch-workspace-screen | CH-auth-boundary-recovery; CH-recruiter-private-english | Pernas executadas Pass; cenário abrangente ainda incompleto |
| 3 | J-refresh-candidate-ranking | CH-save-cv-ranking-refresh; CH-no-cv-ranking-state; CH-private-ranking-recovery | Pass em conteúdo persistido, fila e isolamento entre contas; worker não processado |
| 4 | J-open-dashboard-direct | CH-direct-startup-canary | Canária desktop operável Pass; tempo de splash e persona móvel não medidos |

Taxonomia considerada em cada jornada: caminho completo e leitura após refresh;
validação funcional e limites de sessão; feedback compreensível; abandono/retorno
e estados vazios/erro aplicáveis; continuidade entre sessão e CLI no funil,
privacidade entre contas no currículo e canária adjacente de startup.
Não há alteração de layout: matriz responsiva completa fica no E2E e Full de
release, sem inventar aprovação de PWA física. Bloqueios físicos já existentes
no tracker permanecem intactos. Evento de candidatura não tem leitura pública
dedicada: sua preservação é conferida pelo importador e testes, não por SQL
durante dogfooding. Sessões usam dados sintéticos, login real, build local com
paridade e credencial runtime restrita. Proibido testar mutações em produção.

Tracker validado pelo materializador: 20 cenários. Vereditos atualizados apenas
no escopo observado; relatos/evidências anteriores permanecem históricos.
Bug BUG-20260910-application-edit-not-retained registrado: não é evidência de
perda no PostgreSQL. A transição preparing → interviewing foi corretamente
negada pelo domínio; o formulário compartilhado limpa o texto digitado.
Detalhes de eventos não são expostos pelo CLI jobs show, portanto a ausência
nessa leitura não demonstra perda. Integridade dos eventos pertence ao ensaio.

Execução iniciada em
`docs/qa/reports/2026-09-10T011143000000Z-8bd417c2-supabase-production.md`.
Preparação original do E2E foi encerrada sem veredito por conter textos técnicos;
modo `node tests/e2e/run-isolated.mjs --manual` agora usa seed plausível dedicado.
Build local :60115 foi percorrido; processo manual 84320 encerrado por Enter
com exit 0 e limpeza automática do ambiente descartável. Cinco sessões de browser
fechadas; ausência do runtime.env temporário conferida. A matriz tem seis Pass
delimitados e um Fail; lentes não executadas, sem aprovação de release.
Gate de saída repetido após QA: check com 2.175 testes passados e 7 skips,
13 contratos QA; E2E 207/207, axe 8/8 e casos de changelog passaram, exit 0.
Rodada encerrada not-ready pelo defeito aberto, sem corte remoto.
Credencial local de CLI gerada
somente no diretório temporário .jho-e2e-fGUsRm/runtime.env, nunca no relatório.

### Evidência incremental — comando operacional e runtime restrito

- E2E concluído com login PostgreSQL sem privilégios administrativos:
  207/207 verificações funcionais e 8/8 páginas sem violações axe WCAG 2.2 AA.
  Fixtures usam credenciais isoladas; o servidor Next não recebe a credencial de migrations.
- `db:import-production` usa planejamento local por padrão. A carga exige
  `--apply`, projeto exato, SHA-256 correspondente e declaração de writers pausados.
  Recusa journal pendente, snapshot alterado e URL de outro projeto ou com override TLS.
  Migrations são um passo anterior explícito; o comando não altera schema automaticamente.
- Typecheck e 7 testes direcionados do comando/deploy passaram após a implementação.
  Planejamento executado no snapshot exportado: 520 registros; nenhuma conexão remota.
- Verificação posterior: 14 testes direcionados passaram, incluindo execução real
  do comando com fixture sintética, recusa de cada confirmação ausente/incorreta,
  planejamento sem credenciais e diagnóstico de JSON privado corrompido sem exposição.
  `pnpm check` concluído: 160 arquivos, 2.174 testes passaram, 7 skips;
  statements 95,92%, branches 92,59%, functions 96,13%, lines 96,83%;
  os 13 contratos de scripts QA passaram. Sem mudança funcional de scoring:
  apenas comentários antigos de batch HTTP foram alinhados ao adapter PostgreSQL.
- Nenhuma carga nem mudança de schema foi feita no Supabase. A senha local aguardava
  correção após rejeição 28P01; produção segue no Turso. Documentação operacional,
  QA de jornada, revisão e aprovação humana de produção continuam pendentes.

`src/core/db/schema.ts` é o modelo PostgreSQL único do runtime. O modelo SQLite
congelado está em `scripts/migration/schema.sqlite.ts` somente para conferir a
compatibilidade da origem; não participa da composição da aplicação.
`drizzle/postgres/` tem journal próprio: não copiar o journal SQLite para PostgreSQL.
Gerar com `rtk pnpm db:generate --config drizzle.postgres.config.ts`.
Aplicar com o migrator Drizzle PostgreSQL; um único proprietário da execução.
A integração GitHub nativa permanece sem auto-deploy para evitar um segundo migrator.
Mudanças de dados futuras entram em migrations custom antes de constraints novas.

IDs usam identity BY DEFAULT para preservar IDs existentes na importação.
Booleanos SQLite 0/1 tornam-se booleanos; JSON usa `json` inicialmente para
preservar representação; REAL usa double precision para evitar perda numérica.
Datas ISO permanecem texto na primeira migração para preservar os contratos atuais.
Revisar explícita e separadamente LIKE/ILIKE, collation, igualdade JSON,
upserts, `.all/.get/.run`, batch, transações e `pragma`.

## Proteção e transferência

Preservar candidaturas, eventos, documentos, perfis, usuários, hashes de senha,
correspondência e demais dados de negócio. Não sanitizar a fonte de produção.
Decisão adicional do usuário: importar somente dados necessários à aplicação,
sem o acervo inteiro de crawlers. Aplicar seleção de vagas por referências de
negócio e autoria manual, fechar dependências de FKs, excluir páginas brutas e
backlogs operacionais e preservar descrição útil das vagas selecionadas.
Detalhamento e orçamento de espaço em `docs/engineering/supabase-opportunities.md`.
Comparar origem e destino sobre o conjunto selecionado, documentando exclusões;
a contagem total do dump não precisa ser igual à carga seletiva.
Snapshots sanitizados para desenvolvimento não servem como backup completo.
Definir tratamento de sessões e links antes do corte; nunca reativar tokens já consumidos.
Não executar seed de demonstração no destino nem recalcular scores durante a cópia.
Conferir igualdade por PK e valores normalizados, não apenas contagens.
Importador rejeita tabelas/colunas desconhecidas, FKs inválidas, JSON inválido e destino ocupado.
Importação trata dependências de FKs e ciclos explicitamente, sem desabilitar integridade silenciosamente.
Reajustar sequences para inserts novos não colidirem com IDs importados.

`production` não deve ser exposto na Data API. Runtime usa role restrita a dados;
migrator tem credencial própria. Segredos não entram no Git, logs ou plano.
Ensaios locais usam PostgreSQL em Docker ligado apenas a 127.0.0.1, sem terceiro ambiente remoto.

## Origem e bloqueios conhecidos

- `data/jobs.db`: 526 MiB, mtime 2026-08-25; integrity_check OK e zero violações de FK.
- Backups locais de 19/08 e 20/08 também encontrados; substituídos como fonte
  de ensaio por export novo do Turso `master-jobs` em 09/09.
- A tarefa de pausa do Turso documenta export seguido de sanitização para uso local:
  por isso é obrigatório distinguir dump bruto e cópia de desenvolvimento.
- Snapshot privado: `data/migration/production-20260909.db` nesta worktree.
  Export via Turso CLI, checkpoint WAL concluído, integrity_check OK,
  zero violações de FK. Produção ainda pode receber escritas: renovar no corte.
- Teste remoto somente leitura com CA oficial do painel e rejectUnauthorized=true:
  TLS estabelecido, mas senha em `.env` / `SUPABASE_PROD` recusada (`28P01`).
  Solicitada atualização local da credencial, sem enviá-la na conversa.
- CA indicada pelo painel em Database Settings / SSL configuration:
  `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`.
  Pooler confirmado: `aws-0-sa-east-1.pooler.supabase.com:5432`, usuário
  `postgres.bujawvnxwtmneiggizje`, database `postgres`. Nenhuma escrita remota feita.
- A criação anterior usou senha aleatória não persistida. Conexão SQL precisa de credencial válida;
  se não estiver disponível, o operador deverá fornecer/configurar a conexão de migração.

## Preflight do corte — inventário verificado em 17/09

Conferência somente de leitura do ambiente real: nomes de variáveis no Vercel
Production, segredos do repositório e dos ambientes GitHub, e o que o runtime
exige no código. Nenhum valor foi lido ou alterado.

| Item | Estado em 17/09 | Consequência |
|---|---|---|
| `DATABASE_URL` no Vercel Production | **Ausente** | `getDb()` lança `DATABASE_URL is required` na primeira consulta. A integração do Supabase criou `POSTGRES_URL`, `POSTGRES_PRISMA_URL` e `POSTGRES_URL_NON_POOLING`; o código não lê nenhum desses nomes, por desenho. Configurar **antes** de promover `main`, não depois. |
| Formato da URL | — | `connectDatabase()` recusa qualquer query string (`?sslmode=`, `?pgbouncer=`), para a política de TLS não ser enfraquecida pela string de conexão. |
| `DATABASE_CA_CERT` | Cadastrada em 16/09 | É **caminho de arquivo**: `readFileSync(ca, "utf8")`. O repositório versiona `config/certs/supabase-ca.crt` e `next.config.ts` o declara em `outputFileTracingIncludes`, então ele viaja no bundle. Confirmar que o valor é o caminho, não o PEM. |
| `SUPABASE_MIGRATION_URL` | **Ausente** no repositório e nos ambientes `Production`/`Preview` | `migrate.yml` — a via aprovada, com `confirm_project=bujawvnxwtmneiggizje` — não tem credencial. É `workflow_dispatch`, então não bloqueia deploy; bloqueia migrar pela via documentada. |
| `RESEND_API_KEY` / `RESEND_FROM` | Ausentes | `configuredMailer` cai no adapter de console: o link de recuperação de senha vai para o log. Com autenticação exigida por omissão, é a única porta de volta de quem perde a senha. |
| Promoção automática | Sã | A única execução vermelha recente de `promover-para-staging.yml` parou em "Suspender por causa do schema" — o guarda de migração agindo como projetado quando a migração PostgreSQL entrou. |
| Produção hoje | `200` em `/login`, tag `v1.4.1` | O corte substitui um runtime Turso saudável por um runtime PostgreSQL; sem `DATABASE_URL` a troca é uma queda, não uma degradação. |

O QA Full do release candidate 1.7.1 correu em 17/09 sobre `676d5e0` e voltou
**not-ready**: BUG-20260910 reproduz no RC, com a nota digitada descartada numa
transição recusada. Relatório em
`docs/qa/reports/2026-09-17T232350685065Z-1cb4e9bd-release-candidate-1.7.1-full.md`.
A correção está na PR #87 e não toca `drizzle/` nem `src/core/db/schema.ts`,
então promovê-la não suspende a promoção automática.

Ordem que sai disso: configurar `DATABASE_URL` → mesclar a correção em `dev` e
deixar promover → repetir a sessão de funil do Full sobre o RC novo → só então
a PR humana `staging → main`, seguida do smoke test de
`docs/engineering/deploy.md`.

## Corte e retorno

Inventariar e pausar todos os escritores (UI, CLI, Actions e crons) durante a carga final.
Se snapshot for antigo, exigir export atualizado ou reconciliação comprovada com a origem congelada.
Migrar schema antes de publicar runtime; só `main` acessa o segredo de produção.
Previews e testes nunca recebem DATABASE_URL de produção.
Manter Turso intacto. Antes de liberar gravações no novo banco, é possível voltar
ao deployment e às credenciais anteriores. Depois de novas gravações, retorno exige
reconciliar essas gravações; apontar simplesmente para Turso perderia dados.
Não reativar automaticamente consumidores pausados pelo incidente de quota.

## Entrega

### Privilégios mínimos — 09/09

- Migration custom `0001_production_access.sql` gerada pelo comando Drizzle
  e preenchida sem editar a baseline. Cria grupo NOLOGIN `master_jobs_runtime`,
  recusa capabilities administrativas inesperadas e remove acesso de PUBLIC,
  anon, authenticated e service_role ao schema/objetos da aplicação.
- Runtime recebe USAGE no schema, CRUD nas tabelas e USAGE/SELECT nas sequences;
  não recebe DDL, TRUNCATE, CREATE ROLE nem acesso ao journal do migrator.
- Defaults de tabelas/sequences futuras configurados para o mesmo executor
  de migrations. Trocar esse executor exige revisar defaults; privilégios de
  objetos futuros são os do role que os cria, não os de seus grupos.
  Referência: [PostgreSQL 17 — ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).
- Testes exercitam dados permitidos e operações negadas, incluindo login real
  restrito que não consegue assumir `postgres`. Principais da Data API são
  simulados no cluster local, incluindo service_role com BYPASSRLS.
- E2E usa agora login temporário distinto do executor de fixtures/migrations,
  e o servidor não recebe DATABASE_MIGRATION_URL nem a URL administrativa dos testes.
  O build confirma a presença da CA no standalone; E2E restrito ainda em execução.
- Ensaio repetido com as duas migrations: mesmos 520 registros e 1.851.392 bytes
  nas relações da aplicação; database local 10.704.563 bytes; replay, rollback,
  rejeição de destino ocupado e identity verificados novamente.
- `pnpm check`: 159 arquivos, 2.168 testes passaram, 7 skips preexistentes;
  cobertura statements 95,92%, branches 92,59%, functions 96,13%, lines 96,83%;
  13 contratos QA verdes. Geração de schema novamente sem mudanças pendentes.
- Login permanente de produção e sua credencial ainda NÃO foram provisionados.
  `.env` segue com mtime 20:58:23 e a credencial recusada; não repetir tentativas
  de autenticação enquanto o operador não a atualizar.

### Implantação e E2E — 09/09

- E2E PostgreSQL concluído (exit 0): 207/207 verificações funcionais, 8/8
  páginas sem violações axe WCAG 2.2 AA e degradação de changelog malformado,
  vazio e ausente passou. Build standalone e fixtures isoladas concluídos.
- `.github/workflows/migrate.yml` agora é somente workflow_dispatch, main,
  confirmação do ref exato e environment `production`. Sem corrida por push.
  No corte inicial, aplicar a migration revisada antes da promoção do runtime.
- Script de migração rejeita host/usuário/database/porta fora do projeto
  aprovado, parâmetros de conexão e URL inválida, sem imprimir credenciais.
- Varredura condicionada a `SUPABASE_CRAWL_ENABLED == 'true'` e main;
  não ativar antes de aprovar retenção/orçamento de dados. Só recebe segredo runtime.
- CA pública do painel incluída em `config/certs/supabase-ca.crt` e no tracing
  do standalone; postgres substitui libsql nos pacotes server-only.
- `.env.example` distingue runtime, migração e PostgreSQL local, sem fallback SQLite.
- Testes incrementais de implantação/conexão/schema/seleção: 15 passaram;
  typecheck e diff-check verdes. Repetir build/E2E após mudança no tracing.
- Nenhum workflow foi enviado/ativado, segredo remoto alterado ou banco remoto escrito.
  Configurar environment protegido, roles restritas, secrets da Vercel/GitHub,
  documentação operacional e revisão antes do corte permanece pendente.

### Runtime PostgreSQL — 09/09

- Driver postgres.js e Drizzle PostgreSQL, com tabelas qualificadas por schema.
- DATABASE_URL obrigatória; não há fallback silencioso para arquivo SQLite.
- DATABASE_MIGRATION_URL separada e exigida somente pelo comando explícito
  `db migrate`; removidos os 28 pontos de DDL implícito em comandos comuns.
- TLS com validação de certificado obrigatório fora de loopback;
  DATABASE_CA_CERT permite a CA oficial do provedor. Conexão remota ainda não validada.
- Pools limitados a 3 conexões por processo e prepared statements desabilitados
  para compatibilidade com poolers; fechamento assíncrono aguardado pela CLI.
- Consultas adaptadas: igualdade JSON, split_part, greatest, agregações numéricas,
  qualificação de tabelas e claims das três filas com FOR UPDATE SKIP LOCKED.
- Persistência de scores em transações por lote; sem alteração da rubrica de score.
- Diagnóstico de integridade confere dados contra todas as FKs declaradas,
  inclusive ownership composto. Fitness test compara FKs reais em pg_constraint.
- Testes usam banco isolado por caso em container PostgreSQL 17 temporário.
  Mantidas as verificações de rollback, concorrência e comportamento; fixtures
  de corrupção/erro usam mecanismos PostgreSQL e nunca banco externo.
- `pnpm check`: 157 arquivos verdes, 2.159 testes passaram, 7 skips preexistentes;
  cobertura statements 95,92%, branches 92,59%, functions 96,13%, lines 96,83%;
  13 contratos QA verdes. Geração de migrations: nenhuma mudança pendente.
- E2E adaptado para PostgreSQL isolado; resultado ainda pendente. Nenhum deploy,
  PR, corte ou carga remota executado. Documentação operacional/CI, QA vivo,
  permissões remotas, revisão e promoção humana continuam pendentes.

### Ensaio PostgreSQL — 09/09

Comando: `rtk pnpm db:rehearse-production data/migration/production-20260909.db`.
Requer Node 24 e Docker. Cria PostgreSQL 17 temporário com senha aleatória,
porta apenas em 127.0.0.1; remove o container e os dados do ensaio ao terminar.
Não aceita URL de destino e não alcança produção. Snapshot original é preservado.

- SHA-256 do snapshot: `0993e52146c53979f2181428fac0514e15c0fafffb8a6b6ed48656d40edc2354`.
- Baseline aplicada pelo migrator Drizzle; segunda execução preservou o journal.
- 30 tabelas verificadas por hash dos valores normalizados e por contagem.
- 520 registros importados; relações da aplicação (dados + índices): 1.851.392 bytes.
- Banco local total: 10.639.027 bytes. Não representa o overhead dos serviços Supabase.
- Falha de hash forçada após a inserção reverteu a carga; a carga válida seguinte passou.
- Segunda carga válida foi recusada por destino ocupado, sem apagar/sobrescrever dados.
- INSERT real de candidato retornou max(id) + 1; teste foi revertido.
- Importador usa locks antes da checagem de destino vazio, FKs ativas e
  ALTER IDENTITY RESTART transacional; recusa banco acima de 400 MiB.
- Typecheck após os scripts: verde. Testes de runtime e gates completos pendentes.

### Seleção de dados — 09/09

`scripts/migration/select-production.ts` abre o snapshot somente para leitura,
rejeita tabelas/colunas não revisadas e valida FKs tanto na origem completa
quanto no conjunto selecionado. Emite contagens, tamanho JSON e SHA-256 por
tabela, sem imprimir valores privados. Tamanho JSON não é tamanho físico PostgreSQL.

- Preserva 5 usuários, 3 candidatos, 4 documentos, 2 candidaturas e 2 eventos.
- Seleciona 3 de 29.524 vagas (referências de negócio ou autoria manual),
  respectivos scores e empresas referenciadas ou com pesquisa registrada.
- Preserva configurações de fontes, removendo diagnóstico da última execução.
- Não transfere job_page, scrape_task, verify_task ou score_task.
- Remove HTML das vagas; preserva texto e metadados raw de fontes manuais,
  usados pelo produto. Raw de fontes de crawler vira objeto vazio.
- Sessões e links temporários não são transferidos: novo login após corte.
  Hashes de senha e eventos de auditoria de autenticação são preservados.
- O seletor ainda não escreve no Supabase. Ensaiar importação, medir armazenamento
  físico e validar runtime continuam pendentes.
- Execução sobre o snapshot: 520 registros selecionados, 175.347 bytes de
  payload JSON agregado; todas as dependências FK selecionadas válidas.
- Verificação incremental: typecheck verde; 6 testes passaram em
  `production-selection.test.ts` e `postgres-schema.test.ts`. Cobrem seleção,
  preservação da origem, dados inválidos e recusa de drift não revisado.
  Não substituem os gates completos nem o ensaio de carga PostgreSQL.

### Evidência inicial — 09/09

- Worktree criada a partir de `origin/dev`, versão 1.3.10.
- `drizzle/postgres/0000_production_baseline.sql` gerada pelo Drizzle,
  aplicada em transação em container PostgreSQL 17 sem rede: 30 tabelas,
  28 FKs e 79 índices (incluindo índices de PK e UNIQUE).
- Regeneração sem mudanças produziu `No schema changes, nothing to migrate`.
  Isso prova estabilidade da geração; reaplicação via journal do migrator
  continua sendo um teste separado pendente.
- Ajustes de compatibilidade feitos no schema, com SQL regenerado: UNIQUE
  composto do documento antes da FK de ownership; predicate booleano `true`.
- Nenhuma tabela/dado foi criado no Supabase nesta etapa; o runtime local já é
  PostgreSQL, mas o corte remoto e a importação seletiva continuam pendentes.
- Arquivo local tem 13.384 vagas, 2 candidaturas, 2 eventos, 3 candidatos,
  4 documentos e 4 usuários. Não há prova de que represente produção atual.
  Payloads brutos medidos: job.raw 131.627.194 bytes, job.description_html
  71.205.547 bytes, job_page.html 143.809.640 bytes. Excluir esses payloads
  não exige excluir as candidaturas ou os registros de vaga que elas referenciam.
- Plano de adoção Free/MVP documentado em `docs/engineering/supabase-opportunities.md`.
- `pnpm check` com Node 24.19.0: 156 arquivos passaram, 2.159 testes passaram,
  7 skips preexistentes; cobertura de statements 96%, functions 96,28%;
  13 contratos dos scripts QA passaram. Testes PostgreSQL verificam preservação
  de colunas/FKs e ordem da constraint composta. E2E e QA do runtime PostgreSQL
  permanecem pendentes, pois o driver ainda não foi trocado.

Sem mudança visual planejada; mudança de persistência exige QA funcional completo.
Atualizar ADR de banco, documentação de deploy, fitness tests e changelogs antes da PR.
PR para dev com revisão profunda; promoção de staging para main continua humana.
