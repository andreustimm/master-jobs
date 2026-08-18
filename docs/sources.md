# Fontes de vagas

## Por que isto existe

Todo o funil começa aqui. Se um adapter mapeia um campo errado, o erro não
aparece como exceção — aparece como uma vaga ótima com `fit` 31 três semanas
depois, e ninguém descobre por quê. Este documento existe para que você (ou um
agente) consiga responder três perguntas sem abrir dez arquivos:

1. **De onde vem cada vaga**, com a URL exata do endpoint e o que `handle`
   significa naquele `kind`.
2. **O que aquele endpoint não entrega** — porque um endpoint que não devolve o
   corpo da vaga degrada o `keywordScore` para "só o título", em silêncio.
3. **Como acrescentar uma fonte** sem quebrar o pipeline nem levar um ban.

Regra que governa tudo o que está abaixo: **toda fonte é um endpoint público e
não autenticado**. Nada neste repositório dirige sessão logada, cookie `li_at`
ou "LinkedIn MCP" não oficial — veja `docs/linkedin-policy.md`.

---

## O contrato

Um adapter implementa `SourceAdapter` (`src/core/sources/types.ts`):

```ts
export type SourceAdapter = {
  kind: SourceKind;
  /** Human-facing docs URL, so the config file explains itself. */
  docs: string;
  fetchJobs(config: SourceConfig): Promise<FetchResult>;
};

export type FetchResult = {
  jobs: RawJob[];
  /** Non-fatal problems worth surfacing without failing the whole sync. */
  warnings: string[];
};
```

`fetchJobs` recebe `SourceConfig` (`kind`, `handle`, `label`, `rationale?`) e
devolve `RawJob[]`. Só `externalId`, `companyName`, `title`, `url` e `raw` são
obrigatórios em `RawJob`; todo o resto é opcional e anulável.

> **Invariante:** Adapters são burros — fetch, mapear, retornar. Normalização,
> `fingerprint`, deduplicação e scoring acontecem downstream
> (`src/core/ingest/`, `src/core/scoring/`). Um adapter que normaliza título ou
> decide o que "conta" como vaga move regra de negócio para dentro do fetcher e
> passa a divergir das outras nove fontes.

> **Invariante:** Uma fonte que falha é registrada e pulada; nunca aborta a run.
> O `try/catch` de `syncOne()` grava `source.lastStatus = "error"` e
> `source.lastError`, e o worker segue para a próxima da fila. Um board com
> handle errado não pode custar as outras 11 fontes.

Problema não-fatal vai em `warnings`, não em `throw`. O CLI imprime cada warning
em amarelo abaixo da linha da fonte, tanto em `jobs sync` quanto em
`sources probe`.

---

## Catálogo

### Visão geral

