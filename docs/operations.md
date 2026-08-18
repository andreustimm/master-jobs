# Operação diária

## Por que isto existe

O `job-hunt-os` não é um produto: é uma rotina. O banco só vale alguma coisa se
duas coisas acontecerem com regularidade — o sync roda (o mundo muda) e você
registra o que fez (o sistema não tem como adivinhar). Este documento é o
runbook dessas duas coisas: o que rodar por dia, o que rodar por semana, como
saber se está funcionando, e o que fazer quando quebra.

A assimetria que organiza tudo: **vagas são re-buscáveis, candidaturas não.**
Um `job` perdido volta no próximo `jho jobs sync`. Uma linha de `application`
perdida é histórico que ninguém reconstrói. Toda a operação abaixo é desenhada
em volta disso.

> **Invariante:** Ingestão nunca escreve em `application`. `syncOne()` insere,
> atualiza e fecha `job`; jamais toca decisão do usuário. Se um agente precisar
> "corrigir" o pipeline durante um sync, a resposta é não.

Todos os comandos assumem o diretório do projeto e `pnpm` instalado. `pnpm jho`
expande para `node --experimental-strip-types --no-warnings
--env-file-if-exists=.env src/cli.ts`.

---

## O ciclo diário

Quatro passos, na ordem. Leva ~15 minutos quando não há nada de novo.

### 1. Sync

```bash
pnpm jho jobs sync
```

O que acontece, em ordem: `runMigrations()` (por isso não existe passo separado
de migração no dia a dia) → `loadSources()` lê `config/sources.yaml` e descarta
o que está `enabled: false` → `syncAll()` roda as fontes com concorrência 4 →
`scoreAll()` no final, salvo se você passar `--no-score`.

| Flag | Default | Quando usar |
|---|---|---|
| `--concurrency <n>` | `4` | Baixe para 1–2 se suspeitar de rate limit; suba pouco — são APIs públicas gratuitas de terceiros |
| `--no-score` | (score ligado) | Só quando quiser inspecionar a ingestão sem pagar o custo do scoring |

A linha por fonte é `fetched / +new / updated / closed / durationMs`. Leia três
sinais:

- **`+new` alto e `updated` zero** em um board pequeno: normal na primeira vez.
- **`updated` alto todo dia**: a fonte reescreve o corpo da vaga a cada request
  (o `contentHash` cobre `title|locationRaw|employmentType|compMin|compMax|descriptionText.slice(0,4000)`);
  não é erro, é ruído da fonte.
- **`closed` alto de repente**: a fonte devolveu menos vagas que da última vez.
  Confira se não foi degradação da API antes de acreditar que 200 vagas
  fecharam no mesmo dia.

> **Invariante:** Uma fonte que falha é registrada e pulada, nunca aborta a run.
> O `try/catch` de `syncOne()` grava `source.lastStatus = 'error'` e
> `source.lastError` e segue para a próxima. Nenhum handle errado pode custar as
> outras 11 fontes.

### 2. Revisar o topo da lista

```bash
pnpm jho jobs list --min-fit 60
pnpm jho jobs list --min-fit 45 --cluster architect --limit 20
```

`FIT` é colorido por faixa: **verde ≥ 70**, **amarelo ≥ 50**, cinza abaixo
disso. Linhas com `⚠` listam os `blockers` — não são descarte automático: um
blocker custa 12 pontos, não zera a vaga, exatamente para que um bom papel que
diz "US preferred" continue visível, só que não no topo.

Duas armadilhas do comando, ambas por implementação e não por bug:

- `--cluster` é filtro **em memória**, aplicado depois do SQL. O CLI busca
  `limit * 3` linhas, filtra e corta em `limit`. Com um cluster raro e um
  `--limit` pequeno, você pode ver menos linhas do que existe.
- `--status` também é filtrado em memória, dentro de `listBoard()`, e o SQL
  ordena por `fit` — uma vaga já trackeada com fit baixo pode não entrar na
  janela. Para ver o funil, use `jho pipeline`, não `jobs list --status`.

`--json` devolve as `BoardRow` cruas, que é o formato certo para um agente
consumir.

### 3. Triar

Para qualquer coisa que mereça atenção, leia o motivo antes de decidir:

```bash
pnpm jho jobs show 42
```

