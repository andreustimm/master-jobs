# Latência das buscas

Nota de continuidade: nasce e morre com este slug (ADR 0011). O que sobrevive à
tarefa — diagnóstico, medidas, decisões — está em
[`docs/engineering/performance-buscas.md`](../../../docs/engineering/performance-buscas.md),
que chega a `dev` com a PR #175.

## Objetivo

As buscas (`/jobs`, `/`, `/searches`) estavam lentas e o sistema não tinha
nenhuma medida. A meta é reduzir a latência percebida **e** poder provar cada
ganho com número. A primeira entrega cortou a rede e as idas ao banco; o que resta
é o trabalho pesado sobre o acervo e a percepção de interatividade dos filtros.

## Estado em 2026-09-21

| Item | Estado |
|---|---|
| PR 1 — [#175](https://github.com/andreustimm/master-jobs/pull/175) (`perf/latencia-das-buscas`) | Rascunho, CI verde (4/4), deep-review SHIP. Falta marcar pronta e mesclar (humano) |
| Verificação em produção | Pendente, depois do deploy: `x-vercel-id` = `<borda>::gru1::…` e a primeira linha `perf` de `/jobs` com `JHO_PERF_LOG=1` |
| Todas as tarefas abaixo | Não iniciadas |

**Base das próximas branches.** As tarefas abaixo usam coisas que só existem com a
#175 (`pnpm perf:jobs`, `hasFullDescription`, `renderSession`, o cronômetro de
estágios). Espere o merge e parta de `dev`; se precisar adiantar, empilhe sobre
`perf/latencia-das-buscas` e reaponte a base da PR depois.

## Linha de base para bater

`pnpm perf:jobs` (10 mil vagas, mediana de 3, PostgreSQL local sem rede — é o
**piso**; o custo real em produção soma um round-trip por estágio em série).

| Cenário | total ms | idas | estágios (ms) |
|---|---:|---:|---|
| padrão | 77 | 9 | prelude=1.3 board=35.6 facets=38.5 tail=1 |
| com termo | 192 | 9 | prelude=1.1 board=71.2 facets=117.8 tail=1.4 |
| com cluster | 50 | 9 | prelude=1.2 board=21.1 facets=26.7 tail=0.8 |
| faixa salarial | 371 | 10 | prelude=1.3 board=304.5 facets=39 tail=25.8 |
| ordenar por pagamento | 88 | 9 | prelude=1.1 board=45.9 facets=39.2 tail=1.2 |
| sem agrupar | 63 | 8 | prelude=1 board=43.5 facets=17.2 tail=1.2 |

Guarde o relatório antes de mexer (`JHO_PERF_OUT=antes.txt pnpm perf:jobs`) e
anexe antes e depois na PR. O console do vitest é capturado: sem `JHO_PERF_OUT`
você não vê a tabela.

## Tarefas

Ordem sugerida, e o que depende do quê. Cada uma é uma PR própria para `dev`.

| # | Tarefa | Depende de | Migration | QA de jornada |
|---|---|---|:---:|:---:|
| 13 | Faixa salarial sem 7 cópias do `CASE` | — | não | não |
| 11 | Conjunto filtrado calculado uma vez | — | talvez (`group_key`) | não |
| 12 | Busca por termo indexada | confirmar `pg_trgm` no Supabase | **sim** | não |
| 17 | Régua de conexões por tela e `comVigia` em `/jobs` e `/` | — | não | não |
| 14 | Cache de facetas com TTL | 11 e 12, **e medir antes** | não | não |
| 15 | `loading.tsx` + `Suspense` em `/jobs` | 14 | não | sim |
| 6 | Overlay só na troca de rota | — | não | **sim** |
| 16 | Filtros que se aplicam sozinhos, `staleTimes` | 12 e 14 | não | **sim** |
| 18 | Sentry tracing com escrubagem | — | não | não |

**Por que 16 espera 12 e 14:** aplicar filtro a cada arrasto de slider sem
busca indexada e sem cache de facetas transforma cada movimento em cinco
varreduras do acervo.

### 13 — Faixa salarial sem 7 cópias do `CASE`

