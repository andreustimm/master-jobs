# Referência da CLI

Esta página cobre a CLI do produto (`rtk pnpm jho`). A coordenação de tarefas
de engenharia usa `rtk pnpm tasks`; comandos, assinaturas, códigos de saída e
procedimento de ativação estão no [guia de tarefas do GitHub Project](engineering/github-project-tasks.md).

## Por que isto existe

A CLI é uma das duas superfícies do `master-jobs` — a outra é o dashboard
Next.js, que chama as mesmas APIs públicas. `src/cli.ts` cobre buscar vagas em
APIs públicas, pontuá-las de forma determinística, mover candidaturas pelo funil
e exportar um snapshot para o vault do Obsidian.

Este documento existe para duas audiências:

1. **Você, daqui a três meses**, tentando lembrar se o corte de fit padrão era 40 ou 45
   (é 45) e se `--all` repontua vagas fechadas (não repontua).
2. **Agentes de IA**, que precisam invocar comandos sem inventar flags. Toda flag aqui
   foi lida em `src/cli.ts`. Se uma opção não está nesta página, ela não existe.

Tudo é invocado através do script `jho` do `package.json`:

```json
"jho": "node --experimental-strip-types --no-warnings --env-file-if-exists=.env src/cli.ts"
```

Ou seja: `pnpm jho <comando>`. Não existe binário global instalado.

> **Invariante:** Todo comando é seguro para re-executar. `jobs sync` roda
> `runMigrations()` antes de qualquer coisa, `ensureSources()` leva o YAML ao banco (só nas linhas não geridas), o
> upsert de `job` é decidido pelo `fingerprint` e o de `job_score` por
> `onConflictDoUpdate` em `job_id`. Nenhum comando novo pode quebrar essa propriedade.

> **Invariante:** A ingestão nunca escreve em `application`. `jobs sync` pode inserir,
> atualizar e fechar `job`; decisões do usuário (o funil) só mudam por uma ação
> explícita da pessoa (`jho track`, a tela do funil, sugestão de e-mail aceita).

## Referência rápida

Os exemplos usam `rtk` porque no
Codex e no OpenCode todo comando de shell vai prefixado (no Claude Code o hook
global reescreve). Para digitar só `jho`, instale o atalho uma vez:
`ln -sf "$PWD/bin/jho" ~/bin/jho` (com `~/bin` no `PATH`); ele funciona de
qualquer subdiretório do projeto. Os detalhes de cada comando estão nas seções
abaixo.

```bash
rtk pnpm install
rtk pnpm qa:browser:install       # Chrome usado pelo QA de jornada
rtk pnpm dev                     # dashboard em 127.0.0.1:3000

# banco
rtk pnpm jho db migrate          # cria/atualiza o schema
rtk pnpm jho db seed             # conta do dono + skills + provedores + posicionamento
rtk pnpm jho db prune --days 90  # remove vagas fechadas sem candidatura

# sourcing
rtk pnpm jho jobs sync           # busca todas as fontes + pontua
rtk pnpm jho jobs score --all    # repontua tudo
rtk pnpm jho jobs verify         # checa se as vagas do topo ainda existem (404 → fecha)
rtk pnpm jho jobs add <url>      # cadastra vaga por URL, resolvendo pelo ATS
rtk pnpm jho jobs import <file> --source revelo   # importa JSON de plataforma logada
rtk pnpm jho sources list        # saúde das fontes
rtk pnpm jho sources probe ashby textlayer        # testa um handle sem gravar
rtk pnpm jho sources diff        # YAML × banco, sem gravar
rtk pnpm jho sources import      # simula; --apply passa o catálogo ao banco
rtk pnpm jho sources snippet revelo               # extrator para plataforma logada

# autenticação
rtk pnpm jho auth seed <email>   # cria a conta do dono, senha gerada e mostrada uma vez
rtk pnpm jho auth status         # modo e contas
rtk pnpm jho auth add-user <email> --role admin,candidate
rtk pnpm jho auth set-password <email>   # senha (entrada escondida ou --stdin)
rtk pnpm jho auth login <email>          # link de uso único → /login/callback

# LLM opcional (BYOK — sua chave, seu custo)
rtk pnpm jho llm seed            # cadastra provedores conhecidos
rtk pnpm jho llm list            # modelos, esforço, custo e quais têm chave
rtk pnpm jho llm use <modelo>    # define o padrão
rtk pnpm jho llm add-provider <slug> --label X --key-env VAR [--kind compatible --base-url URL]
rtk pnpm jho llm add-model <provedor> <modelo> --label X [--reasoning --effort high]
rtk pnpm jho analyze <id>        # leitura qualitativa da vaga; pede confirmação antes de enviar

# candidatura
rtk pnpm jho prep <id>           # dossiê: bloqueios, rede, evidências, vocabulário

# triagem e funil
rtk pnpm jho jobs list --min-fit 60
rtk pnpm jho jobs show <id>      # breakdown completo do score
rtk pnpm jho track <id> applied --channel referral
rtk pnpm jho pipeline

# câmbio
rtk pnpm jho fx refresh          # cotações do BCE (Frankfurter)
rtk pnpm jho fx show

# e-mail (ADR 0008)
rtk pnpm jho mail auth           # conecta o Gmail (escopo somente leitura)
rtk pnpm jho mail fetch          # baixa .eml — não importa nada sozinho
rtk pnpm jho mail import ~/mail --dry-run
rtk pnpm jho mail suggestions    # mudanças de funil sugeridas por e-mail
rtk pnpm jho mail accept <id> | dismiss <id>

# rede e referrals
rtk pnpm jho contacts seed       # empresas onde já trabalhou
rtk pnpm jho contacts add "Nome" -c Empresa -k former
rtk pnpm jho referrals           # vagas onde já conhece alguém

# currículo
rtk pnpm jho cv import <arquivo.pdf>   # extrai texto de PDF (--dry-run para conferir)
rtk pnpm jho cv set <arquivo.md>       # salva de texto/markdown

# vocabulário e skills
rtk pnpm jho skills gap          # o que o mercado escreve e o CV não — lacuna de vocabulário
rtk pnpm jho skills detect       # detecta skills no CV (detectada != confirmada)

# posicionamento
rtk pnpm jho tasks list --horizon 24h
rtk pnpm jho tasks done PT-0001

# segurança
rtk pnpm jho security check      # bind, PII versionada, segredos, permissões do banco

# raspagem (robô de descrições)
rtk pnpm jho scrape queue        # enfileira vagas por fit
rtk pnpm jho scrape run          # captura e trata, em paralelo
rtk pnpm jho scrape status       # situação da fila
rtk pnpm jho scrape reparse      # reprocessa tudo sem baixar de novo

# análise
rtk pnpm jho stats               # diagnóstico do scorer e do funil (--json)

# saída
rtk pnpm jho report              # markdown pro vault Obsidian
rtk pnpm jho profile             # valida profile.yaml

# desenvolvimento
rtk pnpm check                   # changelogs, tracker de QA, typecheck, testes — verde antes de qualquer entrega
rtk pnpm test:qa-skills          # contratos dos conversores do tracker QA
rtk pnpm test:e2e                # browser real isolado: build, PostgreSQL e porta temporários
rtk pnpm db:generate             # gera migration após editar schema.ts
```

## Convenções de leitura

| Convenção | Significado |
|---|---|
| `<arg>` | Argumento posicional obrigatório |
| `--flag <n>` | Opção com valor; o default aparece na coluna "Default" |
| `--flag` | Booleana, sem valor |
| Saída em bloco | Forma real da saída, com cores ANSI removidas |