Isso imprime o breakdown (`title / keywords / seniority / geo / comp / penalty`),
as `reasons`, os `blockers`, matched/missing keywords, o estado no pipeline e os
primeiros 1200 caracteres da descrição. É a única tela que responde *por que*
esta vaga está aqui.

Então mova no funil:

```bash
pnpm jho track 42 shortlisted -n "AI architect, board Ashby, remoto worldwide"
pnpm jho track 42 preparing   -n "CV variant: architect"
```

Estados válidos, na ordem em que `jho pipeline` os imprime:

| Status | Significado operacional |
|---|---|
| `backlog` | Entrou no radar, ainda não avaliado (é o default da coluna) |
| `shortlisted` | Passou na sua leitura, vale candidatar |
| `preparing` | CV/cover em preparação |
| `applied` | Enviado — carimba `applied_at` na **primeira** vez que chega aqui |
| `screening` | Triagem com recruiter |
| `interviewing` | Entrevista técnica em diante |
| `offer` | Proposta na mesa |
| `rejected` | Recusa deles |
| `withdrawn` | Você saiu |
| `archived` | Encerrado sem resultado, mantido para histórico |

Status inválido é rejeitado **antes** de tocar o banco, com `process.exitCode = 1`.

### 4. Agir

O que sai do sistema: candidatar-se pelo `applyUrl ?? url` que o `jho jobs show`
imprime, e as ações de posicionamento no LinkedIn.

> **Invariante:** Nunca faça scraping do LinkedIn. Publicação usa a API oficial
> (`w_member_social`, self-serve). Comentário, conexão e busca são **assistidos**
> — o agente redige, o humano abre a URL e executa. Está escrito no próprio
> schema, na tabela `engagement`: *"Rows here are NEVER executed automatically…
> This is the deliberate boundary that keeps the account inside the LinkedIn
> User Agreement."* Razões completas em
> [`docs/adr/0001-nao-fazer-scraping-do-linkedin.md`](adr/0001-nao-fazer-scraping-do-linkedin.md).

---

## O ciclo semanal

### Repontuar depois de mexer no perfil

Editou `profile/profile.yaml` (títulos, clusters, keywords, blockers, faixa de
compensação) ou o scorer?

```bash
pnpm jho profile                       # valida o YAML e imprime os alvos resolvidos
# bump SCORER_VERSION em src/core/scoring/score.ts
pnpm jho jobs score --all
```

> **Invariante:** mexeu em `profile.yaml` ou no scorer, **bump
> `SCORER_VERSION`** (`src/core/scoring/score.ts`, hoje `"1.0.0"`) e rode
> `pnpm jho jobs score --all`. Sem `--all`, `scoreAll()` só processa vagas
> abertas onde `job_score.job_id IS NULL` **ou**
> `job_score.scorer_version <> SCORER_VERSION` — ou seja, sem o bump os scores
> velhos passam por válidos e se misturam com os novos sem ninguém perceber.

Não existe repontuação de uma vaga só: `scoreAll()` aceita apenas `{ all }`.
`loadProfile(true)` força releitura do YAML a cada run, então não há cache
antigo em jogo.

### Limpar o que morreu

```bash
pnpm jho db prune --days 90
```

Deleta `job` com `closed_at` anterior ao corte **e** que não está referenciada em
`application`. Hoje isso retorna 0: nenhuma vaga foi fechada ainda no banco
local.

> **Invariante:** Vaga que some é fechada, não deletada — `closedAt` recebe
> timestamp e a linha fica. `pruneClosed()` é a única exclusão permitida, e ela
> se protege sozinha com `job.id not in (select job_id from application)`.

### Exportar o snapshot pro vault

```bash
pnpm jho report                      # <JHO_VAULT_PATH>/<JHO_REPORT_DIR>/vagas-match-YYYY-MM-DD.md
pnpm jho report --min-fit 60 --limit 40
pnpm jho report --stdout             # não escreve nada, só imprime
```

`JHO_REPORT_DIR` tem default `05_Interviews/LinkedIn`. Sem `JHO_VAULT_PATH` e
sem `--out`, o markdown é impresso em vez de gravado. O arquivo é nomeado pelo
dia, então rodar duas vezes no mesmo dia **sobrescreve** — é intencional: o
banco é a fonte da verdade e o vault é a superfície de leitura.

O relatório separa `Novas oportunidades` (sem status ou `backlog`) de
`Em andamento` (qualquer outro status).

