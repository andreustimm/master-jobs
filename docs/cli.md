# Referência da CLI

## Por que isto existe

Hoje a CLI **é** o produto. Não há UI: `src/cli.ts` é a superfície de uso inteira do
`job-hunt-os` — buscar vagas em APIs públicas, pontuá-las de forma determinística,
mover candidaturas pelo funil e exportar um snapshot para o vault do Obsidian.

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
> `runMigrations()` antes de qualquer coisa, `ensureSources()` faz upsert do YAML, o
> upsert de `job` é decidido pelo `fingerprint` e o de `job_score` por
> `onConflictDoUpdate` em `job_id`. Nenhum comando novo pode quebrar essa propriedade.

> **Invariante:** A ingestão nunca escreve em `application`. `jobs sync` pode inserir,
> atualizar e fechar `job`; decisões do usuário (o funil) só mudam por `jho track`.

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
(`drizzle-orm/libsql/migrator` sobre a pasta `./drizzle`). Quando a URL do banco começa
com `file:`, `runMigrations()` cria o diretório do arquivo com `mkdir` recursivo antes —
sem isso o libSQL não abre o banco.

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
`loadSources()` (que já filtra `enabled: true`) e cruza com as linhas da tabela `source`
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
- Fonte com `enabled: false` no YAML **não aparece** aqui: `loadSources()` a descarta
  antes.

### `jho sources probe <kind> <handle>`

`"Test a source handle without writing anything to the database"`. Chama
`getAdapter(kind).fetchJobs({ kind, handle, label: handle })` e imprime a contagem, os
warnings do adapter e os 5 primeiros títulos.

Este é um dos dois comandos que **não** passam por `withDb()` — o outro é `jho profile`.
Ele não abre o banco, então é seguro
rodar contra um handle que você acabou de descobrir, antes de tocar `sources.yaml`.

Sem flags.

```bash
pnpm jho sources probe greenhouse stackblitz
```

```
✓ greenhouse:stackblitz returned 41 job(s)
  · Staff Applied AI Engineer — Remote
  · Senior Software Engineer, Platform — Remote
  · Developer Advocate — Remote (US)
```

Handle com espaço ou vazio precisa de aspas:

```bash
pnpm jho sources probe remotive "ai engineer"
pnpm jho sources probe himalayas ""
```

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

## Área `jobs` — sync, score e navegação

Grupo `jobs`, descrição `"Sync, score and browse jobs"`.

### `jho jobs sync`

`"Fetch every configured source and upsert the results"`. Sequência exata:
`runMigrations()` → `loadSources()` → `syncAll(configs, { concurrency, onProgress })` →
`scoreAll()` (salvo com `--no-score`).

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

Totals  5069 fetched · 197 new · 7 updated · 24 closed · 1 failed

Scoring 197 job(s) scored · best fit 74
```

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
| `--status <name>` | — | filter by pipeline status, or `'unfiled'` |
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
(`src/core/db/schema.ts:181`). Hoje só um `UPDATE` manual no SQLite preenche
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

> Gerado por `job-hunt-os`. Fontes: APIs públicas de ATS e agregadores remotos.
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

`done` carimba `doneAt`; qualquer outro status limpa o carimbo.

## Variáveis de ambiente que a CLI respeita

Carregadas de `.env` pelo `--env-file-if-exists=.env` do script `jho`.

| Variável | Lida em | Efeito |
|---|---|---|
| `TURSO_DATABASE_URL` | `src/core/db/client.ts`, `src/core/db/migrate.ts` | URL do banco; default `file:./data/jobs.db` |
| `TURSO_AUTH_TOKEN` | `src/core/db/client.ts` | Obrigatório quando a URL **não** começa com `file:` |
| `JHO_PROFILE_PATH` | `src/core/profile/load.ts` | Override de `profile/profile.yaml` |
| `JHO_SOURCES_PATH` | `src/core/sources/config.ts` | Override de `config/sources.yaml` |
| `JHO_USER_AGENT` | `src/core/sources/http.ts` | Header `user-agent` de toda chamada pública |
| `JHO_VAULT_PATH` | `src/core/report/markdown.ts` | Raiz do vault para `jho report` |
| `JHO_REPORT_DIR` | `src/core/report/markdown.ts` | Subdiretório do relatório; default `05_Interviews/LinkedIn` |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | `src/core/sources/aggregators.ts` | Sem eles o adapter `adzuna` retorna 0 jobs + warning, sem falhar |

> **Invariante:** URL remota sem token falha alto e cedo. `getDb()` lança quando
> `TURSO_DATABASE_URL` não começa com `file:` e `TURSO_AUTH_TOKEN` está vazio — falhar
> aqui é melhor que um 401 confuso no meio de uma run.

---

## Receitas

Fluxos reais, com mais de um comando. Todos rodáveis como escritos.

### 1. Varredura diária

O ciclo padrão: ingerir, ver o que subiu no topo, exportar para o vault.

```bash
pnpm jho jobs sync
pnpm jho jobs list --min-fit 55 --status unfiled --limit 20
pnpm jho report
```

`jobs sync` já pontua ao final, então `jobs score` é redundante aqui. O
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
passo 2. E `enabled: false` no YAML remove a fonte de `loadSources()`, ou seja, ela
some de `sources list` e do sync sem precisar apagar a entrada nem o `rationale`.

### 7. Higiene periódica do banco

```bash
pnpm jho db migrate
pnpm jho db prune --days 120
pnpm jho jobs score
pnpm jho pipeline
```

`db prune` só remove vagas fechadas há mais de `--days` dias **e** sem nenhuma
`application` associada, então rodar isso nunca apaga histórico de candidatura. O
`jobs score` no final recupera qualquer vaga que tenha ficado sem score (por exemplo
depois de um `jobs sync --no-score`).