| kind | Arquivo | Corpo da vaga no endpoint de lista? | Paginação | Credencial |
|---|---|---|---|---|
| `greenhouse` | `ats.ts` | Sim, com `content=true` | Não | — |
| `lever` | `ats.ts` | Sim (`description` HTML) — ver armadilha | Não | — |
| `ashby` | `ats.ts` | Sim (`descriptionHtml` / `descriptionPlain`) | Não | — |
| `smartrecruiters` | `ats.ts` | **Não** | `offset`, 100/página, teto 500 | — |
| `recruitee` | `ats.ts` | Sim (`description` + `requirements`) | Não | — |
| `himalayas` | `aggregators.ts` | Sim (`description`) | Não, `limit=50` | — |
| `remotive` | `aggregators.ts` | Sim (`description`) | Não, `limit=50` | — |
| `arbeitnow` | `aggregators.ts` | Sim (`description`) | Não | — |
| `remoteok` | `aggregators.ts` | Sim (`description`) | Não | — |
| `adzuna` | `aggregators.ts` | Parcial (`description`, sem HTML) | Não, `results_per_page=50` | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` |

### ATS — `src/core/sources/ats.ts`

#### `greenhouse`

```
https://boards-api.greenhouse.io/v1/boards/{handle}/jobs?content=true
```

- **`handle`** = board token da empresa (o `<token>` em
  `boards-api.greenhouse.io/v1/boards/<token>`). Ex.: `stackblitz`.
- **`content=true` é obrigatório.** Sem ele a resposta não traz `content` e não
  existe corpo para pontuar — o comentário no código diz exatamente isso.
- **Armadilha:** o campo `content` vem **HTML-escapado**. O adapter desfaz
  `&lt;`, `&gt;` e `&quot;` *antes* de chamar `htmlToText()`. Sem esse passo, o
  texto extraído seria a marcação literal.
- `companyName = j.company_name ?? config.label`.
- `postedAt = j.first_published ?? j.updated_at ?? null`.
- `url` e `applyUrl` são ambos `j.absolute_url`.

#### `lever`

```
https://api.lever.co/v0/postings/{handle}?mode=json
```

- **`handle`** = company slug em `api.lever.co/v0/postings/<slug>`. Ex.:
  `jobgether`.
- A resposta é um **array na raiz**, não um objeto com `jobs`.
- `companyName = config.label` — a API não devolve o nome da empresa. O `label`
  do `sources.yaml` é o único nome disponível.
- `locationRaw = categories.allLocations.join(" / ")`, caindo para
  `categories.location` quando a lista vem vazia.
- `remote` deriva de `workplaceType.toLowerCase() === "remote"`; `null` quando o
  campo não vem.
- **Armadilha:** `createdAt` vem em **epoch milissegundos**, ao contrário dos
  agregadores que usam segundos. O adapter faz `new Date(j.createdAt)` direto.

> **Armadilha verificada em produção (ainda não corrigida):** Jobgether devolve
> `descriptionPlain: ""` — string vazia, não `null` — em quase todas as vagas,
> enquanto `description` traz cerca de 1 KB de HTML. Como o mapeamento é
> `j.descriptionPlain ?? htmlToText(j.description)` e `""` não é nullish, o `??`
> **preserva a string vazia** e o fallback nunca roda. Medido em `data/jobs.db`:
> **4.538 das 4.639 linhas de `lever:jobgether` têm `description_text = ''`**
> com `description_html` preenchido — ou seja, ~98% da maior fonte do banco é
> pontuada só pelo título, e sem emitir nenhum warning.

#### `ashby`

```
https://api.ashbyhq.com/posting-api/job-board/{handle}?includeCompensation=true
```

- **`handle`** = board name em `jobs.ashbyhq.com/<board>`. Ex.: `textlayer`,
  `paires`, `reflow`, `g2i`, `redcan`.
- **`includeCompensation=true` é o que traz `compensation.summaryComponents`.**
  Sem ele, `compMin` / `compMax` / `compCurrency` / `compPeriod` ficam todos
  `null` e o componente `comp` do scorer cai para o default de "não divulgou".
- Filtra `j.isListed !== false` — rascunhos e vagas despublicadas ficam fora.
- **Armadilha de compensação:** o adapter pega o primeiro `summaryComponent` com
  `compensationType === "Salary"` **ou** `minValue != null`. Linhas de equity
  aparecem no mesmo array e não têm min/max que valham pontuar.
- `companyName = config.label` (a API devolve a vaga, não a empresa).
- `locationRaw` junta `location` + `secondaryLocations[].location` com `" / "`.
- Emite `ashby:<handle> returned no listed jobs` quando a lista sai vazia — é o
  sintoma típico de board name errado ou empresa sem vaga aberta.

#### `smartrecruiters`

```
https://api.smartrecruiters.com/v1/companies/{handle}/postings?limit=100&offset={offset}
```

- **`handle`** = company identifier na SmartRecruiters.
- **Paginação:** `for (let offset = 0; offset < 500; offset += 100)`, parando
  antes quando `content.length < limit`. Teto duro de **5 páginas / 500 vagas**.
- **O endpoint de lista NÃO traz o corpo da vaga.** `descriptionHtml` e
  `descriptionText` são gravados como `null` de propósito, e o adapter emite:

  ```
  smartrecruiters:<handle> list endpoint has no job body; keyword scoring uses titles only
  ```

  **Mas o warning é condicional:** o `push` está dentro de
  `if (jobs.length > 0) { ... }`. Um `handle` errado — ou uma empresa sem vaga
  aberta — devolve zero postings e o adapter fica **completamente calado**: não
  existe aqui o equivalente ao `ashby:<handle> returned no listed jobs`. A fonte
  reporta `ok` com 0 fetched e nenhum warning, exatamente o mesmo output de um
  board legitimamente vazio.

  Consequência concreta: `scoreKeywords()` roda sobre o título e mais nada. O
  componente `keyword` vale até 30 dos 100 pontos — uma fonte sem corpo compete
  de mão amarrada. Trate o score dela como piso, nunca como veredicto.
- `url` e `applyUrl` são **montados**, não vêm da API:
  `https://jobs.smartrecruiters.com/{handle}/{postingId}`.