### Revisar o funil

```bash
pnpm jho pipeline
pnpm jho sources list
pnpm check                 # tsgo --noEmit + vitest
```

`jho pipeline` imprime só os status com contagem > 0, mais a lista ordenada por
`application.updated_at DESC`. `jho sources list` cruza o YAML com a tabela
`source` e mostra `ok | error | never` por fonte, com `↳ <lastError>` embaixo.

---

## O que é "bom", em números

### Baseline do sistema (verificado em `data/jobs.db`, 2026-08-18)

| Métrica | Valor |
|---|---:|
| `job` ingeridas | 4824 |
| `job` com `closed_at` preenchido | 0 |
| `job_score` gravados | 4824 |
| Fontes configuradas | 12 (11 `ok`, 1 `error`) |
| Fit máximo / médio | 74,2 / 29,5 |
| Vagas com fit ≥ 70 | 1 |
| Vagas com fit ≥ 60 | 15 |
| Vagas com fit ≥ 45 | 325 |
| Vagas com ao menos um blocker | 21 |

Distribuição de cluster no acervo: `other` 2370, `ai_lead` 1080, `eng_lead`
1005, `architect` 225, `staff` 139, `senior_ic` 5. Acima do corte de 45 a
proporção muda: `ai_lead` 196, `architect` 56, `staff` 42, `eng_lead` 31.

Leituras práticas disso:

- **Fit médio ~30 é esperado**, não é sintoma. Os agregadores são ruidosos por
  design — o scorer filtra, não o fetcher.
- **`other` sendo metade do acervo é o comportamento correto** do
  `scoreTitle()`: o default é `{ score: 0, cluster: "other" }`.
- **Fit acima de 70 é raro** porque os defaults do scorer são conservadores: sem
  anos declarados a seniority vale 7,2/12; sem região declarada a geo vale
  8,25/15; sem compensação divulgada a comp vale 4/8. Vaga perfeita e calada não
  chega perto de 100 — não persiga 100.
- **Um dia normal de sync** move dezenas de linhas, não milhares.
  `lever:jobgether` sozinho traz ~4.700 das 4.824; qualquer variação grande vem
  de lá.

### Métricas de posicionamento (auditoria, §2.1 e §14)

A auditoria registra o baseline a bater e é explícita: *"Não há garantia de
números de entrevista; use métricas de tendência."* Não invente meta de
conversão — compare com o baseline.

| Métrica | Baseline registrado | Direção |
|---|---:|---|
| SSI total | 59/100 | subir o pilar fraco (`Interagir oferecendo insights`, 8,10/25) |
| Exibições (7 dias, 14–20/jul) | 1.362 | tendência, não pico |
| Ocorrências em resultados de pesquisa (7 dias) | 72 | subir |
| % de exibições originadas em pesquisa | 5,3% | subir — é o indicador de descoberta por keyword |
| Visualizações por recrutadores (12 meses) | 97 | subir e, sobretudo, melhorar a qualidade |
| Post original de referência | 10 reações / 538 impressões | cadência importa mais que o pico |

Cadência que a auditoria define (§14):

- **5–8 candidaturas por semana**, segmentadas, adaptando topo do CV e Featured
  ao cluster — não volume cego.
- **1 publicação original por semana** e **2 comentários substantivos por dia
  útil**.
- **30 min/semana medindo o funil**: exibições → buscas → visitas → contatos →
  entrevistas.
- **Taxa de resposta por cluster** (`architect`, `staff`, `ai_lead`) — é o número
  que decide onde investir CV e conteúdo, e o único que este banco consegue
  calcular sozinho.

Funil local, direto do banco (o `jho pipeline` dá os totais; o SQL dá o corte
por cluster):

```bash
sqlite3 data/jobs.db "
  select s.cluster,
         count(*)                                                as candidaturas,
         sum(a.status in ('screening','interviewing','offer'))   as responderam,
         sum(a.status in ('interviewing','offer'))               as entrevistas
  from application a
  join job j            on j.id = a.job_id
  left join job_score s on s.job_id = j.id
  where a.applied_at is not null
  group by s.cluster;"
```

Nada disso é confiável sem o passo seguinte.

### Registrar métricas do LinkedIn

