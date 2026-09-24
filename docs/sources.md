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
  fetchJobs(config: SourceConfig): Promise<SourceSnapshot>;
};

export type FetchResult = {
  jobs: RawJob[];
  /** Non-fatal problems worth surfacing without failing the whole sync. */
  warnings: string[];
};

/** `complete` só quando a resposta prova o fim da lista; na dúvida, `partial`. */
export type Completeness = "complete" | "partial";
export type SourceSnapshot = FetchResult & { completeness: Completeness };
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
| `jobicy` | `jobicy.ts` | Sim (`jobDescription`) | Não, `count=100` | — |
| `workable` | `workable.ts` | Sim (`description` + seções) | `pageToken`, 20/página, até 5 páginas | — |
| `hackernews` | `hackernews.ts` | Sim (o próprio comentário) | Não, o fio inteiro numa chamada | — |

### Completude da listagem

Todo `fetchJobs()` devolve `completeness`: `complete` quando a listagem é tudo o
que a fonte tem aberto, `partial` quando é uma janela. Só a listagem completa
prova que a vaga ausente saiu — a sincronização fecha por ausência apenas nela
(`decideAbsenceClosure()` em `src/core/ingest/lifecycle.ts`). Vaga de janela
parcial só fecha por 404/410 na reconferência (`probe.ts`). Adapter que não
consegue provar o fim da lista declara `partial`.

| kind | Completude | O que prova o fim |
|---|---|---|
| `greenhouse`, `lever`, `ashby`, `recruitee` | `complete` | o board inteiro numa resposta |
| `smartrecruiters` | `complete` só com página curta | teto de 500 com a última página cheia é `partial` |
| `workable` | `complete` só sem `nextPageToken` | as 5 páginas do orçamento com token pendente é `partial` |
| `braintrust` | `complete` só sem `next`, sem corte do handle e com `count` alcançado | — |
| `himalayas` | `complete` só com `totalCount` alcançado | na prática sempre `partial` (~100.000 vagas) |
| `careers` | `complete` quando nenhum link foi cortado por `maxJobs` | a página de vagas da própria empresa |
| `hackernews` | `complete` quando `hits` alcança `nbHits` | a fonte é a thread do mês; a da nova thread fecha as do mês anterior |
| `remotive`, `arbeitnow`, `remoteok`, `adzuna`, `jobicy` | `partial` | recorte de recência ou primeira página |

Consequência a conhecer: a vaga de fonte parcial que nunca mais aparece fica
aberta até a reconferência responder 404/410. A varredura periódica
(`enqueueStale`) só enfileira vagas com nota ≥ 55, então vaga de fonte parcial
abaixo do corte permanece aberta — ausência não é prova, e dado faltante é
neutro. `pnpm jho sources probe <kind> <handle>` e `jho jobs sync` mostram a
completude de cada rodada.

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
- **Validado contra a API real** em 2026-09-18 com `BoschGroup`: 4.819 vagas na
  fonte, 500 trazidas pelo teto de paginação, título e localização mapeados, e o
  warning de corpo ausente emitido como descrito acima.

  ```bash
  pnpm jho sources probe smartrecruiters BoschGroup
  ```

- **Handle errado é indistinguível de empresa sem vaga.** A API devolve
  `{"offset":0,"limit":1,"totalFound":0,"content":[]}` — HTTP 200 — tanto para
  `BoschGroup` grafado errado quanto para uma empresa que fechou todas as vagas.
  `Visa` e `Bosch`, que parecem certos, são dos dois casos os primeiros. Não
  existe resposta que prove o handle; a confirmação vem de abrir
  `https://jobs.smartrecruiters.com/{handle}` no navegador.
- Não há nenhuma entrada `smartrecruiters` em `config/sources.yaml` hoje. O
  adapter está pronto, registrado e conferido por probe, mas nunca rodou num
  sync real.

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
- **Validado contra a API real** em 2026-09-18 com `grip`: três vagas, e a
  resposta traz `description`, `requirements`, `remote` como booleano,
  `location` e `published_at` — tudo que o adapter mapeia, sem campo inventado.

  ```bash
  pnpm jho sources probe recruitee grip
  ```

- **Aqui o handle errado se denuncia**, ao contrário da SmartRecruiters:
  subdomínio inexistente devolve `{"error":"Not Found"}`, e um que existe sem
  vaga aberta devolve `{"offers":[]}`. Um probe com zero vagas nesta fonte
  significa board vazio, não handle errado — a distinção vale porque é ela que
  decide entre corrigir a configuração e esperar a empresa publicar.
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

### Jobicy, Workable e Hacker News — `jobicy.ts`, `workable.ts`, `hackernews.ts`