Todas as opções com valor chegam ao código como **string** e são convertidas com
`Number(...)`. Um valor não numérico vira `NaN` silenciosamente — passe números.

Erro não tratado em qualquer comando cai no `catch` de `program.parseAsync(...)`, que
imprime a mensagem em vermelho e seta `process.exitCode = 1`.

---

## Raiz — `jho`

`name("jho")`, `description("Job sourcing, fit scoring and application pipeline")`,
`version("0.1.0")`.

| Flag | O que faz |
|---|---|
| `-V, --version` | Imprime `0.1.0` |
| `-h, --help` | Ajuda do Commander (funciona também em cada subcomando) |

```bash
pnpm jho --help
pnpm jho jobs --help
pnpm jho --version
```

---

## Área `db` — manutenção do banco

Grupo `db`, descrição `"Database maintenance"`. Sozinho não faz nada — sempre precisa de
um subcomando.

### `jho db migrate`

`"Create or upgrade the database schema"`. Chama `runMigrations()`
(`drizzle-orm/postgres-js/migrator` sobre a pasta `./drizzle/postgres`). O comando
usa `DATABASE_MIGRATION_URL`, separado da URL de runtime, e não cria banco de
arquivo nem faz fallback para SQLite/Turso.

Sem flags.

```bash
pnpm jho db migrate
```

```
✓ schema is up to date
```

Rodar duas vezes seguidas é inofensivo: o migrator só aplica o que falta. `jobs sync`
já executa isso internamente, então na prática você só chama `db migrate` num banco
recém-criado ou depois de um `pnpm db:generate`.

### `jho db prune`

`"Delete long-closed jobs you never applied to"`. Chama `pruneClosed(Number(opts.days))`,
que deleta de `job` onde `closed_at < cutoff` **e**
`job.id not in (select job_id from application)`.

| Flag | Default | Descrição |
|---|---|---|
| `--days <n>` | `"90"` | age threshold in days |

```bash
pnpm jho db prune --days 120
```

```
✓ pruned 37 closed job(s)
```

> **Invariante:** Vaga que some da fonte é **fechada**, não deletada — `closedAt` é
> carimbado pelo sync. `pruneClosed()` é a única exclusão permitida no repositório, e
> ela protege explicitamente tudo que tem candidatura registrada
> (`job.id not in (select job_id from application)`). Remover esse `not in` apaga
> histórico irrecuperável.

---

### `jho db cleanup`

Inventaria payloads reconstruíveis e vagas fechadas elegíveis para poda. Sem
`--apply` é somente leitura; isso torna seguro medir produção antes de alterar.

| Flag | Default | Descrição |
|---|---|---|
| `--apply` | ausente | aplica a limpeza inventariada |
| `--closed-days <n>` | `90` | poda vaga fechada sem candidatura após N dias |
| `--page-html-days <n>` | `0` | retenção do HTML bruto já tratado |

```bash
pnpm jho db cleanup
pnpm jho db cleanup --apply
```

O comando compacta `job.raw` e `job.description_html` apenas para fontes de
rede, preservando o `workplaceType` mínimo quando existe. Ele limpa
`job_page.html` apenas após extração bem-sucedida e protege toda vaga ligada a
`application`. Turso não oferece `VACUUM`; a medição de storage
usa páginas ocupadas via `dbstat`, que são liberadas pela atualização.

---

### `jho db seed`

Carrega o plano de ação da auditoria de posicionamento (§14) na tabela
`positioning_task`, e a baseline de métricas de julho/2026 em
`metric_snapshot`.

```bash
pnpm jho db seed
```

```
✓ 31 task(s) inserted, 0 refreshed, 11 baseline metric(s) recorded
```

Idempotente com uma nuance importante: re-executar **atualiza o texto** de uma
tarefa (título, why, how, esforço) mas **nunca reseta o status**. Uma tarefa
que você marcou como `done` continua `done`. As métricas usam
`onConflictDoNothing`, então a baseline nunca é sobrescrita.

Roda `runMigrations()` antes de semear, então funciona num banco vazio.

## Área `sources` — inspeção das fontes

Grupo `sources`, descrição `"Inspect configured job sources"`.

### `jho sources list`

`"Show every configured source and its last sync result"`. Lê `config/sources.yaml` via
`loadSources()` (só as entradas com `enabled: true`) e cruza com as linhas da tabela `source`
pelo id `${kind}:${handle}`.

Sem flags.

```bash
pnpm jho sources list
```

```
  KIND             HANDLE               LAST SYNC            JOBS   STATUS
  greenhouse       stackblitz           2026-08-18 11:02:14     41  ok
  ashby            textlayer            2026-08-18 11:02:15      8  ok
  lever            jobgether            2026-08-18 11:02:16    612  ok
  himalayas        (all)                2026-08-18 11:02:18     50  ok
  arbeitnow        (all)                2026-08-18 11:02:21      —  error
      ↳ (j.job_types ?? []).join is not a function
```

Detalhes que importam na leitura:

- Handle vazio (`himalayas`, `arbeitnow`, `remoteok`) é impresso como `(all)`.
- `STATUS` é `ok`, `error` ou `never` — `never` significa que a fonte está no YAML mas
  ainda não apareceu em nenhum sync.
- A linha `↳` em vermelho é o `lastError` gravado no último sync daquela fonte.
- Fonte com `enabled: false` no YAML **não aparece** aqui: `loadSources()` a devolve
  com `enabled: false` e a saúde filtra as habilitadas.

### `jho sources diff`

`"List where config/sources.yaml and the source catalog in the database differ
(writes nothing)"`. Uma linha por divergência: `only in yaml` (o sync vai
inserir), `only in db` (linha do catálogo ausente do arquivo) e `differs:
label, rationale, enabled`. O sufixo diz o regime da linha: `(mirrors yaml)`
será regravada pelo próximo sync; `(managed)` é governada pelo banco e o
arquivo não a toca. Fontes `<kind>:~terms`, `manual` e `recruiter` ficam de
fora — não vêm do YAML. Sem flags.

```bash
pnpm jho sources diff
```

```
  greenhouse:acme                          differs: label (managed)
  lever:nova                               only in yaml
```

### `jho sources import [--apply]`

`"Make the database the source of truth: dry run by default, --apply writes the
yaml state and marks every row as managed"`. Sem `--apply` imprime o mesmo
plano do `diff` e os totais, sem gravar. Com `--apply`, numa transação: insere
o que falta, grava o estado do arquivo nas linhas não geridas (inclusive
`enabled: false`), desabilita a linha não gerida que saiu do arquivo e carimba
`managed_at` em toda linha do catálogo. Linha já gerida não é regravada:
importar de novo depois de uma edição na tela não desfaz a edição, e a
divergência segue no `diff`. É a transição de uma vez só; banco vazio e
fixture continuam nascendo do YAML sem ela. Ver `docs/data-model.md`
(`source`).

| Flag | Efeito |
|---|---|
| `--apply` | Grava o plano em vez de só imprimi-lo |

### `jho sources probe <kind> [handle] [--term <termo>]`

`"Test a source handle, or its term search with --term, without writing anything to
the database"`. Sem `--term`, chama `getAdapter(kind).fetchJobs({ kind, handle, label:
handle })` e imprime a contagem, os warnings do adapter e os 5 primeiros títulos.

Este é um dos dois comandos que **não** passam por `withDb()` — o outro é `jho profile`.
Ele não abre o banco, então é seguro
rodar contra um handle que você acabou de descobrir, antes de tocar `sources.yaml`.