Não existe comando para isso — a tabela `metric_snapshot` (`at`, `key`, `value`,
`note`, único em `(at, key)`) existe e nenhum código escreve nela. Registre à
mão, semanalmente:

```bash
sqlite3 data/jobs.db "
  insert into metric_snapshot (at, key, value, note)
  values ('2026-08-18','search_appearances_7d', 72, 'baseline da auditoria');"
```

---

## Registrar que você aplicou — e por que isso importa

```bash
pnpm jho track 38 applied -n "aplicado via ATS, CV variant architect"
```

O que `setApplicationStatus()` faz: cria a linha em `application` se não existir,
atualiza `status` e `updated_at`, carimba `applied_at` **apenas na primeira vez**
que o status vira `applied`, e sempre insere um `application_event` com
`kind = "status_change"`, `from_status`, `to_status` e o `-n` em `detail`.

**Por que isso importa mais do que parece:**

1. `application` é a única tabela que o sync nunca sobrescreve. Tudo em `job` é
   fato observado e descartável; tudo em `application` é decisão sua e
   insubstituível.
2. `pruneClosed()` usa a existência da `application` como escudo. Vaga sem
   candidatura registrada pode ser deletada 90 dias depois de fechar; com
   candidatura, nunca.
3. `application_event` é append-only e é o que torna a taxa de resposta por
   cluster calculável em retrospecto. Se você não trackeia, o dado não existe —
   e não dá para reconstruir depois.

> **Invariante:** `job` é fato observado, `application` é decisão do usuário, e
> a fronteira não se cruza. Ver
> [`docs/adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md`](adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md).

### Campos que o CLI não escreve

`jho track` só grava `status`, `applied_at` e `updated_at`. As colunas
`channel`, `cv_variant`, `cover_letter_path`, `contact_name`, `contact_url`,
`rate_discussed`, `next_action`, `next_action_at` e `notes` existem no schema e
são **lidas** por `jho jobs show` e `jho pipeline` (`next:` e as notas), mas
nenhum código as preenche. Até existir UI, é SQL:

```bash
sqlite3 data/jobs.db "
  update application
     set channel        = 'ats',
         cv_variant     = 'architect',
         next_action    = 'follow-up com o recruiter',
         next_action_at = '2026-08-25',
         notes          = 'rate discutido: 75/h USD',
         updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where job_id = 38;"
```

Cuidado com o `-n`: a nota do `jho track` vai para `application_event.detail`,
**não** para `application.notes`. `jho jobs show` imprime `application.notes` —
que continua vazio até você escrevê-lo. Para ler o histórico:

```bash
sqlite3 data/jobs.db "
  select e.at, e.from_status, e.to_status, e.detail
  from application_event e
  join application a on a.id = e.application_id
  where a.job_id = 38 order by e.at;"
```

---

## Troubleshooting

### Uma fonte aparece com status `error`

```bash
pnpm jho sources list
```

A linha vermelha `↳ <lastError>` é o `error.message` que derrubou aquele
`syncOne()`. Diagnósticos por formato da mensagem:

| Mensagem | Causa | Ação |
|---|---|---|
| `GET <url> -> 404` | Handle errado ou board removido | Ver "um board devolve 404" abaixo |
| `GET <url> -> 429` / `5xx` | Transiente; `getJson()` já tentou 2 retries com backoff `500 * 2**attempt` | Rodar o sync de novo mais tarde; considerar `--concurrency 2` |
| Abort por timeout | Estourou os 20 s de `DEFAULT_TIMEOUT_MS` | Repetir; se persistir, a fonte está degradada |
| `No adapter registered for source kind "<kind>"` | `workable` e `manual` passam na validação Zod de `sources.yaml` mas não estão em `ADAPTERS` | Remover a entrada do YAML ou escrever o adapter |
| `... is not a function` | Formato de campo mudou na API | Reproduzir com `sources probe`, corrigir o mapeamento |

O estado de erro é **pegajoso**: `last_error` só é limpo quando aquela fonte
completa um sync com sucesso. É por isso que `arbeitnow:` ainda aparece hoje com
`(j.job_types ?? []).join is not a function` — a causa já foi corrigida no
código (o adapter usa `toList()`), mas o registro fica até o próximo sync bem
sucedido.

Antes de qualquer correção, reproduza sem tocar no banco:

```bash
pnpm jho sources probe arbeitnow ""
```