Entraram em 2026-09-19, escolhidos numa pesquisa que conferiu cada endpoint por
chamada real, ToS e robots.txt (Torre, Remotar, Landing.jobs e outros ficaram
de fora por proibirem robô). Os três buscam por termo e nomeiam o empregador.

**Jobicy** (`GET https://jobicy.com/api/v2/remote-jobs?count=100&geo=<slug>`).
API documentada e sem chave, com três condições no README: creditar a Jobicy
com link para a origem, mandar a candidatura para a URL original do feed
(`applyUrl = url`) e não varrer mais que uma vez por hora. O livro de cota não
tem janela de hora, então o orçamento é 24/dia e 1/min. `handle` é o slug de
geografia; vazio vale `latam`, que também devolve toda vaga "Anywhere".
`jobGeo` é quem pode se candidatar ("Geographic employment restriction, or
`Anywhere`"): vira a frase `Location restricted to: X only.` da descrição, como
na Himalayas, e "Argentina" sozinha bloqueia. `tag` aceita 3–50 caracteres;
fora disso a busca não gasta chamada. As chaves de salário **somem** quando a
vaga não informa pagamento, em vez de virem `null`.

**Workable** (`GET https://jobs.workable.com/api/v1/jobs?query=<q>&location=Brazil&workplace=remote`).
A busca global da Workable: todas as empresas do ATS, com país e modalidade
estruturados por vaga. API não documentada; o robots.txt proíbe as páginas
HTML de busca (`/search*?*`), não `/api/`, e os termos de uso não têm cláusula
de raspagem. A mesma vaga aparece uma vez por país em que contrata — filtrar
pelo Brasil é também o que tira as cópias. Pagina com `pageToken` (o
`nextPageToken` da resposta), 20 por página. O widget por empresa
(`apply.workable.com/api/v1/widget/accounts/<conta>`) existe, mas lista títulos
sem descrição, a mesma armadilha da SmartRecruiters. `handle` é o texto da
busca.

**Hacker News** (`GET https://hn.algolia.com/api/v1/search?tags=comment,story_<id>`).
O fio mensal "Ask HN: Who is hiring?" pela API oficial da Algolia: o mais
recente de `search_by_date?tags=story,author_whoishiring`, que também publica
"Who wants to be hired?". Só comentário de topo (`parent_id` igual ao fio) é
vaga, e só se a primeira linha seguir a convenção "Empresa | Cargo | Local",
com pelo menos três partes — isso descarta respostas, quem procura emprego no
fio errado ("Location: London…") e também os anúncios em prosa, uma perda
aceita (26 de 261 em setembro de 2026). O HN separa parágrafos com `<p>` sem
fechamento e escapa `/` e `'` como entidade hexadecimal, que `htmlToText` não
decodifica; o adapter trata as duas coisas depois de tirar as tags.

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
  async fetchJobs(config: SourceConfig): Promise<SourceSnapshot> {
    const url = `https://exemplo.com/api/jobs?board=${encodeURIComponent(config.handle)}`;
    const data = await getJson<{ jobs?: MinhaFonteJob[] }>(url);
    const jobs = (data.jobs ?? []).map((j): RawJob => ({ /* ... */ }));
    return { jobs, warnings: [], completeness: "partial" };
  },
};
```

Checklist do adapter:

- Declare `completeness: "complete"` só quando a resposta prova o fim da lista
  (board inteiro numa resposta, página curta, sem próximo token, total
  alcançado). Janela de recência, primeira página ou corte por teto é
  `partial` — e fonte parcial nunca fecha vaga por ausência
  ([Completude da listagem](#completude-da-listagem)).
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
o que aconteceu com `workable` antes de ele ganhar adapter.

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

`enabled` tem default `true`; `loadSources()` devolve a entrada com o campo, e
a linha **não gerida** do banco o espelha. Enquanto a linha não for gerida, uma
fonte com `enabled: false` some do `sources list` e do `sync`, mas as vagas dela
continuam no banco. Em linha gerida o arquivo não decide mais: desligar é
escrita no banco.

**O banco é a fonte da verdade do catálogo.** Depois de `jho sources import
--apply`, ou de uma edição do admin, a linha passa a ser **gerida**
(`managed_at`) e o YAML não a regrava mais: só insere entradas novas, que nascem não geridas. O sync
seleciona as fontes do banco (habilitada, não aposentada, kind com adapter,
fora de `~terms`), não da lista do arquivo. `jho sources diff` mostra onde
arquivo e banco divergem. Regime completo em `docs/data-model.md` (`source`).

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
| Identificar-se | Header `user-agent` em toda requisição: `process.env.JHO_USER_AGENT` com fallback `"master-jobs/0.1 (personal job search)"` |
| Timeout curto | `AbortController` com `DEFAULT_TIMEOUT_MS = 20_000` |
| Retry só em falha transitória | `RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])`; no máximo 2 retries (`opts.retries ?? 2`). Plataforma com orçamento (Remotive, RemoteOK, Himalayas, Jobicy, Workable, Hacker News) chama com `retries: 0` — ver "Busca por termo" |
| Não martelar em 4xx | Status fora de `RETRYABLE` faz `throw` imediato do `HttpError` — "a 404 means the board handle is wrong; retrying just wastes time" |
| Backoff | `500 * 2 ** attempt` ms, ou seja 500 ms e depois 1000 ms |
| Concorrência limitada | `syncAll()` usa uma fila com `concurrency` workers, default 4 (`--concurrency <n>`) |

> **Invariante:** adapter acessa a rede pela porta HTTP (`getJson()` para
> JSON, `getText()` para HTML). Um adapter que chama `fetch` diretamente escapa
> do user-agent, do timeout e da política de retry — e o custo de errar isso
> não é um teste vermelho, é um IP bloqueado num serviço gratuito que não tem
> canal de suporte para reverter.
>
> Abaixo da porta, **toda URL de vaga** — adapter, sonda de `jobs verify` (HEAD
> e GET) e captura de `scrape run` — passa por `safeRemoteFetch`
> (`src/core/remote-url.ts`), que valida cada salto de redirect: endereço
> privado, DNS misto e o domínio do LinkedIn (regra 1) são recusados antes do
> pedido. A recusa ao LinkedIn não é repetida pelo laço de retry; falha de DNS,
> que pode ser transitória, continua sendo. O inventário de
> quem pode abrir transporte de saída é fechado e testado
> (`tests/outbound-transport-boundary.test.ts`); detalhes da recusa ao LinkedIn
> em `docs/linkedin-policy.md` §5.1.

Se você precisa de mais volume de uma fonte, prefira **mais queries
específicas** (como as duas entradas `remotive`) a subir `limit` /
`results_per_page` acima do que o adapter já usa. Query específica melhora o
sinal; página maior só aumenta a conta de quem hospeda.

---

## Busca por termo

O candidato salva um termo ("php", "Tech Lead") e o sistema busca vagas desse
termo nas plataformas cadastradas que buscam por termo (ADR-004 da feature
`term-search-target-tracks`). O código mora no contexto `src/contexts/sourcing/`.

### Quais plataformas, e com que orçamento

A capacidade é opcional no adapter: `termSearch = { budget, validatedOn, search }`.

| Plataforma | Endpoint | Orçamento declarado | Validada |
|---|---|---|---|
| `remotive` | `GET https://remotive.com/api/remote-jobs?search=<q>&limit=100` | 4/dia, 2/min, 1 chamada por captura | 2026-09-19 |
| `remoteok` | `GET https://remoteok.com/api?tag=<termo-com-hífen>` | 1/min, 1 chamada por captura | 2026-09-19 |
| `himalayas` | `GET https://himalayas.app/jobs/api/search?q=<q>&page=<n>` | 20 por página, até 5 páginas; 429 esgota o dia | 2026-09-19 |
| `jobicy` | `GET https://jobicy.com/api/v2/remote-jobs?tag=<q>&geo=latam&count=100` | 24/dia, 1/min, 1 chamada por captura | 2026-09-19 |
| `workable` | `GET https://jobs.workable.com/api/v1/jobs?query=<q>&location=Brazil&workplace=remote` | 10/min, 20 por página, até 5 páginas | 2026-09-19 |
| `hackernews` | `GET https://hn.algolia.com/api/v1/search?tags=comment,story_<fio>&query=<q>` | 30/min, 2 chamadas por captura (achar o fio, buscar nele) | 2026-09-19 |