Passa pela guarda de ingestão como `jobs sync` e `jobs recheck`. Sem `JHO_ENV`
(e sem `VERCEL_ENV`) o ambiente é tratado como `preview` e nega; `preview`,
`staging` e `dev` sempre negam; `local` só roda com `JHO_ENV=local` e
`JHO_INGESTION_OPT_IN=true`. A recusa sai com `IngestionBlockedError` antes de
abrir conexão:

```bash
JHO_ENV=local JHO_INGESTION_OPT_IN=true pnpm jho sources probe greenhouse stackblitz
```

| Flag | Efeito |
|---|---|
| `--term <termo>` | Exercita a busca por termo da plataforma em vez do feed. Imprime o total, se a plataforma está validada e os 5 primeiros títulos. Não reserva cota nem grava vaga, fila ou atribuição — é o probe que valida a integração antes de ela entrar nas capturas (`validatedOn`) |

```bash
pnpm jho sources probe remoteok --term "tech lead"
```

```
✓ remoteok term search returned 3 job(s) of about 3
  validated on 2026-09-19
  · Tech Lead — Zensurance
```

Plataforma sem busca por termo sai com código 1 (`greenhouse does not search by
term`); sem handle e sem `--term`, também.

```bash
pnpm jho sources probe greenhouse stackblitz
```

```
✓ greenhouse:stackblitz returned 41 job(s), complete listing
  · Staff Applied AI Engineer — Remote
  · Senior Software Engineer, Platform — Remote
  · Developer Advocate — Remote (US)
```

Handle com espaço ou vazio precisa de aspas:

```bash
pnpm jho sources probe remotive "ai engineer"
pnpm jho sources probe himalayas ""
```

**Zero vagas não prova handle errado — e em algumas fontes não prova nada.**
Handles conferidos contra a API real em 2026-09-18, úteis para separar "o
adapter está quebrado" de "escrevi o identificador errado":

```bash
pnpm jho sources probe smartrecruiters BoschGroup   # 500 vagas
pnpm jho sources probe recruitee grip               # 3 vagas
```

A SmartRecruiters devolve `totalFound: 0` com HTTP 200 tanto para identificador
inexistente quanto para empresa sem vaga aberta — `Visa` e `Bosch` parecem
certos e são os dois zero. O Recruitee separa os casos: subdomínio inexistente
responde `Not Found`, board vazio responde lista vazia. Detalhe por fonte em
[`docs/sources.md`](sources.md).

Um `kind` sem adapter registrado em `src/core/sources/registry.ts` faz `getAdapter()`
lançar:

```bash
pnpm jho sources probe workable acme
```

```
No adapter registered for source kind "workable"
```

`workable` e `manual` existem no type `SourceKind` e passam na validação Zod do YAML,
mas não estão em `ADAPTERS` — logo passam no load e quebram no fetch.

> **Invariante:** Adicionar uma fonte = um arquivo/adapter em `src/core/sources/` + uma
> entrada em `registry.ts` + uma entrada em `config/sources.yaml` **com `rationale`**,
> validada contra a API real por `pnpm jho sources probe <kind> <handle>` antes do
> commit. Nunca escreva um mapeamento de campos a partir da documentação sem conferir
> uma resposta real.

---

## Área `terms` — buscas por termo salvas