`sources probe` não passa por `withDb()` — não abre nem escreve no banco.
Imprime a contagem, os `warnings` e os 5 primeiros títulos.

Warnings que **não** são erro:

- `ashby:<handle> returned no listed jobs` — o board existe e está vazio.
- `smartrecruiters:<handle> list endpoint has no job body; keyword scoring uses titles only`
  — o endpoint de lista não traz corpo; o keyword score pontua só o título.
- `adzuna skipped: ADZUNA_APP_ID/ADZUNA_APP_KEY not set` — o adapter devolve 0
  vagas de propósito em vez de falhar.

### Uma fonte devolveu 0 vagas

Nada é fechado. O bloco de fechamento em `syncOne()` só roda quando
`seenFingerprints.length > 0` — é uma proteção deliberada contra uma API que
responde `200 []` num dia ruim e apagaria o acervo inteiro daquela fonte.

### Um score parece errado

```bash
pnpm jho jobs show <id>
```

Compare o breakdown com os máximos e leia as `reasons` — elas são a saída
auditável do scorer, não decoração.

| Componente | Máx. | Sintoma típico e o que significa |
|---|---:|---|
| `title` | 35 | `0` + reason `Title contains avoided term "…"` → bateu em `targets.avoid_titles` e o cluster virou `other`. `0` + `Title does not match any target cluster` → nenhum título dos 5 clusters casou |
| `keywords` | 30 | Baixo com `Missing:` grande → a vaga é off-axis. Baixo com `Matched:` vazio → provavelmente `description_text` é `null` (SmartRecruiters) e só o título foi pontuado |
| `seniority` | 12 | `7.2` = `No explicit years requirement` (fator 0,6). `0` = pede menos que `reject_below_years: 3` |
| `geo` | 15 | `15` = LATAM/Brazil explícito. `13.5` = worldwide. `8.25` = remoto sem região declarada. `0` = sem sinal de remoto, ou restrito a uma região fora do Brasil |
| `comp` | 8 | `4` = `No compensation disclosed`. `0` = abaixo do `floor` de 90000/ano — **atenção: a moeda não é convertida**; `comp_currency` entra no `ScoreInput` e não é usada no cálculo |
| `penalty` | — | `12 × nº de blockers` + `5` fixos se houver **qualquer** keyword negativa (não é 5 por termo) |

Se o breakdown está certo e a *sua* expectativa é que estava errada, o conserto
é no `profile.yaml`, não no código: adicione o título ao cluster, ajuste o
`weight` do termo, ou escreva um blocker novo. Depois **bump `SCORER_VERSION` e
`jho jobs score --all`** — não existe caminho válido que pule esse par.

Um blocker com regex malformada não derruba a run: vira a string
`(invalid blocker pattern: <pattern>)` dentro da lista de blockers da vaga. Se
você vir isso em `jho jobs show`, o `pattern` no YAML está quebrado.

### O banco precisa ser reconstruído

Primeiro: quase nunca precisa. `runMigrations()` é idempotente e roda a cada
`jobs sync`; mudança de schema se resolve com `pnpm db:generate` (gera o SQL em
`drizzle/`) seguido de `pnpm jho db migrate`. Reconstruir do zero só faz sentido
com arquivo corrompido.

Antes de qualquer coisa destrutiva, **copie o arquivo**:

```bash
cp data/jobs.db "data/jobs.db.bak-$(date +%F)"
```

Reconstruir o acervo:

```bash
mv data/jobs.db data/jobs.db.old
pnpm jho db migrate
pnpm jho jobs sync
```

Agora o problema: `job.id` é `AUTOINCREMENT`, então os ids do banco novo **não**
correspondem aos antigos. O que amarra as duas versões é o `fingerprint`, que é
determinístico (`sha256(companySlug|normalizedTitle|normalizedLocation)`, 32
chars hex). Receita para trazer as candidaturas de volta:

```bash
sqlite3 data/jobs.db "
  attach 'data/jobs.db.old' as old;
  insert into application (job_id, status, channel, applied_at, cv_variant,
                           contact_name, contact_url, rate_discussed,
                           next_action, next_action_at, notes, created_at, updated_at)
  select j.id, a.status, a.channel, a.applied_at, a.cv_variant,
         a.contact_name, a.contact_url, a.rate_discussed,
         a.next_action, a.next_action_at, a.notes, a.created_at, a.updated_at
  from old.application a
  join old.job oj on oj.id = a.job_id
  join job j      on j.fingerprint = oj.fingerprint;"
```