- `src/core/db/repo.ts` (`paySql`, `payCondition`, ~linhas 245–290): a
  expressão é interpolada 7 vezes. **Medido** com 29 moedas: SQL de 72 KB e 446
  parâmetros; a lista sobe de 58 para 169 ms, a contagem de 27 para 76 ms.
- Direção: passar as taxas uma vez (CTE `VALUES` ou junção lateral) em vez de
  repetir o `CASE` por moeda. Só pesa com faixa ou `sort=comp`.
- Pronto quando: cenários "faixa salarial" e "ordenar por pagamento" do
  `perf:jobs` caem de forma mensurável e o SQL gerado cai de ordem de grandeza.

### 11 — Conjunto filtrado calculado uma vez

- `canonicalOfGroup` (`repo.ts`, ~linhas 413–433) roda dentro de
  `boardConditions` em: lista, contagem, três facetas e `countHiddenByPayRange`.
  São 5 a 6 varreduras do acervo por requisição, cada uma com `row_number()`.
- Direção: `count(*) over()` na lista (elimina a contagem separada), fundir as
  três facetas, e avaliar materializar `group_key`/`is_canonical` no ingest
  (migration — ver a skill `drizzle-safe-migrations`).
- Pronto quando: as `idas` e o `facets`/`board` do `perf:jobs` caem, e os totais
  exibidos na tela continuam idênticos (há teste de que o chip conta o mesmo que
  o rodapé).

### 12 — Busca por termo indexada

- `repo.ts` (~linhas 500–506): regex `~*` sobre título, empresa e
  `coalesce(job_page.text, description_text)`. **Medido:** 160–175 ms por
  consulta, cinco consultas por requisição.
- `src/core/term.ts` (~linhas 60–71): o padrão `[ -]?` entre letras impede a
  extração de trigramas (INFERIDO). Repense a semântica de "palavra inteira"
  antes de escolher `pg_trgm` ou `tsvector`.
- **Confirmar antes:** `pg_trgm` e `unaccent` no plano Supabase do projeto
  (`select name from pg_available_extensions`, só leitura; não foi conferido).
- Migration: suspende a promoção automática (`dev` → `staging`) enquanto a
  diferença em `drizzle/` existir. Decida se é aditiva. ADR se restringir o
  futuro. Atualize `docs/data-model.md`.

### 17 — Régua de conexões por tela

- `tests/db-fan-out.test.ts` mede **função**; a invariante é por **requisição**.
  `/`, `/jobs` e `/searches` compõem leituras no corpo do Server Component e
  ficam fora da régua. Duas requisições na mesma instância pedem mais de 3
  conexões a um pool de 3 (`client.ts`, `max: 3`) e a Vercel mata as duas aos
  30 s — o 504 de `/candidate/skills`, ainda possível aqui.
- Direção: estender a régua à composição da tela (layout + página) e pôr
  `comVigia` onde falta. Caso de browser que pede a tela duas vezes ao mesmo
  tempo. Ver `docs/operations.md`, Troubleshooting.

### 14 — Cache de facetas

- As facetas só dependem de `minFit`, `cluster`, `term`, `sources`, `workMode`,
  `track` e `groupRepeats` — não de `page`, `size`, `sort`, `dense`, `pay` nem
  `company`. Paginar ou ordenar refaz três varreduras à toa.
- Direção: `unstable_cache` (ou mapa com TTL no processo) com chave
  `candidateId` + filtros + `SCORER_VERSION`, TTL ~60 s, e `revalidateTag(tag,
  'max')` nas ações que hoje só chamam `revalidatePath`. O sync e o score rodam
  **fora** do processo do Next: só o TTL os cobre.
- **Sem `cacheComponents`** e **sem Redis** — decisões registradas em
  `performance-buscas.md`. Lógica em `src/contexts/matching/app` (regra 4).
- Só faça depois de medir com o log por estágio em produção.

### 6, 15, 16 — Percepção (mexe na interface)

- **Overlay (6):** `TransitionLink` e `TransitionGetForm` chamam
  `transitionStore.begin()` sem atraso; toda navegação abre um overlay opaco de
  ~440 ms (`TRANSITION_MIN_MS` 180 + `SPLASH_FADE_MS` 260) com o shell `inert`.
  Opções: não abrir quando o `pathname` não muda e usar `useLinkStatus` /
  `data-pending` na lista, ou atrasar o overlay até ~250 ms. Manter `offline` e
  `prolonged`.
