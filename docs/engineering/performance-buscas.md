# Latência das buscas — diagnóstico, medição e plano

Levantado em 2026-09-21, a partir de "as buscas estão lentas e não temos nenhuma
observabilidade". Quatro leituras independentes (consultas e índices, renderização
e cache, infraestrutura, ferramentas gratuitas) foram cruzadas aqui. **Cada
afirmação diz se foi MEDIDA ou INFERIDA** — a lentidão era uma sensação sem
número, e a primeira entrega foi justamente poder medi-la.

> Este documento diz **como é agora**. O que mudou em cada versão está nos
> changelogs; o que ainda falta está na seção [Plano](#plano).

## Como medir

Três camadas, da mais barata para a mais fiel. Nenhuma substitui a outra.

| Camada | Comando ou sinal | O que responde | Limite |
|---|---|---|---|
| **Piso local** | `pnpm perf:jobs` | Quanto o servidor gasta sobre o banco em 6 cenários (padrão, termo, cluster, faixa salarial, ordenar por pagamento, sem agrupar), 10 mil vagas, e **quantas idas ao banco** cada um faz. Hermético: Postgres em Docker, fora do `pnpm check`. `JHO_PERF_OUT=arquivo` guarda o relatório; `JHO_PERF_JOBS=N` muda o corpus; `JHO_PERF_RUNS=N` e `JHO_PERF_WARMUPS=N` controlam as repetições (inteiros positivos, padrões 3 e 1); `JHO_PERF_JSON=arquivo` guarda amostras, volume de SQL/parâmetros, resultados de referência e plano de execução | Sem rede. Não mede React nem o navegador |
| **Produção, por estágio** | Linha JSON `{"perf":"/jobs","totalMs":…,"region":"gru1","stages":{…}}` no log da função | Onde uma requisição real gasta o tempo: `auth`, `prelude`, `board`, `facets`, `tail` (e `cockpit` em `/`) | Sai só se a leitura passa de 1 s, ou sempre com `JHO_PERF_LOG=1`. Log da Vercel na Hobby dura 1 h |
| **Produção, de fora** | `pnpm perf:producao` (e `--logs`) | TTFB frio e quente, p50/p95, região e cache por rota; com `JHO_PERF_SESSION`, `/jobs` com os filtros comuns; com `--logs`, a agregação das linhas `perf` acima | Ver [Medir a produção](#medir-a-produção-221). De fora não se prova que a instância estava fria |
| **Produção, amostrada** | Trace do Sentry: span `jho.leitura` por rota e `jho.etapa` por estágio | Os mesmos estágios da linha acima, com os spans de renderização e de PostgreSQL do SDK, e retidos além de 1 h | Amostra de `SENTRY_TRACES_SAMPLE_RATE` (padrão 10%). Ver [Sentry](#sentry-e-o-que-fica-de-fora) |
| **Região** | Cabeçalho `x-vercel-id` da resposta | Onde a função rodou. `<borda>::gru1::…` é o certo (o primeiro trecho é a borda de quem pediu, só o segundo é a função); `<borda>::iad1::…` é a função longe do banco | Só diz a região, não o custo |

A linha de log leva só número, nome de estágio, rota **sem query string** e
região. Nunca valor de filtro, identidade ou id de candidato — a URL carrega o
filtro da pessoa, e é por isso que o tracing do Sentry só saiu depois de uma
peneira com lista de permissão (ver [Sentry](#sentry-e-o-que-fica-de-fora)).

**`Server-Timing` não serve aqui.** Server Components não escrevem cabeçalho de
resposta (a documentação do Next não tem API para isso), e o `proxy.ts` roda
antes da renderização, sem saber quanto ela vai custar. Vale para rota de API,
que não é onde a lentidão está.

## Medir a produção (#221)

`scripts/perf/medir-producao.ts`, pelo atalho `pnpm perf:producao`. Só faz GET
e lê log: nada é gravado em produção. As regras que decidem o que sai no
relatório são puras, em `scripts/perf/medicao.ts`, e testadas em
`tests/perf-producao.test.ts`.

### Sem sessão: frio e quente das rotas públicas

```bash
pnpm perf:producao                                  # 1 rodada × 10 amostras
pnpm perf:producao --rodadas 3 --pausa 600          # 3 rodadas com 10 min ociosos entre elas
pnpm perf:producao --amostras 20 --json perf.json   # guarda o resumo em JSON
```

Três cenários: `/login` (renderiza na função e faz uma consulta — o melhor sinal
público de partida a frio), `/offline.html` (estático, servido pela CDN) e
`/jobs` sem cookie (o proxy responde 307 sem renderizar). Antes de cada rodada
o script abre a conexão num estático fora da conta, para a primeira amostra
não somar DNS e TLS. "Primeira" é a 1ª requisição do cenário na rodada, e só é
fria se a instância estava ociosa — daí `--pausa`. O relatório diz, por
cenário, `borda::função` lido do `x-vercel-id` e o `x-vercel-cache`.

**Medido em 22/09/2026, 21:27–21:48 UTC**, produção 1.21.2, 3 rodadas × 10
amostras, 10 min ociosos entre rodadas, de São Paulo:

| Cenário | Primeira (3 rodadas) | Quente p50 | Quente p95 | `x-vercel-id` |
|---|---|---:|---:|---|
| `/login` (função + 1 consulta) | 164 · 1.346 · 1.375 ms | 88 ms | 135 ms | `gru1::gru1` |
| `/offline.html` (CDN) | 32–49 ms | 39 ms | 50 ms | `gru1::sem função` |
| `/jobs` sem cookie (proxy 307) | 40–45 ms | 39 ms | 49 ms | `gru1::sem função` |

A primeira rodada não estava fria (o script tinha rodado um minuto antes); as
duas depois de 10 min ociosos custaram ~1,35 s, e uma das 27 quentes, 1.084 ms
— provavelmente uma segunda instância subindo. **Região confirmada:** a função
roda em `gru1`, ao lado do banco (`sa-east-1`). O custo da partida a frio é da
função, não da borda nem do proxy: o 307 e o estático ficam em ~40 ms mesmo
depois da pausa. Limites: um único ponto de origem, poucas amostras frias, e o
`/login` faz uma consulta leve — não mede o custo de `/jobs`.

### Com sessão: `/jobs` com os filtros comuns

O cookie vem **só** do ambiente, do próprio dono, e nunca é gravado em arquivo,
impresso ou mandado a outro host que não seja HTTPS ou `127.0.0.1`/`localhost`:

1. No navegador, com a sessão aberta em produção: DevTools → Application →
   Cookies → `jobs.mastertimm.com.br` → copie o **valor** de `jho_session`.
2. No terminal, sem deixar o valor no histórico do shell:

   ```bash
   read -rs JHO_PERF_SESSION     # cole o valor; nada aparece
   export JHO_PERF_SESSION
   pnpm perf:producao --rodadas 3 --pausa 600 --amostras 10
   unset JHO_PERF_SESSION
   ```

Além dos três públicos, mede `/jobs`, `/jobs?fit=45`,
`/jobs?fit=45&workMode=remote` e `/jobs?fit=45&q=<termo>`. O termo padrão é
`typescript`; `JHO_PERF_TERMO` troca, e o valor nunca aparece na saída — o
relatório só diz "termo". Ao fim de cada rodada — depois das amostras, para
não aquecer a função antes da "primeira" — o script confere a sessão em
`/account`, que não tem fronteira de carregamento: se ela venceu, para no 307
para `/login` sem gravar nada. Em `/jobs` esse 307 não existe mais — desde a
#217 o esboço compromete a resposta em 200 e a sessão vencida redireciona pelo
cliente. Pelo mesmo motivo, o TTFB de `/jobs` a partir da #217 mede a chegada do
esboço, não a da lista: compare rodadas anteriores pelo tempo total. Cada
requisição com sessão é uma visita real: conta como uso, e um `?by=` salvo
nunca é pedido.

### Por dentro: as linhas `perf` do log

`/jobs` e `/` cronometram cada espera do banco com `createStageTimer`
(`timer.time("auth" | "prelude" | "board" | "facets" | "tail" | "queue", …)`
em `app/jobs/(lista)/page.tsx` e `app/jobs/jobs-data.ts`; `cockpit` em `app/page.tsx`),
dentro do `comVigia`. `registrarTempo` escreve uma linha JSON só com número,
nome de estágio, rota sem query string e região:

```json
{"perf":"/jobs","totalMs":5291.3,"region":"gru1","stages":{"auth":168.5,"prelude":71,"board":1571,"facets":3479.2,"tail":0.1}}
```

Ela só sai quando a leitura passa de 1 s, ou sempre com `JHO_PERF_LOG=1` na
Vercel. **Sem a variável a amostra é enviesada**: mostra só as lentas. Ligar a
variável exige um novo deploy — é decisão do dono, e pode ser desligada depois.

Para ler (o log da Hobby dura 1 h, então rode logo depois de usar a tela):

```bash
pnpm perf:producao --logs --since 1h
```

O script chama `vercel logs --environment production --query perf --json`,
relê cada mensagem por `lerLinhaPerf` e imprime só a agregação por rota e
estágio (n, p50, p95, máximo), a janela de tempo e o id da implantação.
Lê no máximo `--limit` registros (padrão 500) do projeto `--projeto` (padrão
`master-jobs`); se a contagem impressa bater no limite, aumente-o ou encurte
`--since`, ou a amostra fica cortada. Mensagem bruta e caminho da requisição do log nunca são impressos. Quem
preferir o CLI direto deve usar `--query perf` e ler só o campo `message`:
os outros campos do registro trazem o caminho requisitado.

**Uma linha observada em 22/09/2026 às 21:21 UTC**, no mesmo minuto em que a
1.21.2 foi publicada (implantação `dpl_2w4g3kPZRb5y4E4KVDTi6jt8TkJZ`), sem
`JHO_PERF_LOG`:

| Estágio | ms |
|---|---:|
| `auth` | 168,5 |
| `prelude` | 71 |
| `board` | 1.571 |
| `facets` | 3.479,2 |
| `tail` | 0,1 |
| **total** | **5.291,3** |

Uma amostra, provavelmente fria, com filtros desconhecidos: não é p50 de nada.
Mas localiza a espera: `board` e `facets` são 95% do total, e o prelúdio, que a
#175 enxugou, custa 71 ms. Leitura local vs. produção: o `perf:jobs` põe
`facets` em ~24 ms com 10 mil vagas sem rede; 3,5 s em produção é outra ordem
de grandeza, e não se explica por round-trip (uma ida em `gru1` custa poucos
ms). Hipóteses a medir com `JHO_PERF_LOG=1`: partida a frio do pool e do plano,
buffers frios no Supabase, ou o plano de produção diferente do local.

### Procedimento recomendado

1. `pnpm perf:producao --rodadas 3 --pausa 600` (sem sessão) — região e frio.
2. O mesmo com `JHO_PERF_SESSION` — `/jobs` por filtro, frio e quente.
3. Se o dono ligar `JHO_PERF_LOG=1`: usar a tela alguns minutos e rodar
   `pnpm perf:producao --logs --since 1h` — estágios por requisição.
4. Registrar na #221 as tabelas impressas, o SHA/versão e a janela. Nenhuma
   delas carrega filtro, termo, cookie ou caminho requisitado.

## Diagnóstico

O tempo vem de três camadas somadas. **Falta de índice não é uma delas**: um scan
em `job` custa ~2 ms, porque 61% das vagas estão abertas.

### 1. Rede: a função estava longe do banco

- **MEDIDO:** funções da Vercel em `iad1` (Virgínia, `vercel.json`); banco
  Supabase em `sa-east-1` (São Paulo, `supabase projects list` e o host do
  pooler em `scripts/migration/production-target.ts`). O `x-vercel-id` de
  produção era `gru1::iad1::…`: borda em São Paulo, função na Virgínia, banco em
  São Paulo.
- **INFERIDO:** cada ida pagava ~110–130 ms de round-trip. Não foi medido, porque
  só se mede de dentro da função — o log por estágio existe para isso.
- `docs/engineering/deploy.md` dizia `aws-us-east-1`. Era sobra do Turso.

### 2. Aplicação: cascata, sessão triplicada, nada em cache

- **MEDIDO (`pnpm perf:jobs`):** `/jobs` fazia de 10 a 12 consultas por
  requisição. Só o prelúdio já eram 5 ou 6 esperas em série: trilhas, as
  **mesmas** trilhas para o escopo (e de novo para o cluster), termos salvos,
  câmbio em duas consultas.
- `currentSession()` rodava 3× por carga (layout, `SessionBadge`, página), cada
  uma com `getCandidate()` + `resolveSession()` — e `getCandidate()` só serve ao
  modo aberto, que não existe em produção.
- Nenhum cache (`unstable_cache`, `'use cache'`, `cache()` do React), nenhum
  `loading.tsx`, `Suspense` só no observador de navegação.
- O teto de conexões (`POOL - 1` = 2 por leitura) é o que empurra tudo para série.
  Ver `docs/operations.md` → Troubleshooting.

### 3. Banco: o mesmo trabalho pesado repetido por requisição

Números do PostgreSQL local com 9 mil vagas, sem rede — o **piso**.

| Achado | Evidência | Estado |
|---|---|---|
| Varreduras repetidas por requisição (`canonicalOfGroup`) | Lista e total compartilham a seleção; as facetas usam outra leitura com dimensões independentes; o aviso salarial mantém sua própria semântica | **MEDIDO**, corrigido na tarefa 11 |
| Busca por termo: regex `~*` sobre título, empresa e descrição, que nenhum índice atende diretamente | 160–175 ms por consulta × 5 consultas; só `sum(length(description_text))` leva 116 ms | **MEDIDO**, pré-filtro trigrama em revisão (#214, seção abaixo). O padrão `[ -]?` de `term.ts` de fato impede a extração de trigramas: **MEDIDO**, o índice direto devolveu 8.863 de 9.060 linhas |
| `length(descricao) >= 200` calculado em todas as linhas antes do `LIMIT`, para a UI só testar `< 200` | 103 ms → 26 ms com `substr` (mesmo resultado em 199/200/201, acento, emoji, vazio, nulo) | **MEDIDO**, corrigido |
| Faixa salarial: `paySql` interpolada repetidamente | Na tela completa com 29 moedas, 183 KB de SQL e 1.169 parâmetros; normalização compartilhada reduziu para 48 KB e 301 | **MEDIDO**, corrigido; comparação abaixo |
| Estimativa errada do planner em `coalesce(fit,0) >= n` sobre `LEFT JOIN` | estimou 2 linhas, vieram 1.568 | **MEDIDO**, aberto |
| `/searches`: N+1 de `countNewJobs` (até 20 termos) e `listTracks` duplicado | leitura do código, consultas leves por índice | INFERIDO, custo é round-trip |

Paginação por `OFFSET` **não** é o problema (top-N heapsort de 107 kB), e o
agrupamento em JS custa 18 ms no pior caso (50 linhas × 42 publicações).

### 4. Percepção: o overlay custa mais que o servidor

`TransitionLink` e `TransitionGetForm` chamam `transitionStore.begin()` sem
atraso. Toda navegação — inclusive mudar só um chip de filtro — abre um overlay
opaco de tela cheia: **180 ms mínimos** (`TRANSITION_MIN_MS`) mais **260 ms** de
esmaecimento (`SPLASH_FADE_MS`), com o shell `inert`. ~440 ms fixos, mesmo se o
servidor responder na hora. **MEDIDO no código; não cronometrado no navegador.**

**Mudança da #220 (em revisão para `dev`):** na mesma tela o overlay não abre mais. O store decide
por `isSameScreenNavigation` (mesmo `pathname`, query diferente) e marca a
geração como `soft`; a apresentação vira `aria-busy` e
`data-navigation="soft"` no `#application-shell`, com o `<main>` esmaecido por
CSS depois de 120 ms. O ciclo do store é o mesmo (mínimo, `leaving`, `reset`):
o ganho é a tela continuar visível e operável, não um fim mais cedo. Encerrar
no commit foi tentado e reprovado pelo E2E de modalidade: no voltar/avançar o
roteador confirma a URL antes de o conteúdo da entrada chegar, e o shell
anunciava pronto sobre a lista anterior por até alguns segundos. Na saída o
conteúdo volta à opacidade plena e `aria-busy` só cai no `reset`. Demora
(`prolonged`) e falta de rede (`offline`) zeram `soft` e promovem ao overlay.
Troca de rota continua igual.

## Baseline: antes e depois da primeira entrega

`pnpm perf:jobs`, 10 mil vagas, mediana de 3 execuções, mesma máquina. Coluna
**idas** = consultas por requisição.

| Cenário | idas antes | idas depois |
|---|---:|---:|
| padrão | 11 | 9 |
| com termo | 11 | 9 |
| com cluster | 12 | 9 |
| faixa salarial | 12 | 10 |
| ordenar por pagamento | 11 | 9 |
| sem agrupar | 10 | 8 |

O **tempo local não muda** (77–81 ms no padrão antes e depois): sem rede, a ida
custa quase nada. O ganho está nas idas em **série** — o prelúdio de `/jobs`
passou de 5–6 esperas para 1 — e cada uma custa um round-trip de verdade em
produção. Por isso a régua nova está em `tests/db-fan-out.test.ts`, que **conta**
consultas, e não em tempo.

## Normalização salarial — medição de 22/09/2026

O filtro salarial usa uma relação com uma remuneração normalizada por vaga
aberta. A consulta externa e a escolha da publicação do grupo compartilham essa
relação: a faixa não expande cotações e regras de período em cada comparação.
Quando só há ordenação ou exibição salarial, uma junção lateral procura a cotação
nas linhas participantes, evitando calcular o acervo inteiro sem necessidade.
Sem controle salarial, a consulta continua sem essa relação.

A mediana usa a média das duas amostras centrais quando há um número par de
execuções. Os estágios da tabela ilustram uma execução real: a amostra central
superior, que pode diferir da mediana do total.

Mesma máquina e corpus sintético de 10 mil vagas, três aquecimentos e dez
amostras por cenário. Medianas locais, sem rede; não são tempos de produção.

| Cenário | Antes | Depois | SQL total antes → depois | Parâmetros antes → depois |
|---|---:|---:|---:|---:|
| Faixa salarial | 395,05 ms | 109,95 ms | 183.062 → 48.326 bytes | 1.169 → 301 |
| Ordenar por pagamento | 96,75 ms | 89,15 ms | 54.797 → 35.580 bytes | 345 → 221 |

A comparação dos seis cenários preservou linha a linha os resultados, ordem,
valores, estados salariais, grupos, contagens e facetas. Os testes de contrato
comparam também todos os períodos ao normalizador TypeScript e verificam a
publicação elegível de um grupo quando a primeira fica fora da faixa.
A aritmética e o arredondamento não mudam; a consulta passa a reutilizá-los.

Para reproduzir a evidência estruturada:

```bash
rtk proxy env JHO_PERF_RUNS=10 JHO_PERF_WARMUPS=3 JHO_PERF_OUT=antes.txt JHO_PERF_JSON=antes.json pnpm perf:jobs
```

O JSON contém somente o corpus sintético do benchmark: amostras por estágio,
volume total de SQL/parâmetros, resultados de referência e `EXPLAIN (ANALYZE,
BUFFERS, FORMAT JSON)` da maior consulta de cada cenário. O plano é colhido no
aquecimento, fora das amostras cronometradas. Os resultados de referência devem
coincidir antes/depois; uma diferença impede declarar a otimização equivalente.

## Lista e facetas compartilhadas — medição de 22/09/2026

Contadores, clusters e fontes compartilham os filtros comuns em uma consulta.
Cada dimensão continua ignorando apenas o próprio filtro: selecionar uma fonte
não apaga as outras opções, e selecionar um cluster não apaga os demais.
A fonte integra a chave de agrupamento; o cluster pode variar entre publicações
do mesmo grupo. Por isso a leitura conserva dois representantes: o menor id
entre todas as elegíveis e o menor id entre as que passam pelo cluster escolhido.
As vagas anônimas continuam separadas, e o score e as candidaturas continuam
restritos à pessoa e à trilha da sessão.

A tela usa `listBoardPage`: total por janela sobre ids elegíveis e dados completos
somente depois do limite da página. Uma página além do fim, ou de tamanho zero,
não tem linha para carregar o total; nesses casos a contagem separada conserva o
rodapé correto. Os demais consumidores de `listBoard` não calculam a janela.
A lista continua usando os mesmos filtros e desempates.

A largura da janela importa: carregar descrições nela fez o cenário sem agrupar
escrever 967 blocos temporários no benchmark. Restringir a janela a ids e chaves
de ordenação zerou esses blocos; o plano final da página levou 8,47 ms. Não houve
migration, coluna materializada, cache nem mudança de semântica nesta entrega.

Três aquecimentos e dez amostras sobre o mesmo corpus de 10 mil vagas.
Medianas locais, sem rede; os seis resultados completos e seus hashes coincidem.

| Cenário | Total antes → depois | Facetas antes → depois | Consultas antes → depois |
|---|---:|---:|---:|
| Padrão | 75,20 → 59,35 ms | 37,75 → 23,50 ms | 9 → 6 |
| Com termo | 184,40 → 127,90 ms | 110,70 → 54,60 ms | 9 → 6 |
| Com cluster | 50,50 → 49,25 ms | 28,05 → 23,80 ms | 9 → 6 |
| Faixa salarial | 111,40 → 94,65 ms | 39,50 → 23,55 ms | 10 → 7 |
| Ordenar por pagamento | 86,05 → 70,45 ms | 38,25 → 22,65 ms | 9 → 6 |
| Sem agrupar | 65,20 → 33,55 ms | 18,60 → 18,05 ms | 8 → 5 |

`tests/board-facets.test.ts` cobre dimensões combinadas, a troca da publicação
representante, fontes distintas do mesmo tipo, empregador anônimo, cluster
nulo, arquivamento, candidatura alheia e conjunto vazio. A régua de consultas
exige uma única ida para todas as facetas e outra para página com total, além
da leitura das irmãs quando há agrupamento; o limite por tela continua valendo.
Os testes de paginação comparam a API nova à lista e à contagem independentes,
inclusive páginas além do fim, tamanho zero e grupos.

Com `JHO_PERF_PLANS=1` e `JHO_PERF_JSON`, o benchmark guarda também os planos de
todas as consultas, na ordem de envio. Eles são coletados no aquecimento, fora
das amostras. Sem essa opção permanece somente o plano da maior consulta.

## Busca por termo indexada — medição de 22/09/2026

A semântica não muda: o `~*` de palavra inteira de `termRegexSql` continua
sendo quem decide, em título, empresa e `coalesce(job_page.text,
description_text)`. O que entra é um **pré-filtro** que só descarta vaga que
nunca casaria (#214).

**Por que não um índice direto.** O `pg_trgm` aceita `~*`, mas precisa de
trigramas garantidos no padrão, e `[ -]?` entre cada letra não deixa nenhum:
com `gin_trgm_ops` sobre `description_text`, a busca por `java` leu 8.863 das
9.060 linhas pelo índice e as descartou na reconferência — mais lento que a
varredura. `tsvector` mudaria a semântica (radical, tokenização), e `unaccent`
não serve: o contrato atual não dobra acento.

**O pré-filtro.** Se o padrão casa, o texto sem espaço e sem hífen contém a
chave do termo (`tech-lead` → `techlead`). O índice é sobre essa forma, e a
consulta pergunta `ilike '%chave%'` a ele; `~*` e `ilike` concordam sobre caixa
nas letras ASCII, então o pré-filtro só vale para chaves ASCII com três letras
ou dígitos seguidos. Termo com acento, `C++`, `CI/CD` ou `go` seguem só com o
`~*`, como antes. Os candidatos vêm num `array(...)`: um InitPlan, calculado
uma vez por consulta. As duas alternativas medidas pioraram — `in (...)` dentro
do `or` vira subplano reconstruído duas vezes por ocorrência, e a semijunção
fora do `or` mudou a estimativa e levou o agrupamento a um laço aninhado de
3,4 s no benchmark.

**Acervo local real** (cópia com 9.060 vagas, 5.576 abertas; índices criados e
desfeitos dentro de uma transação; predicado isolado, `EXPLAIN ANALYZE`):

| Termo | Antes | Depois | Buffers antes → depois | Linhas |
|---|---:|---:|---:|---:|
| `typescript` | 160,7 ms | 35,1 ms | 18.103 → 2.998 | 276 = 276 |
| `java` | 143,9 ms | 34,9 ms | 17.891 → 3.234 | 201 = 201 |

Antes: `Seq Scan` em `job` com o `~*` sobre a descrição de toda vaga aberta —
descomprimir o texto domina (só `length(description_text)` nas abertas leva
117 ms). Depois: `Bitmap Index Scan` em `job_description_trgm_idx` (350 e 389
candidatos), reconferência com perdas na própria expressão e o `~*` só nas
linhas que passaram. O índice ocupa 19 MB, para uma tabela de 62 MB.

**Benchmark sintético** (`pnpm perf:jobs`, 10 mil vagas, três aquecimentos, dez
amostras, mesma máquina; os seis resultados completos coincidem por hash):

| Cenário | Antes | Depois | board | facets |
|---|---:|---:|---:|---:|
| Com termo | 129 ms | 155 ms | 72,9 → 89,7 | 53,3 → 64,2 |

O sintético **piora**, e a razão é a fixture, não a produção: suas descrições
são 40 hashes MD5 (≈1,3 KB, abaixo do limiar do TOAST, sem compressão) e o
termo `laravel` aparece em uma de cada sete. Sem descompressão o `~*` é barato,
e com 1.286 candidatos a reconferência e o `= any` linear custam mais do que
economizam. No acervo real as descrições são longas e comprimidas e o termo
buscado é seletivo — o caso para o qual o índice existe. **Nenhum destes números
é tempo de produção;** o ganho lá só se afirma com a medição de #221 depois do
deploy.

**Disponibilidade da extensão.** No PostgreSQL local de trabalho (imagem
`supabase/postgres:17.6.1.171`), `pg_available_extensions` lista `pg_trgm` 1.6
e `unaccent` 1.1, nenhuma instalada. No Supabase de produção **não foi
consultado** por este trabalho. Para confirmar, só leitura, no SQL Editor do
projeto:

```sql
select name, default_version, installed_version
from pg_available_extensions where name in ('pg_trgm', 'unaccent');
select extname, extversion, extnamespace::regnamespace from pg_extension;
```

O caminho recomendado é habilitar `pg_trgm` pelo painel (Database →
Extensions, schema `extensions`) antes de rodar `migrate.yml`; aí a `0012` não
faz nada. Se a migration a criar, ela vai para o primeiro schema do
`search_path` da role de migração, e o índice de `0013` resolve
`gin_trgm_ops` pelo mesmo `search_path`.

## Cache das facetas — medição de 22/09/2026

A requisição de produção medida acima gastou 3.479 ms em `facets`, 66% do
total. As facetas dependem só do escopo da sessão e de sete filtros; paginar,
reordenar, mudar a faixa salarial, a empresa ou os chips de recorte refazia a
mesma consulta para devolver os mesmos números. Desde a #216,
`cachedBoardFacets` (`src/contexts/matching/app/board-facets.ts`) guarda o
resultado num mapa do processo. `/jobs` e `/` passam por ele; `boardFacets`
continua sendo a consulta, sem mudança de semântica.

**A chave** (`facetCacheKey`, pura, em `domain/facet-cache.ts`) é a serialização
canônica de tudo que a consulta recebe — `minFit`, `cluster`, `term` (texto e
chave), `sourceKinds` na ordem dada, `workMode`, `track` (candidato, trilha
principal, trilhas e modo) e `groupRepeats` —, mais o `candidateId` **da
sessão** e `SCORER_VERSION`. A chave não mantém lista própria de campos: tudo
que `FacetQuery` deixa passar entra nela. Um filtro novo da consulta só precisa
entrar no `Pick` de `FacetQuery`, e daí chega à chave sozinho. Idioma não entra porque as
facetas são números e códigos, e o texto é traduzido na página.
`tests/board-facets-cache.test.ts` prova com dois candidatos que um nunca
recebe as contagens do outro, nem com as mesmas URLs.

**Validade e invalidação.**

| O que muda | Como o cache acompanha |
|---|---|
| Triagem e funil (`trackAction`, "não me interessa", restaurar) | Invalida as entradas **do candidato**, depois da escrita, na instância que atendeu |
| Trilhas (editar, trocar a principal, arquivar, restaurar) | Invalida as entradas **do candidato** — o cockpit lê pela principal da hora |
| Vaga nova (`/jobs/new`, `/compare`, captura por termo em `after()`) | Invalida **todas** as entradas da instância |
| Sync, score, raspagem, verificação (CLI e workers, fora do processo) | Só a validade: **60 s** |
| Outra instância da função | Só a validade: a invalidação não cruza instâncias |
| Deploy ou instância nova | Mapa vazio |

60 s cobre a rajada de paginar e reordenar e deixa os chips no máximo um minuto
atrás de uma mudança externa. A lista e o total do rodapé **nunca** passam pelo
cache: no pior caso, por até um minuto, um chip conta diferente do rodapé
depois de um sync. Entrada que falha sai do cache; duas leituras iguais ao mesmo
tempo esperam a mesma consulta (a entrada é reservada antes do `await`).
O mapa mora em `globalThis`, não numa constante de módulo: o Next compila as
Server Actions importadas por componentes de cliente numa camada própria do
bundle, com cópia própria dos módulos, e uma constante de módulo faria a ação
invalidar um mapa que a página não lê.
**Memória:** teto de 200 entradas, com despejo da menos usada; cada entrada tem
menos de 1 KB.

**Local** (`pnpm perf:jobs`, 10 mil vagas, três aquecimentos, dez amostras,
mesma máquina). A leitura fria descarta o cache antes de cada amostra e é
comparável às tabelas anteriores; a quente é a página 2 logo depois da 1:

| Cenário | Antes | Depois, fria | Depois, página 2 | facets fria → quente | Consultas fria → quente |
|---|---:|---:|---:|---:|---:|
| Padrão | 57 ms | 56 ms | 31 ms | 22,1 → 0 ms | 6 → 5 |
| Com termo | 151 ms | 145 ms | 88 ms | 57,2 → 0 ms | 6 → 5 |
| Com cluster | 47 ms | 51 ms | 22 ms | 22,6 → 0 ms | 6 → 5 |
| Faixa salarial | 94 ms | 92 ms | 69 ms | 22,5 → 0,1 ms | 7 → 6 |
| Ordenar por pagamento | 68 ms | 68 ms | 47 ms | 22,3 → 0 ms | 6 → 5 |
| Sem agrupar | 29 ms | 31 ms | 12 ms | 16,8 → 0 ms | 5 → 4 |

A leitura fria não muda (a diferença é ruído). O ganho é todo na leitura que
repete filtros.

**Em produção, não confirmado.** Nenhum número da tabela acima é de produção, e o ganho
lá só se afirma com `pnpm perf:producao` com sessão depois do deploy: cada
cenário de `/jobs` pede a mesma URL várias vezes, então a "primeira" de cada
rodada é a leitura sem cache e o "quente" é a leitura com cache. Com
`JHO_PERF_LOG=1`, a linha `perf` mostra `facets` perto de 0 nas leituras
servidas pelo cache.

**O limite da função serverless.** O cache vive enquanto a instância vive. Na
medição de #221, as duas rodadas depois de 10 min ociosos pagaram partida a
frio (~1,35 s no `/login`): depois de uma pausa desse tamanho a instância, e o
mapa com ela, já não existem. E a amostra de 3.479 ms em `facets` foi colhida no
minuto do deploy, provavelmente fria — **exatamente a leitura que este cache
não acelera.** O que ele garante é a segunda leitura em diante dentro de um
minuto, na mesma instância: paginar, reordenar, abrir e voltar.

Se a medição de produção mostrar que a primeira leitura continua dominando,
o próximo passo não é um cache maior, e sim, nesta ordem:

1. Descobrir por que `facets` custa 3,5 s lá e ~24 ms aqui (buffers frios,
   plano diferente): `JHO_PERF_LOG=1`, `pg_stat_statements` e o `EXPLAIN` da
   consulta de facetas no Supabase.
2. Materializar as facetas das combinações sem termo por candidato e trilha,
   recalculadas ao fim do sync e do score — os processos que mudam as
   contagens. Isso exige migration e muda o modelo de dados; é decisão própria.
3. Só com um segundo backend real, trocar o mapa por um `CachePort` (regra 4),
   se a medição mostrar acerto baixo por espalhamento entre instâncias.

## Plano

| Fase | Item | Ganho × esforço | Onde |
|---|---|---|---|
| 1 ✅ | Função em `gru1`, ao lado do banco (`tests/function-region.test.ts` trava o par) | alto × mínimo | `vercel.json` |
| 1 ✅ | Sessão resolvida uma vez por requisição; `getCandidate()` só no modo aberto | alto × baixo | `app/auth.ts` |
| 1 ✅ | `description` mínima sem descomprimir o texto | alto × baixo | `repo.ts` |
| 1 ✅ | Prelúdio de `/jobs`: trilhas ∥ câmbio, sem `listTracks` duplicado, câmbio em 1 consulta | alto × baixo | `jobs-data.ts` |
| 1 ✅ | Medição: baseline local e log por estágio | habilita o resto | `perf:jobs`, `registrarTempo` |
| 🟡 | Medição de produção: TTFB frio/quente, região e agregação das linhas `perf` (#221, em revisão; falta a rodada com sessão) | habilita o cache de facetas | `perf:producao` |
| PR 2 | Overlay só na troca de rota (#220, em revisão); filtros que se aplicam sozinhos (#218) | alto × médio | fase 3 |
| 2 ✅ | Seleção compartilhada para lista e total, facetas fundidas | alto × médio | `repo.ts` |
| 2 🟡 | Busca por termo indexada: pré-filtro `pg_trgm`, `~*` inalterado (#214, em revisão) | alto com termo seletivo × médio | migration `0012`/`0013` |
| 2 ✅ | Normalização salarial compartilhada, sem repetir cotações a cada uso | alto com faixa | `repo.ts` |
| 2 🟡 | Cache local das facetas, validade de 60 s (#216, em revisão; ver [seção](#cache-das-facetas--medição-de-22092026)) | alto ao paginar/ordenar, nulo na primeira leitura × médio | `matching/app/board-facets.ts` |
| 3 🟡 | `loading.tsx` + `Suspense` em `/jobs` (#217, em revisão; ver [fronteira](#fronteira-de-carregamento-217)) | percepção imediata na troca de tela; o total não muda | `app/jobs/(lista)/`, `app/jobs/[id]/` |
| ✅ | Régua de conexões por **tela**, `comVigia` em `/jobs` e `/` | entregue e exercitado no QA de concorrência | testes |

### Decisões

- **Sem `cacheComponents`.** Exigiria tirar `force-dynamic` de todas as páginas e
  reintroduz o risco de dado velho que `next.config.ts` recusou de propósito. O
  sync e o score rodam **fora** do processo do Next, então só um TTL curto os
  cobriria.
- **Sem Redis agora.** Um usuário, instância reaproveitada pelo Fluid Compute:
  `React.cache` mais um mapa com TTL no processo bastam. Upstash entra atrás de
  um `CachePort` **quando** existir o segundo backend (regra 4 e ADR 0007 — porta
  com uma implementação só é cerimônia) e a medição mostrar hit rate baixo.
- **Memo do câmbio adiado.** Com a função em `gru1` cada ida custa poucos ms; o
  ganho é ≤ 1 round-trip. Medir com o log por estágio antes de decidir.
- **`renderSession` × `currentSession`.** Só renderização usa a sessão em cache.
  Ação e `guard*` leem sempre fresco: impersonação e troca de senha mudam a
  sessão **no meio** da requisição, e autorizar com o valor de antes seria a
  decisão errada.

### Fronteira de carregamento (#217)

- **Onde.** `app/jobs/(lista)/loading.tsx`, num grupo de rota que só contém a
  lista. Dois lugares foram recusados: `app/loading.tsx` cobriria o produto
  inteiro, e a ausência dele é contrato (`navigation-adapters`);
  `app/jobs/loading.tsx` envolveria `/jobs/<id>`, `/jobs/<id>/paises` e
  `/jobs/new`.
- **Por que o status decide.** O primeiro chunk do fallback compromete a
  resposta em 200. Depois dele, `notFound()` vira 200 com `noindex` e
  `redirect()` vira redirecionamento no cliente. `/jobs/999999999` responder 404
  é contrato do E2E, então o detalhe não tem `loading.tsx`: autenticação e
  `notFound()` rodam antes, e só a nota por trilha e o histórico da candidatura
  vêm por `<Suspense>` (`job-track-fits-loading`,
  `application-timeline-loading`).
- **O que a lista troca.** Em `/jobs`, sessão vencida com cookie presente passa
  a redirecionar para `/login` pelo cliente, e não mais por 307. Sem cookie, o
  `proxy.ts` continua respondendo antes da página. `job:read` vale para os três
  papéis, então `forbidden()` não é caminho real aqui.
- **Troca de tela × mesma tela.** Rota dinâmica sem fronteira não tem o que
  pré-carregar. Com ela, o roteador busca o esqueleto com antecedência: o clique
  em Vagas, vindo de outra tela, mostra o esboço na hora, o overlay sai sobre
  ele (a URL confirma com o esboço) e a lista entra por streaming. Filtro, ordem
  e página **não** mostram o esboço: no Next 16 a fronteira é mantida pela chave
  de estado do segmento, que exclui a query (`createRouterCacheKey(segment,
  true)` em `layout-router`), e numa transição React não troca por fallback uma
  fronteira já revelada. A transição suave da #220 continua mostrando a lista
  anterior. O E2E `tests/e2e/jobs-loading.mjs` retém a resposta RSC por 2,5 s
  para provar as duas metades sem depender de corrida.
- **O que o esqueleto mostra.** Título real, `aria-busy` na região e um aviso
  `role="status"` do dicionário (`jobs.loading`, `jobDetail.loadingSection`).
  As barras são decorativas, só com `bg-muted`, e animam apenas com
  `motion-safe`. Nenhum dado entra no fallback: ele é igual para qualquer
  sessão e não pode exibir a tela de outra pessoa.
- **Ganho.** A fronteira muda o tempo até a primeira resposta visível na troca
  de tela, não o tempo total de `/jobs`, que continua dependendo de lista e
  facetas (com o cache da #216). No E2E, com a navegação retida por 2,5 s, o
  esboço aparece bem antes da resposta; sem a fronteira, a tela anterior ficava
  sob o overlay durante toda a espera. A medição em produção fica para depois
  do deploy, pela rodada com sessão de `perf:producao` (#221).

## Sentry e o que fica de fora

Tracing ligado pela #219, a 10% por padrão (`SENTRY_TRACES_SAMPLE_RATE`). Uma
transação carrega a URL com a query string, isto é, os filtros da pessoa, então
`beforeSendTransaction` e `beforeSendSpan` passam por `scrubTransaction` e
`scrubSpan`, com lista de permissão de atributos e um teste que reprova se um
marcador privado sobreviver. O que sai e o que não sai está em
[`deploy.md`](deploy.md#tracing).

Confirmado em 22/09/2026: a quota de spans do plano Developer é de fato
5.000.000 por ciclo (API `customers/master-timm`), sem gasto sob demanda; e o
`@sentry/node` 10.75 traz `postgresJsIntegration`, ligada automaticamente com
tracing — o SDK já troca literais por `?`, e a peneira reduz a consulta ao
verbo mesmo assim.

Ferramentas gratuitas avaliadas (limites consultados em 2026-09-21; confirme no
painel antes de depender de um número):

| Ferramenta | Veredito |
|---|---|
| `pg_stat_statements` + Supabase Reports | **Usar.** Consultas reais de produção, sem PII fora do Supabase. Reports guardam 24 h no Free |
| Vercel Observability e runtime logs | Usar o que há. Hobby: logs por 1 h, sem histórico |
| Sentry (já instalado) | Tracing depois, com a escrubagem acima |
| Better Stack (uptime) | Barato e sem PII, se quiser alarme externo |
| OpenTelemetry → Grafana Cloud ou Axiom | Só se o Sentry não bastar; conflita com o OTel do Sentry |
| Speed Insights, Web Analytics | Baixo valor para um usuário, e gravam a URL. Não habilitados no código |
| PostHog | Descartar: SDK de browser quebra a CSP `connect-src 'self'` e envia URL |
| SigNoz Cloud | Descartar: sem plano gratuito permanente |
| Upstash Redis (500 mil comandos/mês) | Só na condição da seção Decisões |

**Não confirmado:** `pg_trgm` e `unaccent` no Supabase de produção (consulta
de leitura em [Busca por termo indexada](#busca-por-termo-indexada--medição-de-22092026));
se "Query
Performance" existe no Free; o plano real da Vercel — o Hobby é restrito a uso
pessoal não comercial, e o repositório tem papel de recrutador.

## Armadilhas que já custaram caro

- **A régua medida por função aprova a tela que estoura.** O teto de conexões é
  por requisição; quem compõe leituras no corpo do Server Component escapa da
  régua. Ver `docs/operations.md`.
- **O número local é piso.** 77 ms no padrão contra um banco sem rede não diz
  nada sobre produção. O custo real é `estágios em série × RTT`.
- **Trocar a região sem trocar o teste.** Função em `iad1` com banco em
  `sa-east-1` não dá erro nenhum: só devolve 1 s a mais em silêncio.
  `tests/function-region.test.ts` existe por isso.
- **O overlay tem 28 referências no E2E** e cenários de QA vivos
  (`docs/qa/reports/2026-08-23-task-02-loading-transicoes.md`,
  `BUG-20260824-canonical-route-splash`). Mexer nele é trabalho de PR própria, com
  QA de jornada.