O candidato salva termos ("php", "Tech Lead") na tela Buscas; cada termo busca
vagas nas plataformas que buscam por termo (Remotive, RemoteOK, Himalayas,
Jobicy, Workable, Hacker News) e é
repetido todo dia pela varredura. Regras de plataforma, cota e atribuição em
[`docs/sources.md`](sources.md#busca-por-termo).

### `jho terms run [--max <n>]`

Enfileira a captura de hoje de cada termo ativo — uma vez por chave, entre
todos os candidatos, sem termo pausado nem termo de trilha arquivada — e drena a
fila com o mesmo executor que a tela usa. É o passo "Buscar os termos salvos"
da varredura diária.

- Passa pela guarda de ingestão: onde ela nega, imprime o motivo e sai com 1,
  sem abrir banco nem rede.
- Captura já feita hoje (pela tela ou por outro candidato) é reaproveitada: não
  há segunda chamada à plataforma.
- Imprime uma linha JSON por plataforma, e nada mais — termo e consulta nunca
  vão para o log:

```
{"platform":"remotive","claimed":2,"succeeded":2,"waiting":0,"failed":0,"created":14,"known":3}
{"platform":"remoteok","claimed":2,"succeeded":1,"waiting":1,"failed":0,"created":2,"known":0}
```

- Sai com 1 quando todas as plataformas falharam na execução (a varredura
  quebra e alguém olha); falha parcial não quebra.

| Flag | Efeito |
|---|---|
| `--max <n>` | Para depois de `n` capturas |

### `jho terms status`

A saúde agregada por plataforma, a mesma da tela `/admin/captures`: uso das
janelas de cota, capturas por estado nas últimas 24 horas, último erro, dias
seguidos de falha, se a repetição diária parou e se a plataforma está vermelha.
Uma linha JSON por plataforma, sem termo, consulta nem candidato.

## Área `tracks` — trilhas de alvo

### `jho tracks list [--candidate <id>]`

As trilhas de um candidato (o ativo, por padrão), com estado e quantas vagas
cada uma tem pontuadas. A principal leva `★`. Candidato sem perfil próprio não
tem trilha: a principal fica pendente e ninguém pontua para ele.

```
★ Principal                    active     4122 scored
  PHP                          active      318 scored
```

## Área `jobs` — sync, score e navegação

Grupo `jobs`, descrição `"Sync, score and browse jobs"`.

### `jho jobs sync`

`"Fetch every configured source and upsert the results"`. Sequência exata:
`runMigrations()` → `loadSources()` → `catalogForSync()` (espelha o YAML nas linhas não
geridas e seleciona do banco as fontes habilitadas, não aposentadas, com adapter e fora de
`~terms`) → `syncAll(configs, { concurrency, onProgress })` → `scoreAll()` (salvo com
`--no-score`). Uma fonte desligada pela tela fica fora mesmo presente no YAML.

| Flag | Default | Descrição |
|---|---|---|
| `--concurrency <n>` | `"4"` | parallel sources |
| `--no-score` | — | skip scoring after the sync |

`--no-score` é uma booleana negada do Commander: sem ela `opts.score === true`, com ela
`opts.score === false`, e o código testa `if (opts.score !== false)`.

```bash
pnpm jho jobs sync
```

```
Syncing 12 source(s)…

  ✓ greenhouse:stackblitz         11 fetched  +0 new  0 updated  0 closed 241ms
  ✓ ashby:textlayer                1 fetched  +0 new  0 updated  0 closed 438ms
  ! ashby:reflow returned no listed jobs
  ✗ ashby:handle-errado           GET https://api.ashbyhq.com/... -> 404 183ms
  ✓ lever:jobgether             4691 fetched  +0 new  6 updated  0 closed 14344ms
  ✓ remotive:ai engineer          50 fetched  +3 new  0 updated  0 closed  partial window: absence closes nothing 612ms

Totals  5119 fetched · 200 new · 7 updated · 24 closed · 1 failed

Scoring 200 job(s) scored · best fit 74
```

`partial window` marca a fonte que é uma janela (as mais recentes, as
primeiras páginas): ela nunca fecha vaga por ausência, e o `closed` dela é
sempre 0. A tabela de completude por fonte está em
[`sources.md`](sources.md#completude-da-listagem).

Exemplo ilustrativo, com uma fonte quebrada de propósito para mostrar como a
falha aparece. Um `✗` **não interrompe o sync** — as outras 11 fontes seguem, e
o erro fica registrado em `source.lastError`, visível em `jho sources list`.
No estado atual do repositório as 12 fontes retornam `ok`.

Sync mais lento e sequencial, para debugar ordem de chamadas:

```bash
pnpm jho jobs sync --concurrency 1
```

Só ingerir, adiando o scoring (útil quando você vai mexer no `profile.yaml` logo em
seguida e repontuar tudo de uma vez):

```bash
pnpm jho jobs sync --no-score
```

> **Invariante:** Uma fonte que falha é registrada e pulada — nunca aborta a run. O
> `try/catch` de `syncOne()` grava `source.lastStatus = 'error'` e `source.lastError` e
> segue para a próxima. Um board com handle errado não pode custar as outras 11 fontes.

### `jho jobs score`

`"Recompute fit scores"`. Chama `scoreAll({ all })`.

| Flag | Default | Descrição |
|---|---|---|
| `--all` | — | rescore every open job, not just unscored ones |

Sem `--all`, o `WHERE` é
`job.closed_at is null and (job_score.job_id is null or job_score.scorer_version <> SCORER_VERSION)`.
Com `--all`, é apenas `job.closed_at is null` — vaga fechada nunca é repontuada, em
nenhum dos dois modos.

```bash
pnpm jho jobs score
```

```
✓ scored 112 job(s) · best fit 74
```

```bash
pnpm jho jobs score --all
```

```
✓ scored 4997 job(s) · best fit 74
```

`scoreAll()` sempre chama `loadProfile(true)`, ou seja, força releitura do
`profile.yaml` do disco — não há cache stale entre execuções.

> **Invariante:** Mexeu em `profile.yaml` ou no scorer? Faça bump de `SCORER_VERSION`
> em `src/core/scoring/score.ts` (hoje `"1.0.0"`) e rode `pnpm jho jobs score --all`.
> Sem o bump, o `jobs score` normal considera os scores antigos válidos e eles se
> misturam com os novos sem ninguém perceber que a tabela ficou com duas gerações de
> critério.

### `jho jobs list` (alias `jho jobs ls`)

`"Browse matching jobs, best fit first"`. Chama
`listBoard({ minFit, status, limit: limit * 3 })` — o SQL busca o triplo de linhas
porque o filtro de `--cluster` (e o de `--status`) roda **em memória**, depois da query;
o corte final em `--limit` acontece por último.

| Flag | Default | Descrição |
|---|---|---|
| `--min-fit <n>` | `"45"` | minimum fit score |
| `--cluster <name>` | — | filter by target cluster |
| `--status <name>` | — | filter by pipeline status, `'unfiled'` or `'any'`; without it, archived jobs ("não me interessa") are hidden |
| `--limit <n>` | `"30"` | maximum rows |
| `--json` | — | machine-readable output |

`listBoard()` já restringe a `job.closed_at IS NULL` e
`coalesce(job_score.fit, 0) >= minFit`, ordenando por
`coalesce(fit,0) DESC, first_seen_at DESC`.

Valores válidos de `--cluster` são as chaves de `targets.clusters` no `profile.yaml`
(`architect`, `staff`, `ai_lead`, `eng_lead`, `senior_ic`) mais `other`, atribuído pelo
scorer quando nenhum cluster bate.

Valores válidos de `--status` são os de `APPLICATION_STATUSES` mais o pseudo-status
`unfiled` (linhas sem `application`, isto é `status === null`):

```
backlog · shortlisted · preparing · applied · screening ·
interviewing · offer · rejected · withdrawn · archived · unfiled
```

```bash
pnpm jho jobs list --min-fit 60 --cluster architect --limit 10
```

```
   ID  FIT  CLUSTER    COMPANY               ROLE                                     STATUS
  318   74  architect  TextLayer             Staff AI Architect                       shortlisted
  902   68  architect  Jobgether             AI Solutions Architect (Remote)          —
       ⚠ Requires US work authorization
  145   61  architect  Reflow                Principal Architect, Platform            —

  3 row(s). Details: jho jobs show <id>
```

A coluna `FIT` é colorida: `>= 70` verde, `>= 50` amarelo, abaixo disso dim. A linha
`⚠` aparece sempre que `job_score.blockers` não está vazio — ela é informativa, não
exclui a vaga da lista (blockers **capam** a nota via penalidade, não zeram a vaga).

Só o que ainda não entrou no funil:

```bash
pnpm jho jobs list --status unfiled --min-fit 55
```

Saída para consumo por agente/script:

```bash
pnpm jho jobs list --min-fit 65 --limit 20 --json
```

```json
[
  {
    "jobId": 318,
    "title": "Staff AI Architect",
    "companyName": "TextLayer",
    "locationRaw": "Remote — Americas",
    "url": "https://jobs.ashbyhq.com/textlayer/...",
    "applyUrl": null,
    "postedAt": "2026-08-11",
    "firstSeenAt": "2026-08-18T11:02:15.412Z",
    "fit": 74.2,
    "cluster": "architect",
    "blockers": [],
    "reasons": ["Title matches \"AI Solutions Architect\" (cluster architect)", "..."],
    "status": "shortlisted",
    "appliedAt": null
  }
]
```

O `--json` imprime exatamente as linhas `BoardRow` de `src/core/db/repo.ts`, já filtradas
e cortadas.

### `jho jobs add <url>`

O caminho para uma vaga que você encontrou em qualquer lugar — um post no
LinkedIn, uma newsletter, uma indicação.

```bash
pnpm jho jobs add "https://jobs.ashbyhq.com/textlayer/8dbad922-..."
```

Reconhece o ATS pela URL (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee)
e **puxa a vaga completa** pelo adapter que já existe, em vez de pedir três
campos digitados. Quando o host é reconhecível mas ilegível — LinkedIn, Workday,
Indeed, Gem, Loxo — diz isso e cai para entrada manual.

| Flag | Efeito |
|---|---|
| `-t, --title <text>` | Título, quando a URL não resolve |
| `-c, --company <name>` | Empresa, quando a URL não resolve |
| `-l, --location <text>` | Local anunciado |
| `-d, --description <text>` | Descrição — **sem ela o score de keywords fica em zero** |
| `--posted <date>` | Data de publicação (ISO) |
| `-n, --notes <text>` | Sua nota sobre a vaga |
| `-s, --status <name>` | Já coloca no funil |

Uma vaga adicionada à mão é linha de primeira classe: mesma tabela, mesmo
fingerprint, mesmo scorer. É isso que faz ela **deduplicar** contra a mesma vaga
chegando depois por um sync.

### `jho jobs import <file>`

Importa um payload JSON capturado de uma plataforma que só serve vagas logado —
Revelo, BairesDev, marketplaces. Ver `docs/sources-autenticadas.md`.

```bash
pnpm jho jobs import ~/revelo.json --source revelo \
  --base-url "https://app.careers.revelo.com/#/international/positions" --dry-run
```

| Flag | Obrigatória | Efeito |
|---|---|---|
| `--source <key>` | sim | Chave curta da fonte, ex.: `revelo` |
| `--label <name>` | não | Rótulo legível |
| `--company <name>` | não | Empresa, quando o payload não traz |
| `--base-url <url>` | não | Prefixo para montar URL a partir de ids |
| `--dry-run` | não | Analisa e reporta sem gravar |

O parser não assume formato: acha o array com qualquer nome de envelope, casa
nomes de campo sem ligar para maiúsculas, e lê valores de objetos aninhados.
Ao final **lista os campos que não soube mapear** — se aparecer algo útil, vale
estender. E **avisa quando nenhuma vaga trouxe descrição**, que é a assinatura
de ter copiado o endpoint de listagem em vez do de detalhe.

Fontes importadas nascem **desabilitadas**: `jobs sync` nunca tenta buscar algo
que não tem endpoint público.

### `jho jobs verify`

Checa se as vagas do topo ainda existem, e fecha as que sumiram.

```bash
pnpm jho jobs verify --min-fit 55 --limit 250
```

| Flag | Padrão | Efeito |
|---|---|---|
| `--min-fit <n>` | `55` | Só verifica acima deste fit |
| `--limit <n>` | `100` | Quantas checar |
| `--dry-run` | — | Reporta sem fechar nada |

```
✓ 250 verificadas · 203 vivas · 47 mortas · 0 inconclusivas

  lever               47 mortas de 191  25%
  himalayas            0 mortas de  36
  braintrust           0 mortas de   5
```

> **Invariante:** só **404** e **410** fecham uma vaga. Um **403** é o site
> bloqueando bot — o Himalayas devolve isso em toda requisição — e fechar por
> 403 apagaria vagas vivas. Timeout e 5xx não provam nada e entram como
> inconclusivos.

### `jho jobs archive`

Tira do quadro ativo vagas fechadas há muito tempo, sem apagar linha nenhuma.

```bash
pnpm jho jobs archive --closed-days 90            # dry-run
pnpm jho jobs archive --closed-days 90 --apply
```

| Flag | Padrão | Efeito |
|---|---|---|
| `--closed-days <n>` | `90` | Arquivar fechamentos anteriores a N dias |
| `--limit <n>` | `500` | Teto de vagas examinadas por execução |
| `--apply` | — | Sem esta flag o comando é somente leitura |

```
Arquivamento · dry-run
  corte: fechadas até 2026-06-20 (90 dias)
  412 examinada(s) · 380 elegível(is) · 2 com candidatura preservada
  mantidas: 21 recent-closure · 8 inconclusive-probe · 3 manual-source
  Nada mudou. Rode de novo com --apply para persistir.
```

> **Invariante:** arquivar **não** toca em `application` nem em
> `application_event`, e não apaga vaga — quem apaga é `db prune`, e só o que
> nunca teve candidatura. Sondagem inconclusiva nunca arquiva, fonte manual
> fica fora, e um `alive` posterior desfaz o arquivamento na mesma linha.

Verifica só o topo de propósito: checar 6.000 links para policiar linhas que
ninguém vai abrir seria indelicado com os boards e inútil aqui.

### `jho jobs show <id>`

`"Full detail for one job, including why it scored the way it did"`. Faz
`SELECT` em `job` `LEFT JOIN job_score` `LEFT JOIN application` por `job.id`.

Sem flags.

```bash
pnpm jho jobs show 318
```

```
Staff AI Architect  #318
TextLayer · Remote — Americas
source ashby:textlayer · first seen 2026-08-18

https://jobs.ashbyhq.com/textlayer/8f2c...

Fit 74.2 / 100  (cluster: architect)
  title 35 · keywords 24.6 · seniority 12 · geo 15 · comp 4 · penalty -5
  · Title matches "AI Solutions Architect" (cluster architect)
  · Explicitly open to LATAM/Brazil
  · No compensation disclosed

  Matched: ai architect, multi-agent, typescript, aws, rag
  Missing: kubernetes

Pipeline shortlisted

Description (first 1200 chars)
We are looking for a Staff AI Architect to…
```

Notas de leitura:

- O link impresso é `applyUrl ?? url`.
- O breakdown é a decomposição literal do score: `title`, `keywords`, `seniority`,
  `geo`, `comp` e `penalty` (a penalidade é subtraída do total).
- `CLOSED <data>` aparece na linha de metadados quando `closedAt` não é nulo.
- Sem linha `application`, o comando sugere `jho track <id> shortlisted`.
- A descrição é truncada em 1200 caracteres — é preview, não o texto integral.

Id inexistente:

```bash
pnpm jho jobs show 999999
```

```
No job with id 999999
```

…e `process.exitCode = 1`, o que torna o comando utilizável em `&&` de shell.

---

## `jho track <id> <status>`

`"Move a job through the pipeline (backlog | shortlisted | preparing | applied |
screening | interviewing | offer | rejected | withdrawn | archived)"` — a descrição é
montada com `${APPLICATION_STATUSES.join(" | ")}`. Valida `status` contra `APPLICATION_STATUSES`
**antes** de abrir o banco; status inválido imprime a lista de válidos e sai com
`exitCode = 1`. Em seguida chama `setApplicationStatus(jobId, status, note)`, que cria a
linha em `application` se ainda não existir e **sempre** grava um `application_event`
com `kind = "status_change"`.

| Flag | Default | Descrição |
|---|---|---|
| `-n, --note <text>` | — | attach a note to the transition |

A nota vira `application_event.detail` — ela **não** sobrescreve `application.notes`.

Status válidos, na ordem em que aparecem em `APPLICATION_STATUSES`:

| Status | Uso |
|---|---|
| `backlog` | Default da coluna; entrou no radar |
| `shortlisted` | Vale o esforço de preparar |
| `preparing` | CV/cover em produção |
| `applied` | Enviado — carimba `applied_at` na primeira vez que atinge este estado |
| `screening` | Triagem com recruiter |
| `interviewing` | Rodadas técnicas |
| `offer` | Proposta na mesa |
| `rejected` | Encerrado pelo outro lado |
| `withdrawn` | Encerrado por você |
| `archived` | Fora do radar, sem juízo de valor |

```bash
pnpm jho track 318 shortlisted
```

```
✓ job 318 → shortlisted
```

```bash
pnpm jho track 318 applied -n "aplicado via ATS, CV variant architect"
```

```
✓ job 318 → applied
```

Status inválido:

```bash
pnpm jho track 318 interview
```

```
Unknown status "interview". Valid: backlog, shortlisted, preparing, applied, screening, interviewing, offer, rejected, withdrawn, archived
```

> **Invariante:** `application_event` é append-only. Cada transição gera uma linha com
> `fromStatus`/`toStatus`; é dela que sai qualquer métrica de funil futura. Nenhum
> comando deve atualizar status "por fora" de `setApplicationStatus()`.

---

## `jho pipeline`

`"Show the application funnel"`. Combina `pipelineCounts()` (um `GROUP BY
application.status`) com uma listagem de `application INNER JOIN job` ordenada por
`application.updated_at DESC`.

Sem flags.

```bash
pnpm jho pipeline
```

```
  FUNNEL
    shortlisted      4
    applied          2
    interviewing     1

   ID  STATUS         COMPANY               ROLE
  318 applied        TextLayer             Staff AI Architect
       next: follow-up com o recruiter na sexta
  902 shortlisted    Jobgether             AI Solutions Architect (Remote)
```

O funil só imprime status com contagem maior que zero, respeitando a ordem de
`APPLICATION_STATUSES` (e não a ordem de contagem). A linha `next:` só aparece quando
`application.next_action` está preenchido — e **nada no projeto escreve esse campo**:
`setApplicationStatus()` (`src/core/db/repo.ts`) não o toca, e as únicas referências em
`src/` são leituras (`src/cli.ts`) mais a definição da coluna
(`src/core/db/schema.ts:181`). Hoje só um `UPDATE` manual no PostgreSQL preenche
`next_action` / `next_action_at`.

Funil vazio:

```
  FUNNEL

  Nothing tracked yet. Start with: jho track <id> shortlisted
```

---

## `jho report`

`"Export a markdown snapshot into the Obsidian vault"`. Chama
`buildReport({ minFit, limit, outPath })`, que monta um markdown em pt-BR com as seções
`# Vagas — match com o perfil (YYYY-MM-DD)`, `## Funil`, `## Novas oportunidades` e —
quando há vagas com status diferente de `backlog` — `## Em andamento`.

| Flag | Default | Descrição |
|---|---|---|
| `--min-fit <n>` | `"45"` | minimum fit score |
| `--limit <n>` | `"100"` | maximum rows |
| `--out <path>` | — | write somewhere else |
| `--stdout` | — | print instead of writing |

Resolução do destino (`target`, em `src/core/report/markdown.ts`), em ordem:

1. `--out <path>` **sem** `--stdout` → escreve exatamente nesse caminho (`mkdir -p` do
   diretório incluso). `--stdout` anula o `--out`: a CLI passa
   `outPath: opts.stdout ? undefined : opts.out`.
2. Sem `outPath` → `<JHO_VAULT_PATH>/<JHO_REPORT_DIR>/vagas-match-<YYYY-MM-DD>.md`,
   onde `JHO_REPORT_DIR` tem default `05_Interviews/LinkedIn`.
3. Sem `outPath` **e** sem `JHO_VAULT_PATH` → `target` é `null`, **nada é escrito** e o
   markdown cai no stdout.

`--stdout` **não** é dry-run: ele apenas força o `console.log(markdown)`. Como
`JHO_VAULT_PATH` está definido no caso normal (o valor vive em `.env.example:36`),
`pnpm jho report --stdout` **imprime e também escreve** o snapshot do dia no vault.
Para imprimir sem tocar em disco, zere a variável no ambiente — o `--env-file-if-exists`
do script `jho` deixa o ambiente vencer o `.env`:

```bash
JHO_VAULT_PATH= pnpm jho report --min-fit 60 --stdout
```

> **Invariante:** a única condição que impede a escrita é `target === null`, isto é,
> nenhum `outPath` **e** `JHO_VAULT_PATH` vazio/ausente. Nunca trate nem documente
> `--stdout` como "não escreve".

```bash
pnpm jho report
```

```
✓ wrote /Users/andreus/Documents/Obsidian Vault/05_Interviews/LinkedIn/vagas-match-2026-08-18.md
```

```bash
pnpm jho report --min-fit 60 --limit 40 --stdout
```

```markdown
# Vagas — match com o perfil (2026-08-18)

> Gerado por `master-jobs`. Fontes: APIs públicas de ATS e agregadores remotos.
> Corte de fit: 60. Vagas listadas: 38.

## Funil

| Status | Quantidade |
|---|---:|
| shortlisted | 4 |
```

Salvar fora do vault, para revisar antes de commitar mentalmente ao vault:

```bash
pnpm jho report --min-fit 55 --out ./out/relatorio.md
```

A separação interna: `open` = linhas sem status ou com status `backlog`; `tracked` =
todo o resto. Pipes dentro de títulos e nomes de empresa são escapados por `esc()`, então
o markdown não quebra com vagas do tipo `Engineer | Platform`.

---

## `jho profile`

`"Validate profile.yaml and print the resolved targets"`. Chama `loadProfile(true)`,
que força releitura do disco e valida com `ProfileSchema` (Zod v4). Este comando **não
abre o banco** — é puro I/O de arquivo mais validação.

Sem flags.

```bash
pnpm jho profile
```

```
✓ profile.yaml is valid

Andreus Jarta Timm — Senior AI Software Architect
São Paulo, Brazil · 20+ years

Target clusters
  architect    weight 1  cv:architect
    AI Solutions Architect · AI Software Architect · Software Architect · …
  staff        weight 0.95  cv:staff
    Staff Software Engineer · Principal Software Engineer · …
  ai_lead      weight 0.95  cv:ai
    AI Engineering Lead · Head of AI Engineering · …
  eng_lead     weight 0.85  cv:lead
    Engineering Lead · Engineering Manager · …
  senior_ic    weight 0.6  cv:senior

Keywords 14 critical · 23 strong · 22 stack · 9 negative
Blockers 8 patterns
```

Um YAML inválido não imprime nada disso: `loadProfile()` agrega os issues do Zod e
lança um erro listando cada um como `path: message`, que o `catch` da raiz imprime em
vermelho com `exitCode = 1`.

> **Invariante:** Zod valida tudo que é editado à mão (`profile.yaml` via
> `ProfileSchema`, `config/sources.yaml` via `SourcesFile`) e falha alto. Um typo num
> `weight` deve quebrar no load, não produzir silenciosamente um scorer que ranqueia
> tudo em zero. `jho profile` é o jeito barato de exercitar essa validação sem tocar o
> banco.

---

## Área `tasks` — plano de posicionamento

O plano de ação da auditoria de julho/2026 como linhas executáveis, em cinco
horizontes (`24h`, `week`, `30d`, `60d`, `90d`). Populado por `jho db seed`.

### `jho tasks list` (alias `jho tasks ls`)

```bash
pnpm jho tasks list                  # só o que está em aberto
pnpm jho tasks list --horizon 24h    # um horizonte
pnpm jho tasks list --all            # inclui done e skipped
```

| Flag | Padrão | Efeito |
|---|---|---|
| `--horizon <name>` | — | Filtra por `24h`, `week`, `30d`, `60d` ou `90d` |
| `--all` | desligado | Inclui tarefas `done` e `skipped` |

```
  24H
    PT-0001  P0  Alinhar os cargos do Open to Work                    15 min
    PT-0002  P0  Trocar a headline                                     5 min
    PT-0003  P0  Reordenar as 5 competências principais               20 min
    PT-0004  P0  Atualizar a bio do GitHub                             5 min
    PT-0005  P2  Limpar informações de contato                         5 min
    PT-0006  P1  Registrar a baseline de métricas                     10 min
```

Prioridade `P0` sai em vermelho, `P1` em amarelo, o resto esmaecido.

### `jho tasks show <id>`

Detalhe completo de um item: por que fazer, como executar, resultado esperado
e a referência exata da seção do relatório que originou a tarefa.

```bash
pnpm jho tasks show PT-0001
```

O id não diferencia maiúsculas — `pt-0001` funciona.

### `jho tasks done <id>`

```bash
pnpm jho tasks done PT-0001
pnpm jho tasks done PT-0019 --status skipped
```

| Flag | Padrão | Efeito |
|---|---|---|
| `--status <name>` | `done` | `todo`, `doing`, `done` ou `skipped` |

`done` carimba `doneAt`; qualquer outro status limpa o carimbo — é o que separa
"concluí" de "desisti" na hora de ler o histórico.

Status fora dessa lista é recusado com código 1, e id que não existe também. Até
20/08/2026 nenhum dos dois era: `--status feito` gravava `feito` e a tarefa sumia
das listagens, e `tasks done PT-9999` imprimia o ✓ verde sem ter tocado em linha
nenhuma. Ver B-07 no backlog.

## Área `fx` — câmbio

Cotações usadas para comparar remuneração entre moedas. Sem elas, uma vaga em
CAD é medida contra um piso em USD como se fossem a mesma unidade — o defeito
que a versão 1.1.0 do scorer corrigiu.

### `jho fx refresh`

```bash
pnpm jho fx refresh
```

```
✓ 29 cotações de 2026-08-18 (base USD, via frankfurter)
  AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY ZAR
```

| Flag | Padrão | Efeito |
|---|---|---|
| `--base <currency>` | `USD` | Moeda base da tabela |

Fonte primária: [Frankfurter](https://frankfurter.dev), que publica as taxas de
referência do Banco Central Europeu — sem chave, sem cadastro. Fallback:
`open.er-api.com`, para moedas fora das 30 do BCE.

As taxas ficam em `fx_rate`, indexadas pela **data da cotação**. O scorer nunca
faz requisição: lê a tabela. Isso mantém a pontuação pura, offline e —
principalmente — reproduzível, já que a taxa que produziu um score continua em
disco.

### `jho fx show`

Imprime a tabela em cache, com a idade da cotação. Acima de 7 dias o aviso fica
vermelho. O BCE não publica em fim de semana e feriado, então 2–4 dias é normal.

---

## Área `mail` — caixa de entrada

Implementa a [ADR 0008](adr/0008-ingestao-de-email-como-fonte-de-sourcing.md).
Leia a ADR antes de mexer: ela contém as três travas que tornam este caminho
defensável.

### `jho mail import <path>`

```bash
pnpm jho mail import ~/mail/alertas --dry-run
pnpm jho mail import ~/mail/alertas
```

Aceita um arquivo ou um diretório com `.eml`, `.txt` ou `.html`.

| Flag | Efeito |
|---|---|
| `--dry-run` | Classifica e reporta sem gravar nada |

Cada mensagem é classificada em `job_alert`, `ats_received`, `ats_screening`,
`ats_interview`, `ats_offer`, `ats_rejection`, `recruiter_inbound` ou `unknown`.
Alertas viram vagas; e-mails de ATS viram **sugestões**.

> **Invariante:** parsear e-mail nunca escreve em `application`. Grava em
> `mail_suggestion` e o usuário decide. Um parser de rejeição que erra uma vez e
> fecha silenciosamente um processo vivo seria o pior defeito possível — "sem
> resposta" é indistinguível de "rejeitado" para quem parou de fazer follow-up.

Deduplicação por `Message-ID`; um `.eml` sem esse header cai para o caminho do
arquivo.

### `jho mail suggestions` (alias `sug`)

Lista as mudanças de funil que os e-mails sugerem, com a confiança e o sinal que
produziu cada uma.

```
   ID  CONF  STATUS SUGERIDO  ASSUNTO
    2  0.95  rejected         Update on your application to TextLayer
       rejeição: move forward with other candidat — casado com "TextLayer"
```

### `jho mail accept <id>` · `jho mail dismiss <id>`

Aplica ou descarta. Ao aceitar, a transição passa por `setApplicationStatus`
como qualquer outra, então fica registrada em `application_event` igual a uma
mudança manual — não há caminho paralelo.

---

## Área `contacts` — rede profissional

Referrals são ~7% dos candidatos e ~40% das contratações. Até esta área existir,
`application.channel` era uma coluna que nada preenchia.

### `jho contacts seed`

Carrega as 14 empresas onde Andreus já trabalhou ou entregou, a partir do
currículo. Ex-empregador ou ex-cliente abrindo vaga é o mais perto de uma
indicação quente que existe.

### `jho contacts add <name>`

```bash
pnpm jho contacts add "Fulana de Tal" -c Braintrust -k ai-leader -r "Head of AI"
```

| Flag | Obrigatória | Efeito |
|---|---|---|
| `-c, --company <name>` | sim | Onde a pessoa trabalha |
| `-k, --category <name>` | não (`peer`) | `recruiter`, `ai-leader`, `peer`, `former`, `company` |
| `-r, --role <title>` | não | Cargo |
| `-u, --url <linkedin>` | não | Perfil — é a chave natural de deduplicação |
| `--country <code>` | não | País |
| `-n, --notes <text>` | não | Como você conhece a pessoa |

Ao adicionar, o comando já informa se isso destrava alguma vaga que está no
acervo.

### `jho contacts list` (alias `ls`)

| Flag | Efeito |
|---|---|
| `-k, --category <name>` | Filtra por categoria |

---

## `jho referrals`

Vagas abertas em empresas onde já existe contato, melhor fit primeiro.

| Flag | Padrão | Efeito |
|---|---|---|
| `--min-fit <n>` | `45` | Corte de aderência |

O casamento normaliza os dois lados com o mesmo slug que o deduplicador usa, de
modo que um contato na "Nubank" é encontrado numa vaga de "Nubank Ltd" sem
casar "Scope3" com "Scope AI".

Quando não há nada, o comando diz **por quê** — se é falta de contato ou falta
de vaga aberta. Silêncio seria indistinguível de defeito.

---

## Área `auth` — contas

### `jho auth add-user <email> [--role <papéis>]`

Cria ou atualiza uma conta. `--role` aceita `admin`, `candidate` e
`recruiter`, separados por vírgula; o padrão é `candidate`.

Com o papel `candidate`, a conta recebe um candidato:

- o do `profile.yaml` (`default`) só quando ela é a primeira conta da
  instalação — o primeiro acesso do dono;
- em qualquer outro caso, um candidato **novo e próprio** (`user-<email>`,
  com sufixo `-2`, `-3`… se o slug já existir). Candidato de conta apagada
  nunca é reaproveitado.

O candidato novo recebe o nome de exibição da conta, quando ela já tem um; sem
ele, nasce **sem nome**: `/candidate` pede o nome, e `/p/<endereço>` mostra um
título neutro até a pessoa escrevê-lo. O e-mail nunca vira nome: o nome é o
título de `/p/<endereço>`.

A conta nasce sem senha; defina com `jho auth set-password <email>`.

Não há `--candidate <id>`: apontar uma conta para o candidato de outra pessoa
é leitura de dado alheio fora da impersonação auditada. Rodar de novo atualiza
os papéis e nunca troca o candidato já vinculado — só preenche quando falta.
Um candidato tem no máximo uma conta (índice `auth_user_candidate_idx`).

### `jho auth seed [email]`

Cria a conta do dono (admin + candidato `default`) com senha gerada, mostrada
uma vez. Recusa um e-mail diferente quando o candidato `default` já pertence a
outra conta.

## Variáveis de ambiente que a CLI respeita

Carregadas de `.env` pelo `--env-file-if-exists=.env` do script `jho`.

| Variável | Lida em | Efeito |
|---|---|---|
| `DATABASE_URL` | `src/core/db/client.ts` | URL PostgreSQL do runtime; obrigatória |
| `DATABASE_MIGRATION_URL` | `src/core/db/migrate.ts` | URL PostgreSQL para migrations; obrigatória em `db migrate` |
| `DATABASE_CA_CERT` | `src/core/db/client.ts` | CA opcional para PostgreSQL gerenciado |
| `JHO_PROFILE_PATH` | `src/core/profile/load.ts` | Override de `profile/profile.yaml` |
| `JHO_SOURCES_PATH` | `src/core/sources/config.ts` | Override de `config/sources.yaml` |
| `JHO_USER_AGENT` | `src/core/sources/http.ts` | Header `user-agent` de toda chamada pública |
| `JHO_VAULT_PATH` | `src/core/report/markdown.ts` | Raiz do vault para `jho report` |
| `JHO_REPORT_DIR` | `src/core/report/markdown.ts` | Subdiretório do relatório; default `05_Interviews/LinkedIn` |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | `src/core/sources/aggregators.ts` | Sem eles o adapter `adzuna` retorna 0 jobs + warning, sem falhar |

> **Invariante:** URL ausente ou que não seja PostgreSQL falha alto e cedo.
> `getDb()` não escolhe um banco local silenciosamente, porque isso faria a run
> parecer bem-sucedida enquanto grava no lugar errado.

---

## Receitas

Fluxos reais, com mais de um comando. Todos rodáveis como escritos.

### 1. Varredura diária

O ciclo padrão: ingerir, ver o que subiu no topo, exportar para o vault.

```bash
pnpm jho jobs sync
pnpm jho terms run
pnpm jho jobs score
pnpm jho jobs list --min-fit 55 --status unfiled --limit 20
pnpm jho report
```

`jobs sync` já pontua ao final, mas as vagas que `terms run` trouxer entram sem
nota: `jobs score` pontua as que faltam (a varredura usa `--every-candidate`).
`jobs rescore run` não serve aqui — ele só drena a fila de repontuação, e
`terms run` não enfileira nada nela. O
`--status unfiled` esconde o que você já triou em dias anteriores, evitando reler as
mesmas 30 linhas toda manhã.

### 2. Retunar o perfil e repontuar tudo

Depois de editar `profile/profile.yaml` (pesos, `avoid_titles`, keywords, blockers):

```bash
# 1. o YAML ainda é válido? (não toca no banco)
pnpm jho profile

# 2. bump manual: SCORER_VERSION em src/core/scoring/score.ts

# 3. repontua TODA vaga aberta com o critério novo
pnpm jho jobs score --all

# 4. confere o efeito no topo da lista
pnpm jho jobs list --min-fit 60 --limit 15
```

O passo 2 não é opcional. Sem o bump, um `pnpm jho jobs score` posterior (sem `--all`)
vai considerar os scores antigos válidos e a tabela `job_score` fica com duas gerações
de critério misturadas, sem sinal nenhum de que isso aconteceu.

Alternativa para checar o impacto por cluster antes e depois:

```bash
pnpm jho jobs list --cluster architect --min-fit 0 --limit 30 --json > /tmp/antes.json
pnpm jho jobs score --all
pnpm jho jobs list --cluster architect --min-fit 0 --limit 30 --json > /tmp/depois.json
```

### 3. Triar uma vaga: da lista ao funil

```bash
# 1. o que existe acima do corte que ainda não foi triado
pnpm jho jobs list --min-fit 60 --status unfiled --limit 15

# 2. abrir o caso: breakdown do score, blockers, keywords, descrição
pnpm jho jobs show 318

# 3. decidir
pnpm jho track 318 shortlisted -n "LATAM explícito, stack bate; checar contrato PJ"

# 4. quando aplicar de fato (carimba applied_at)
pnpm jho track 318 applied -n "aplicado via ATS, CV variant architect"

# 5. onde tudo está
pnpm jho pipeline
```

`jobs show` é o passo que impede a lista de virar fé cega: a linha de breakdown
(`title · keywords · seniority · geo · comp · penalty`) diz exatamente por que aquele
número apareceu, e `Blockers:` diz o que já é sabidamente contra.

Descarte explícito também é informação — use `archived`, não silêncio:

```bash
pnpm jho track 902 archived -n "exige US work authorization"
```

### 4. Exportar para o vault do Obsidian

Com `JHO_VAULT_PATH` no `.env`, o destino é resolvido sozinho:

```bash
pnpm jho jobs sync
pnpm jho report --min-fit 50 --limit 60
```

```
✓ wrote /Users/andreus/Documents/Obsidian Vault/05_Interviews/LinkedIn/vagas-match-2026-08-18.md
```

Revisar a saída. Atenção: `--stdout` **também grava** o snapshot do dia no vault; para
só olhar, zere `JHO_VAULT_PATH` ou mande para fora do vault com `--out`:

```bash
JHO_VAULT_PATH= pnpm jho report --min-fit 50 --stdout | head -60
pnpm jho report --min-fit 50 --out ./out/vagas-hoje.md
```

O arquivo é nomeado por data (`vagas-match-<YYYY-MM-DD>.md`), então rodar o comando duas
vezes no mesmo dia **sobrescreve** o snapshot do dia — o que é o comportamento desejado:
um arquivo por dia, sempre o estado mais recente.

#### `jho dossiers` — um arquivo por vaga

Onde o `report` produz um panorama, o `dossiers` produz um markdown por vaga, com
a descrição inteira e frontmatter de `fit`, cluster e bloqueios — consultável
como nota do Obsidian.

```bash
pnpm jho dossiers --min-fit 70 --limit 30
pnpm jho dossiers --tracked --out ./out/vagas
```

| Flag | Padrão | Efeito |
|---|---|---|
| `--min-fit <n>` | `60` | piso de aderência |
| `--limit <n>` | `50` | quantos gerar |
| `--tracked` | — | só vagas já no funil |
| `--out <dir>` | — | destino, quando não há vault |

**Sem `--out` e sem `JHO_VAULT_PATH`, o comando recusa.** Ele não escolhe um
destino por você. Até 20/08/2026 caía em `./out/vagas`, e o problema não era o
caminho: era ser relativo a de onde a pessoa rodou, o que espalhava dezenas de
arquivos num lugar que ninguém procura depois. Ver B-08 no backlog.

### 5. Debugar uma fonte que falha

O sync não aborta quando uma fonte quebra, então a falha fica silenciosa até você olhar:

```bash
# 1. quem está em error e com qual mensagem
pnpm jho sources list

# 2. reproduzir a falha isolada, sem tocar o banco
pnpm jho sources probe arbeitnow ""

# 3. corrigido o adapter, re-rodar o probe até vir limpo
pnpm jho sources probe arbeitnow ""

# 4. sync sequencial para ver a ordem das chamadas e os warnings
pnpm jho jobs sync --concurrency 1

# 5. confirmar que o status voltou para ok
pnpm jho sources list
```

`probe` é o degrau certo para depurar porque não abre o banco, não escreve nada e imprime
os `warnings` que o adapter emite — que no sync completo se perdem no meio das outras 11
fontes. Warnings conhecidos e esperados (não são bugs):

- `ashby:<handle> returned no listed jobs` — o board existe mas está sem vaga publicada.
- `smartrecruiters:<handle> list endpoint has no job body; keyword scoring uses titles only` —
  limitação da API de listagem, não do código.
- `adzuna skipped: ADZUNA_APP_ID/ADZUNA_APP_KEY not set` — credencial ausente; o adapter
  degrada para zero vagas em vez de falhar.

### 6. Colocar um handle novo em produção

```bash
# 1. validar contra a API real ANTES de editar o YAML
pnpm jho sources probe ashby algum-board-novo

# 2. adicionar a entrada em config/sources.yaml, com rationale obrigatório

# 3. o loader aceitou? (fonte nova aparece como STATUS never)
pnpm jho sources list

# 4. primeira ingestão + scoring
pnpm jho jobs sync

# 5. a fonte nova trouxe algo relevante?
pnpm jho jobs list --min-fit 55 --limit 20
```

Se o passo 1 retorna `0 job(s)` ou lança, o handle está errado — não adiante para o
passo 2. E `enabled: false` no YAML desabilita a linha (enquanto ela não for gerida pelo
banco), ou seja, ela some de `sources list` e do sync sem precisar apagar a entrada nem o
`rationale`.

### 7. Higiene periódica do banco

```bash
pnpm jho db migrate
pnpm jho db cleanup --apply --closed-days 120
pnpm jho jobs score
pnpm jho pipeline
```

`db cleanup` só remove vagas fechadas há mais de `--closed-days` dias **e** sem nenhuma
`application` associada, então rodar isso nunca apaga histórico de candidatura. O
`jobs score` no final recupera qualquer vaga que tenha ficado sem score (por exemplo
depois de um `jobs sync --no-score`).