- **`validatedOn`** é a data em que a integração passou por
  `jho sources probe <kind> --term <t>` contra a API real. Com `null`, a
  plataforma fica fora das capturas. O parâmetro `tag` do RemoteOK não é
  documentado; a busca da Himalayas é outro endpoint, e não o feed que a
  sincronização usa (o feed ignora `q`).
- **A Himalayas pagina a busca por `page`**, a partir de 1 — `offset` é
  ignorado ali — e uma página pode vir incompleta no meio dos resultados (19 na
  página 3 de 296). Só página vazia ou o total encerram a busca.
- **O orçamento é do sistema inteiro.** A sincronização regular também reserva
  antes de chamar uma plataforma orçada: as duas entradas `remotive` do
  `sources.yaml` gastam 2 das 4 chamadas diárias, e as capturas por termo
  disputam as outras 2. A sincronização conta uma unidade por fonte sincronizada
  (as páginas do feed da Himalayas são uma execução só).
- A Himalayas não tem limite por minuto — o orçamento dela é o do PRD: 20 por
  página, no máximo 5 páginas por execução, e o 429 esgota o dia. Com 1 por
  minuto a captura parava na primeira página, com 20 das 100 vagas.
- RemoteOK aceita 1 chamada por minuto. `jho terms run` espera essas janelas
  (até 20 minutos, dentro do job de 60 da varredura) em vez de sair com a fila
  parada: cada termo ativo roda uma vez no dia, não só o primeiro da ordem
  alfabética.