- Não há nenhuma entrada `smartrecruiters` em `config/sources.yaml` hoje. O
  adapter está pronto e registrado, mas nunca rodou num sync real.

#### `recruitee`

```
https://{handle}.recruitee.com/api/offers/
```

- **`handle`** = subdomínio em `<handle>.recruitee.com`.
- `descriptionHtml` é a concatenação de `description` + `"\n"` + `requirements`
  — os requisitos vêm num campo separado e são justamente onde moram as
  keywords que o scorer procura.
- `url = careers_url ?? https://{handle}.recruitee.com/o/{slug}`.
- `companyName = config.label`.
- Também sem entrada em `config/sources.yaml` hoje.

### Agregadores — `src/core/sources/aggregators.ts`

Estes existem para alargar o funil além das empresas que você já conhece. São
mais barulhentos que os ATS por construção — **o scorer filtra, não o fetcher**.

Dois helpers locais valem conhecer antes de ler qualquer adapter daqui:

| Helper | Por que existe |
|---|---|
| `toList(value: unknown)` | Agregadores são inconsistentes: o mesmo campo às vezes é `string`, às vezes `string[]`. Devolve `[]` para qualquer outra coisa. |
| `toIso(value)` | Converte data. **Se o valor é `number`, é interpretado como segundos** (`value * 1000`). Se é string, `Date.parse`. |

> **Invariante:** `toIso()` trata número como **segundos**; o Lever, que usa
> milissegundos, por isso **não** usa esse helper e faz `new Date(j.createdAt)`
> direto no `ats.ts`. Ao escrever um adapter novo, confirme a unidade contra uma
> resposta real antes de escolher entre os dois caminhos — errar por 1000x põe a
> vaga em 1970 ou no ano 56000, e `postedAt` some do relatório sem barulho.

#### `himalayas`

```
https://himalayas.app/jobs/api?limit=50[&q={handle}]
```

- **`handle`** = query free-text **opcional**. `""` significa "tudo que é
  recente" — é exatamente como está configurado hoje.
- `remote` é forçado para `true`: é um board só-remoto.
- `locationRaw = toList(locationRestrictions).join(", ") || "Remote"`.
- **Armadilha:** `pubDate` vem em **segundos** (tratado por `toIso`).
- `url = applicationLink ?? https://himalayas.app/companies/{companySlug}` — o
  fallback aponta para a empresa, não para a vaga.

#### `remotive`

```
https://remotive.com/api/remote-jobs?limit=50[&search={handle}]
```

- **`handle`** = termo de busca **opcional**, enviado como `search`.
- Configurado **duas vezes** em `sources.yaml`: `architect` e `ai engineer`. São
  duas passadas no mesmo board com queries diferentes; a deduplicação por
  `fingerprint` colapsa o que se repetir (ver a tabela de estado do banco).
- `remote` forçado para `true`.
- `locationRaw = candidate_required_location ?? "Remote"`.

#### `arbeitnow`

```
https://www.arbeitnow.com/api/job-board-api
```

- **`handle` é ignorado.** O parâmetro se chama `_config` na assinatura
  justamente para deixar isso explícito — sempre puxa o board inteiro.
- `created_at` vem em **segundos** (`toIso`).
- `employmentType = toList(j.job_types).join(", ") || null`.
- **Estado atual no banco:** `last_status = 'ok'`, `last_error = NULL`,
  `last_job_count = 176` (sync de 2026-08-18T17:46:03Z), 173 linhas em `job`.
  Num sync anterior esta fonte esteve em `error` com
  `last_error = '(j.job_types ?? []).join is not a function'` — resíduo de uma
  versão do adapter que assumia `job_types` como array, antes do `toList()`. O
  estado de erro sobreviveu até o sync seguinte porque `source.lastError` só é
  reescrito quando aquela fonte roda de novo; o branch de sucesso de `syncOne()`
  (`set({ lastStatus: "ok", lastError: null, ... })` em `src/core/ingest/run.ts`)
  limpou os dois campos de uma vez.