Duas ressalvas honestas: candidatura cuja vaga não voltou em nenhuma fonte não
tem `job` para apontar e fica de fora; e `application_event` não é migrado
acima, porque `application.id` também muda e cada evento precisaria ser
remapeado. Por isso o `.bak` do arquivo inteiro é o backup que vale.

> **Invariante:** A receita do `fingerprint` exclui deliberadamente a fonte e a
> URL — é isso que colapsa a mesma vaga vista pelo board Ashby da empresa e por
> um agregador. Mudar a receita invalida a deduplicação de todo o banco
> existente e quebra qualquer restauração como a de cima.

### Um board devolve 404

Um 404 não é retentado (`RETRYABLE` = `{408, 425, 429, 500, 502, 503, 504}`) —
o comentário no `http.ts` diz o porquê: *"A 404 means the board handle is wrong;
retrying just wastes time."*

1. Confirme o significado do `handle` para aquele `kind`:

| Kind | O que é o `handle` |
|---|---|
| `greenhouse` | board token em `boards-api.greenhouse.io/v1/boards/<token>` |
| `lever` | company slug em `api.lever.co/v0/postings/<slug>` |
| `ashby` | board name em `jobs.ashbyhq.com/<board>` |
| `smartrecruiters` | company identifier |
| `recruitee` | subdomínio em `<handle>.recruitee.com` |
| `himalayas` | query free-text opcional (`""` = tudo que é recente) |
| `remotive` | termo de busca opcional |
| `arbeitnow` | ignorado (board inteiro) |
| `remoteok` | ignorado (board inteiro) |
| `adzuna` | `"<country>:<query>"`, exige `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` |

2. Teste o candidato sem gravar nada:

```bash
pnpm jho sources probe greenhouse stackblitz
pnpm jho sources probe ashby textlayer
```

3. Se o board realmente sumiu (empresa trocou de ATS, board despublicado),
   marque `enabled: false` na entrada do `config/sources.yaml` em vez de apagar
   a linha — o `rationale` continua explicando por que aquela empresa entrou na
   lista.

**Efeito colateral que ninguém espera:** desabilitar uma fonte não fecha as
vagas dela. O fechamento só acontece dentro do `syncOne()` daquela fonte, e
`loadSources()` filtra `enabled: true` antes do sync sequer começar. As vagas
ficam abertas e continuam aparecendo em `jho jobs list`. Se a intenção era
aposentar a fonte, feche-as explicitamente:

```bash
sqlite3 data/jobs.db "
  update job set closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where source_id = 'arbeitnow:' and closed_at is null;"
```

Depois `pnpm jho db prune --days 90` recolhe o que não tem candidatura.

> **Invariante:** Nunca escreva um mapeamento de campos a partir de
> documentação. Todo adapter atual foi verificado contra uma resposta real via
> `jho sources probe` antes do commit — mantenha assim ao consertar um.

### O CLI estoura `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`

Alguém escreveu sintaxe TypeScript não-apagável. O runtime é o type stripping
nativo do Node 24: sem `enum`, sem parameter properties
(`constructor(private x: T)`), sem `namespace`, sem decorators.
`erasableSyntaxOnly: true` está ligado no `tsconfig.json` para pegar isso em
`pnpm typecheck`, antes de virar erro de runtime. Contexto em
[`docs/adr/0006-typescript-apagavel-sem-build-step.md`](adr/0006-typescript-apagavel-sem-build-step.md).

---

## Referência rápida

```bash
pnpm jho jobs sync                       # diário: buscar + pontuar
pnpm jho jobs list --min-fit 60          # diário: revisar o topo
pnpm jho jobs show <id>                  # diário: entender o score
pnpm jho track <id> <status> -n "nota"   # diário: mover no funil

pnpm jho profile                         # semanal: validar profile.yaml
pnpm jho jobs score --all                # semanal: após bump de SCORER_VERSION
pnpm jho db prune --days 90              # semanal: limpar fechadas sem candidatura
pnpm jho report                          # semanal: snapshot no vault
pnpm jho pipeline                        # semanal: estado do funil
pnpm jho sources list                    # semanal: saúde das fontes
pnpm check                               # semanal: tsgo --noEmit + vitest
```