- **Cuidado:** 28 referências no E2E (`tests/e2e/ui.mjs`), cinco arquivos de
  teste (`navigation-transition`, `pwa-transition`,
  `cov-transition-store-ambiente`, `navigation-adapters`, `pwa-chrome`),
  `docs/qa/reports/2026-08-23-task-02-loading-transicoes.md` e
  `BUG-20260824-canonical-route-splash`. A regra 20 exige QA de jornada.
- **`loading.tsx` (15):** o teste `navigation-adapters` afirma que
  `app/loading.tsx` **não existe**; ponha em `app/jobs/`. Ele também liga o
  prefetch até a fronteira em rota dinâmica: teste.
- **Filtros (16):** `Slider.Root` do Base UI tem `onValueCommitted`;
  `requestSubmit()` com debounce de ~300 ms; `q` com ~400 ms e mínimo de 3
  caracteres; a URL segue como fonte da verdade. Texto de interface vem do
  dicionário (regra 9) e cor só por token (regra 10).

### 18 — Sentry tracing

- `tracesSampleRate` é 0 porque a transação carrega a URL com a query string, isto
  é, os filtros da pessoa. Ligar exige `beforeSendTransaction` e
  `beforeSendSpan` reaproveitando `scrubEvent`/`redactPath` de
  `src/core/observability.ts`, e teste de que nada vaza.
- **Não confirmado:** a quota de spans do plano Developer (o "5M" veio de resumo
  de página de preços) e se `instrumentPostgresJsSql` existe no `@sentry/nextjs`.
  Memória do projeto: `sentry-configurado-so-servidor`.

## Como validar

Prefixe **todo** comando de shell com `rtk` (Codex e OpenCode). Node 24.19.

```bash
rtk pnpm check              # changelogs, tracker de QA, typecheck, testes com cobertura
rtk pnpm test:e2e           # browser real isolado — obrigatório se tocar página, layout ou sessão
rtk pnpm perf:jobs          # antes e depois, com JHO_PERF_OUT
```

Suítes pesadas em sequência, uma por vez (a máquina reprova por memória, não por
regressão: `Worker exited unexpectedly` sem nenhum `×`).

## Regras do repositório que mais mordem aqui

- **18** — worktree a partir de `dev`, branch `<tipo>/<slug>`, PR para `dev`.
- **19** — `deep-review` antes de pedir revisão; `SHIP` ou a decisão escrita na PR.
- **20** — mudança visível atualiza e percorre o QA vivo (`docs/qa/`); refactor
  puro declara "sem mudança visível".
- **21** — commit releaseável leva os três changelogs em `## [Unreleased]`.
  **Acrescente**, não substitua: a memória `changelog-corrida-com-promocao`
  registra a entrada que sumiu quando outra PR reescreveu o bloco.
- **23** — `docs/` atualizado (`data-model.md` se schema, `operations.md` se
  invariante) ou uma linha na PR dizendo por quê.
- **4, 5, 9, 10** — módulo novo entra por porta só onde há variação real; sintaxe
  TypeScript apagável (sem `enum`); texto de UI do dicionário; cor por token.
- **Dado faltante pontua neutro** e o scorer só muda com bump de `SCORER_VERSION`
  (não deve ser preciso aqui).

## Armadilhas já pagas

- **Régua por função aprova a tela que estoura.** Conte consultas e picos por
  **requisição**.
- **Número local é piso.** Sem rede a ida custa quase nada; o custo real é
  `estágios em série × round-trip`.
- **`rtk` esconde erro de ferramenta:** rode `tsc --noEmit` para um arquivo de
  log e leia o log bruto.
- **`Server-Timing` não serve a páginas**; a medição em produção é o log JSON por
  estágio (`registrarTempo`).
- **Mude a região e o teste juntos:** `tests/function-region.test.ts` trava
  `vercel.json` contra o host do pooler de produção.

## Pendências fora de código

- O plano da Vercel é Hobby, restrito a uso pessoal e não comercial; o
  repositório tem papel de recrutador. Confirmar o plano em uso.
- Disponibilidade de `pg_trgm`/`unaccent` e de "Query Performance" no plano
  Supabase.