- Linha de captura de um dia anterior que ficou na fila é aposentada
  (`skipped`, motivo `stale`) na próxima reivindicação: a busca de hoje a
  substitui, e a plataforma não é chamada duas vezes para o mesmo termo no dia.
- Cada candidato pede no máximo 40 buscas por dia pela tela
  (`saved_term_request`). Apagar o termo não zera a conta; passado o teto, o
  termo é salvo e espera a varredura diária.

### O livro de cota (`platform_quota`)

Uma linha por (plataforma, janela, início da janela), com janela `day` (dia
UTC) ou `minute`. A reserva é um upsert condicional — soma 1 só se o uso está
abaixo do limite, e devolve a linha só quando somou —, então dez trabalhadores
concorrentes nunca passam do limite. Janela de minuto cheia devolve a unidade do
dia. Um **429** leva o dia da plataforma ao teto: nada mais sai para ela até a
meia-noite UTC. Sincronização barrada pela cota registra `source.last_error =
"quota"` e não faz chamada.

### A fonte `~terms` e o que a captura nunca faz

Vaga nova trazida por captura entra na fonte `<kind>:~terms` (rótulo
"Remotive — termos"), criada na primeira captura com `enabled = false`. Como a
sincronização lê só o `sources.yaml`, ela nunca sincroniza nem fecha essa fonte;
só a verificação (404/410) fecha suas vagas. Por isso o YAML **recusa handle que
começa com `~`**.

A criação é idempotente também quando as primeiras capturas da plataforma
terminam juntas. O insert ignora conflito em qualquer uma das duas identidades
únicas da fonte: `id` e `(kind, handle)`. Arbitrar só `id` deixa uma corrida no
índice de `(kind, handle)` transformar uma resposta válida em falha de captura.

Vaga que já existe é observada com `keepExistingSource`: continua com a fonte,
o id externo, as URLs e o payload de quem a trouxe primeiro, e só o conteúdo é
atualizado. A captura nunca fecha, arquiva, apaga nem reatribui vaga. Vaga
fechada ou arquivada que reaparece — por captura ou sincronização — reabre
inteira: `closedAt` e `archivedAt` voltam a nulo.

### Atribuição

A busca da plataforma devolve vaga que não cita o termo (a Remotive devolveu 16
para "Laravel"; 6 citavam). A captura observa todas, mas só grava
`term_attribution(term_key, job_id)` quando o termo aparece, com a borda de
palavra do scorer, no título, na empresa, na descrição ou nas tags da
plataforma. As tags só existem no payload, que a observação descarta; por isso a
decisão é tomada durante a captura. No máximo 100 vagas por plataforma por
captura, as mais recentes primeiro.

### Fila e falhas

Uma linha de `term_capture` por (plataforma, termo normalizado, dia UTC): o mesmo
termo é buscado no máximo uma vez por dia por plataforma, e serve a todos que o
salvaram. A reivindicação é `FOR UPDATE SKIP LOCKED` com lease de 5 minutos.

| Resposta da plataforma | Desfecho |
|---|---|
| 200 | `succeeded`, com `fetched`, `created`, `known`, `attributed` e `total_hint` |
| cota recusada | `waiting_quota`, com `run_after` na próxima janela |
| 429 | `waiting_quota` até a meia-noite UTC, dia da plataforma esgotado |
| 404/410 no endpoint | `failed` com `endpoint_gone`, não repete; plataforma vermelha na saúde |
| 5xx, rede | `failed` com `http_error`/`network`, repete na captura do dia seguinte |
| JSON inválido | `failed` com `parse` |
| plataforma desligada no YAML | `skipped` com `platform_disabled` |

A saúde agregada (`captureHealth`) mostra, por plataforma, uso das janelas,
capturas por estado nas últimas 24 horas, último código de erro, dias seguidos
de falha e se a repetição diária parou — sem nenhum termo, consulta ou
candidato.

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