#### `remoteok`

```
https://remoteok.com/api
```

- **`handle` é ignorado** (`_config`) — board inteiro.
- **Armadilha:** o **primeiro elemento do array é um aviso legal, não uma
  vaga**. O filtro é `!j.legal && j.position && j.id`. Sem ele, a primeira
  "vaga" de todo sync seria um texto de licenciamento.
- `remote` forçado para `true`.
- `compCurrency` e `compPeriod` só são preenchidos (`"USD"` / `"year"`) quando
  `salary_min` existe — a API não declara moeda, o adapter assume USD e registra
  a assunção apenas quando há número.

#### `adzuna`

```
https://api.adzuna.com/v1/api/jobs/{country}/search/1
  ?app_id={ADZUNA_APP_ID}&app_key={ADZUNA_APP_KEY}
  &what={query}&results_per_page=50&content_type=application/json
```

- **`handle`** = `"<country>:<query>"`, ex. `"us:AI solutions architect"`. O
  split é em `":"`: o primeiro segmento vira `country` (default `"us"`), o resto
  é rejuntado com `":"` e vira `what` (default `"software architect"`).
- **Exige credenciais.** Sem `ADZUNA_APP_ID` **ou** sem `ADZUNA_APP_KEY` o
  adapter **não falha** — retorna:

  ```ts
  { jobs: [], warnings: ["adzuna skipped: ADZUNA_APP_ID/ADZUNA_APP_KEY not set"] }
  ```

  A fonte fica `ok` com zero vagas e um warning amarelo. É deliberado: uma
  credencial ausente é configuração, não falha de rede.
- `descriptionHtml` é sempre `null`; `descriptionText` vem de `j.description`.
- `compPeriod` é fixado em `"year"` e `compCurrency` é sempre `null`.
- Está **comentado** em `config/sources.yaml`; descomente depois de setar as
  chaves em `.env.local`.

### Declarados mas não implementados

`workable` e `manual` existem no type `SourceKind` (`types.ts`) e na lista
`KINDS` de `config.ts` — portanto **passam na validação Zod do
`sources.yaml`** — mas não estão em `ADAPTERS` (`registry.ts`).

Usar qualquer um dos dois faz `getAdapter()` lançar:

```
No adapter registered for source kind "workable"
```

Em `jobs sync` isso não derruba a run: vira `lastStatus = 'error'` apenas para
aquela fonte. Em `sources probe`, o erro sobe até o `catch` do `parseAsync` e o
processo sai com `exitCode = 1`.

---

## Como adicionar uma fonte nova

### 1. Escreva o adapter

Em `src/core/sources/ats.ts` (board de ATS) ou `aggregators.ts` (agregador), ou
num arquivo novo em `src/core/sources/` se a forma for diferente. Exporte um
`SourceAdapter`:

```ts
export const minhafonte: SourceAdapter = {
  kind: "minhafonte",
  docs: "https://exemplo.com/api-docs",
  async fetchJobs(config: SourceConfig): Promise<FetchResult> {
    const url = `https://exemplo.com/api/jobs?board=${encodeURIComponent(config.handle)}`;
    const data = await getJson<{ jobs?: MinhaFonteJob[] }>(url);
    const jobs = (data.jobs ?? []).map((j): RawJob => ({ /* ... */ }));
    return { jobs, warnings: [] };
  },
};
```

Checklist do adapter:

- Sempre `getJson()` do `./http.ts`, nunca `fetch` cru — é o que garante
  user-agent, timeout e política de retry.
- Sempre `encodeURIComponent(config.handle)` na URL. O `handle` vem de um YAML
  editado à mão.
- Sempre `htmlToText()` quando você tem HTML e a API não dá texto puro. Cuidado
  com `??` se a API puder devolver **string vazia** — veja a armadilha do Lever
  acima; use `||` quando `""` for um valor possível.
- Guarde o objeto original inteiro em `raw`. É o que permite reprocessar
  histórico sem refazer a chamada de rede.
- Corpo ausente, lista vazia ou credencial faltando vão em `warnings`, não em
  `throw`.

Se o `kind` é novo, acrescente-o ao union `SourceKind` em
`src/core/sources/types.ts` **e** ao array `KINDS` em
`src/core/sources/config.ts` — senão o Zod rejeita o YAML.

> **Invariante:** Só sintaxe TypeScript apagável. O runtime é o type stripping
> nativo do Node 24 (`erasableSyntaxOnly: true` no `tsconfig.json`). Nada de
> `enum` para listar `kind`s, nada de parameter properties. É por isso que
> `SourceKind` é um union de string literais e `KINDS` é
> `as const satisfies readonly SourceKind[]`.

### 2. Registre em `registry.ts`

```ts
// src/core/sources/registry.ts
import { minhafonte } from "./minhafonte.ts";

export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  // ...
  minhafonte,
};
```

Sem esta linha, `getAdapter()` lança em runtime mesmo com o YAML válido — foi
exatamente o que aconteceu com `workable` e `manual`.

### 3. Adicione em `config/sources.yaml` com um `rationale`

```yaml
  - kind: minhafonte
    handle: acme
    label: ACME Corp
    rationale: "Tier 1 — confirmado contratando contractor no Brasil (audit §7.2)"
```

`label` é obrigatório e tem `min(1)`. Vários adapters usam `config.label` como
`companyName` (Lever, Ashby, Recruitee), então um label preguiçoso vira o nome
da empresa em todas as vagas daquela fonte.

`enabled` tem default `true`; `loadSources()` **filtra `enabled: true`** e
descarta o campo do objeto retornado. Uma fonte com `enabled: false` some do
`sources list` e do `sync`, mas as vagas dela continuam no banco.

> **Invariante:** Toda fonte precisa de `rationale`. Em três meses, "por que
> este board está aqui?" é a pergunta que decide se ele fica ou sai. O campo é
> `optional()` no Zod, mas é obrigatório por convenção — o `CLAUDE.md` exige.

### 4. Valide contra a API real antes de commitar

```bash
pnpm jho sources probe minhafonte acme
```

`probe` chama `getAdapter(kind).fetchJobs({ kind, handle, label: handle })` e
imprime a contagem, os warnings e os cinco primeiros títulos com localização.
**Ele não abre o banco e não escreve nada** — não passa pelo `withDb()`, ao
contrário de todos os outros comandos que tocam dados.

> **Invariante:** Nunca escreva um mapeamento de campos a partir de
> documentação. Todos os 10 adapters atuais foram verificados contra respostas
> reais — o cabeçalho de `ats.ts` diz literalmente "Field shapes below were
> verified against live responses, not documentation". Documentação de ATS mente
> sobre nulidade, unidade de data e nome de campo com frequência desconfortável.

Depois que o probe passar, rode o ciclo completo:

```bash
pnpm jho jobs sync            # roda migrations, sincroniza tudo, pontua no fim
pnpm jho sources list         # confirma a nova fonte em 'ok' com contagem > 0
pnpm jho jobs list --min-fit 60
```

---

## O estado do banco

Estado observado em `data/jobs.db` após o sync de 2026-08-18T17:46Z.
**"Fetched" é `source.last_job_count`** — quantas vagas o adapter devolveu **no
último sync daquela fonte**, e só nele. **"Linhas em `job`" é cumulativo**: tudo
que já entrou desde o primeiro sync e sobreviveu à dedup global por
`fingerprint`. As duas colunas medem coisas diferentes e não precisam bater.

| Fonte (`source.id`) | Status | Fetched | Linhas em `job` |
|---|---|---:|---:|
| `lever:jobgether` | ok | 4691 | 4639 |
| `arbeitnow:` | ok | 176 | 173 |
| `remoteok:` | ok | 100 | 104 |
| `himalayas:` | ok | 20 | 40 |
| `ashby:reflow` | ok | 18 | 18 |
| `remotive:ai engineer` | ok | 17 | 17 |
| `remotive:architect` | ok | 17 | 0 |
| `greenhouse:stackblitz` | ok | 11 | 11 |
| `ashby:paires` | ok | 9 | 9 |
| `ashby:g2i` | ok | 8 | 8 |
| `ashby:redcan` | ok | 1 | 1 |
| `ashby:textlayer` | ok | 1 | 1 |
| **Total** | **12 ok / 0 error** | **5069** | **5021** |

Como ler esta tabela:

- **Fetched maior que linhas = dedup.** `lever:jobgether` traz 4691 e assenta em
  4639: 52 fingerprints repetidos, a mesma vaga listada em mais de uma região
  colapsando quando `normalizeLocation()` as iguala. `arbeitnow:` faz o mesmo em
  escala menor (176 → 173).
- **Linhas maior que fetched = boards que rotacionam.** `himalayas:` puxa
  `limit=50` mas só 20 vieram no último sync, e ainda assim tem 40 linhas
  acumuladas; `remoteok:` tem 104 linhas para 100 fetched. Vaga antiga que saiu
  da listagem é **fechada** (`closed_at`), não apagada — são 24 linhas com
  `closed_at` preenchido no banco hoje.
- **`remotive:architect` com 0 linhas não é falha.** A atribuição de
  `job.source_id` fica com quem inseriu primeiro; um update só reescreve o
  `source_id` quando o `contentHash` mudou. Duas fontes que veem a mesma vaga
  produzem uma linha só, e ela pertence a quem chegou antes. As 17 da query
  `architect` colidiram integralmente com as que `ai engineer` inseriu
  milissegundos antes.
- **`lever:jobgether` domina o banco** (4639 de 5021, 92%) — e é exatamente a
  fonte afetada pela armadilha da `descriptionPlain` vazia. São **239 valores
  distintos de `job.company_name`** e 238 linhas na tabela `company`.
- **Quando `arbeitnow` esteve em `error`, as outras 11 fontes não pagaram nada
  por isso** — invariante nº 2 em funcionamento. O sync seguinte reescreveu a
  fonte para `ok`, que é por que a tabela acima não tem mais nenhum erro.

Distribuição de `job_score.cluster` (**5021 linhas em `job_score`**, fit máximo
74,2 / médio 29,5):

| Cluster | Vagas |
|---|---:|
| `other` | 2491 |
| `ai_lead` | 1114 |
| `eng_lead` | 1032 |
| `architect` | 236 |
| `staff` | 143 |
| `senior_ic` | 5 |

> **Invariante:** `job_score` pode ficar atrás de `job`. Aconteceu neste
> repositório: um `jobs sync --no-score` ingeriu 173 vagas de `arbeitnow:`,
> 20 de `himalayas:` e 4 de `remoteok:` que ficaram sem score até rodar
> `jobs score` (hoje as duas tabelas estão em 5021). É deriva de snapshot, não
> defeito: `jobs sync` chama `scoreAll()` no fim, salvo com `--no-score`. Ao ler qualquer número deste
> documento, nunca assuma que "todas as vagas estão pontuadas" — confira
> `select count(*) from job_score` contra `select count(*) from job`, ou rode
> `pnpm jho jobs score` antes de tirar conclusão de distribuição.

---

## Etiqueta de rede

Estes são serviços gratuitos de outras pessoas. O `src/core/sources/http.ts`
começa com essa frase e implementa a consequência: *"Identify ourselves, keep
timeouts tight, retry only on transient failures, and never hammer on a 4xx."*

| Regra | Implementação |
|---|---|
| Identificar-se | Header `user-agent` em toda requisição: `process.env.JHO_USER_AGENT` com fallback `"job-hunt-os/0.1 (personal job search)"` |
| Timeout curto | `AbortController` com `DEFAULT_TIMEOUT_MS = 20_000` |
| Retry só em falha transitória | `RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])`; no máximo 2 retries (`opts.retries ?? 2`) |
| Não martelar em 4xx | Status fora de `RETRYABLE` faz `throw` imediato do `HttpError` — "a 404 means the board handle is wrong; retrying just wastes time" |
| Backoff | `500 * 2 ** attempt` ms, ou seja 500 ms e depois 1000 ms |
| Concorrência limitada | `syncAll()` usa uma fila com `concurrency` workers, default 4 (`--concurrency <n>`) |

> **Invariante:** Todo acesso a rede passa por `getJson()`. Um adapter que chama
> `fetch` diretamente escapa do user-agent, do timeout e da política de retry —
> e o custo de errar isso não é um teste vermelho, é um IP bloqueado num serviço
> gratuito que não tem canal de suporte para reverter.

Se você precisa de mais volume de uma fonte, prefira **mais queries
específicas** (como as duas entradas `remotive`) a subir `limit` /
`results_per_page` acima do que o adapter já usa. Query específica melhora o
sinal; página maior só aumenta a conta de quem hospeda.

---

## Referências cruzadas

| Documento | Quando |
|---|---|
| `docs/data-model.md` | O que acontece com o `RawJob` depois do adapter |
| `docs/scoring.md` | Por que "sem corpo da vaga" custa até 30 pontos |
| `docs/cli.md` | `sources list`, `sources probe` e `jobs sync` em detalhe |
| `docs/linkedin-policy.md` | **Antes de considerar qualquer fonte autenticada** |


## Braintrust — a fonte de maior sinal

Adicionada depois do benchmark competitivo, que varreu todo marketplace de
talento atrás de API aberta. Wellfound e Toptal devolvem 403; `hired.com`
redireciona para a LHH e `otta.com` para a Welcome to the Jungle — dois deixaram
de existir como produto independente. Sobrou o Braintrust.

```
https://app.usebraintrust.com/api/jobs/?limit=20     lista, paginada por `next`
https://app.usebraintrust.com/api/jobs/{id}/         detalhe, com a descrição
```

O que o torna especial: **`locations[].country` é código ISO**. Toda outra fonte
obriga o componente geográfico do scorer a ler prosa e adivinhar. Aqui "posso
pegar essa vaga do Brasil?" é um campo. Para um candidato cuja restrição mais
dura é autorização de trabalho, nenhum outro atributo chega perto.

Também casa com o modelo de contratação: `budget_minimum_usd` já vem em dólar
pelo nome do campo, `payment_type` é explícito, e a maioria é contrato por hora
ou preço fechado — o que só passou a ser pontuável depois da correção de moeda
e período.

Custo pago de propósito: **o endpoint de lista não traz descrição alguma**, então
o corpo de cada vaga é buscado individualmente. Pular isso reproduziria
exatamente a falha do Lever — toda vaga com zero em keywords, sem causa visível.

O adapter traduz a elegibilidade estruturada numa frase que o scorer consegue
ler, em vez de abrir exceção para a fonte dentro do scorer.

---

## Paginação do Himalayas

O board expõe **101.022 vagas** e servia 20 porque o adapter nunca paginava.

Duas coisas precisaram ser entendidas antes de corrigir:

- O tamanho de página é fixo no servidor: `limit=100`, `200` e `500` devolvem
  exatamente 20. O board inteiro seriam ~5.000 requisições num serviço gratuito.
- O parâmetro `q` é **aceito e ignorado**. Toda busca devolve os mesmos 101.018
  resultados, então o `q=<handle>` do adapter anterior não filtrava nada
  enquanto parecia filtrar.

O que torna uma fatia limitada a resposta certa, e não um meio-termo: o board é
ordenado por data de publicação decrescente — offset 0 é hoje, offset 2000 é
anteontem. Frescor é a maior alavanca de taxa de resposta em recrutamento, então
as primeiras páginas são também as mais valiosas.

`handle` é a contagem de páginas. Em 60 páginas pegamos as ~1.200 mais recentes,
com 120 ms entre requisições, e **avisamos explicitamente** o que ficou de fora
em vez de sugerir cobertura total.

---

## Qualidade de fonte: o que a verificação revelou

`jho jobs verify` checa se as vagas do topo ainda existem. Resultado na base real:

| Fonte | Links mortos |
|---|---|
| `lever:jobgether` | **47 de 191 — 25%** |
| Ashby, Greenhouse, Braintrust, Himalayas, Arbeitnow, RemoteOK, Remotive | **0** |

Isso bate com a taxa de 18–27% de *ghost jobs* que o benchmark encontrou no
mercado, e diz sem ambiguidade qual fonte está degradando o board.

> **Invariante de qualidade de fonte:** fonte que **nomeia o empregador** vale
> mais por vaga que agregador anônimo com muito mais volume. O Jobgether
> anonimiza por design — a descrição diz literalmente *"on behalf of a partner
> company"* — o que quebra três coisas de uma vez: não dá para pesquisar a
> empresa, não dá para cruzar com a rede (referral), e a mesma vaga no board
> próprio da empresa **não deduplica**, já que o `fingerprint` inclui a empresa.

O dashboard tem um filtro **"empresa identificada"** por causa disso: com fit
≥ 60 o board vai de 214 vagas para 40.

