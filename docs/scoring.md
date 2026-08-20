# Fit scoring

## Por que isto existe

O `jobs sync` traz milhares de vagas por rodada (hoje: **5021 linhas em `job`** e **5021 em `job_score`**; a igualdade não é garantida — `jobs sync --no-score` deixa as vagas novas pendentes até o próximo `jobs score`). Ler isso na mão é inviável, e mandar cada descrição para um LLM seria caro, lento e — o problema real — **irreprodutível**: a mesma vaga poderia ranquear diferente amanhã, e não haveria como escrever teste de regressão nem explicar por que a vaga #42 ficou na frente da #41.

O scorer é determinístico e puro por três motivos, escritos no cabeçalho de `src/core/scoring/score.ts`:

1. **Escala** — roda sobre milhares de postings a cada sync.
2. **Reprodutibilidade** — mesmo input + mesmo `profile.yaml` + mesmo `SCORER_VERSION` = mesmo output, sempre. É o que permite teste de regressão.
3. **Auditabilidade** — cada score carrega `reasons`, `blockers`, `matched_keywords` e `missing_keywords` persistidos. `pnpm jho jobs show <id>` reconstrói a decisão inteira.

> A intenção declarada no código: *"An LLM pass is worth adding later, but only on the top slice this scorer already surfaced."* O scorer é o filtro barato; o LLM (quando existir) é o refinamento caro sobre o topo.

Arquivos envolvidos:

| Arquivo | Papel |
| --- | --- |
| `src/core/scoring/score.ts` | Scorer **puro**, sem banco. `SCORER_VERSION`, `WEIGHTS`, `scoreJob()`. |
| `src/core/scoring/apply.ts` | `scoreAll({ all })` — seleciona, chama `scoreJob()`, faz upsert em `job_score`. |
| `profile/profile.yaml` | Todos os dados de entrada do scorer: clusters, keywords, blockers, faixas salariais, senioridade. |
| `src/core/profile/schema.ts` | `ProfileSchema` (Zod v4) — valida o YAML e faz `.toLowerCase()` em todo `term`. |

> **Invariante:** `score.ts` não importa nada de `db/`. A separação existe para o scorer ser testável sem banco (`apply.ts` é quem toca SQLite). Não coloque query dentro de `score.ts`.

---

## WEIGHTS

Verbatim de `src/core/scoring/score.ts`:

```ts
export const WEIGHTS = {
  title: 30,
  keyword: 27,
  seniority: 10,
  geo: 15,
  comp: 8,
  freshness: 6,
  benefits: 4,
} as const;
```

30 + 27 + 10 + 15 + 8 + 6 + 4 = **100**. Esse é o teto antes das penalidades. Depois:

```ts
const penalty = blockers.length * 12 + (keywords.negatives.length > 0 ? 5 : 0);
const rawTotal =
  title.score + keywords.score + seniority.score + geo.score + comp.score +
  freshnessScore + benefitScore;
const fit = Math.max(0, Math.min(100, rawTotal - penalty));
```

### Por que os pesos mudaram na 1.2.0

Cinco dos sete componentes respondem "esta vaga é a certa". Dois — `freshness` e
`benefits` — respondem outra pergunta: **"candidatar-se ainda serve para alguma
coisa?"**. Uma vaga aberta há seis semanas normalmente já tem shortlist, e um fit
de 80 nela vale menos que um fit de 70 numa vaga de ontem.

A 1.2.0 tirou 10 pontos dos componentes de fit (title 35→30, keyword 30→27,
seniority 12→10) para financiar os dois de conversão. `geo` e `comp` não foram
tocados: elegibilidade é eliminatória para este candidato, e remuneração já
estava subponderada.

Ambos os pesos novos são pequenos de propósito. Somados dão 10 pontos — o
suficiente para desempatar vagas próximas, insuficiente para uma vaga fraca e
nova passar na frente de uma forte. Frescor máximo compra 6 pontos; a diferença
entre `architect` e `senior_ic` no título compra 9.

**Efeito medido** ao repontuar as 6.239 vagas abertas:

| | 1.1.0 | 1.2.0 |
|---|---:|---:|
| fit ≥ 45 | 1.207 | **1.600** |
| fit ≥ 60 | 175 | **207** |
| fit ≥ 70 | 23 | 23 |
| Melhor fit | 85,9 | 84,0 |

> **Invariante:** os pesos somam 100 antes das penalidades. Se você mexer em `WEIGHTS`, mantenha a soma em 100 — todo o vocabulário do projeto (`--min-fit 45`, o corte verde/amarelo em 70/50 do `jobs list`, o `--min-fit` do `report`) assume uma escala 0–100.

Arredondamento: cada componente e o `fit` vão para 1 casa decimal (`Math.round(x * 10) / 10`), mas o `fit` é calculado **sobre os valores não arredondados**. Por isso as colunas do `jobs show` podem não somar exatamente o `fit` (ver o exemplo Paires adiante). `penalty` é gravado inteiro, sem arredondamento.

---

## Casamento por borda de palavra

Todo match textual passa por `containsTerm()`:

```ts
/** Word-boundary match so "go" does not fire on "google" or "category". */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i").test(haystack);
}
```

Detalhes que importam na hora de escrever um termo em `profile.yaml`:

- A classe de borda é `[^a-z0-9+#]`, **não** `\b`. `+` e `#` fazem parte de "palavra" de propósito — assim `c++` e `c#` funcionam como termos.
- `.` **não** está na classe de borda, então o termo `node` casa em `node.js`. Já `next.js` é um termo válido porque o `.` é escapado pelo `replace`.
- O texto já chega minúsculo via `normalize()` (lowercase, aspas curvas viram `'`, whitespace colapsado), e o Zod já fez `.toLowerCase()` no `term`. Caixa alta em `profile.yaml` é inofensiva.

> **Invariante:** nunca troque `containsTerm()` por `String.includes()`. Os termos curtos do perfil (`go`, `rag`, `llm`, `etl`, `aws`, `sap abap`) produziriam falso positivo em massa — `go` casaria com "google", "going", "category".

---

## Componente: title (máx. 30)

`scoreTitle(title, profile)` — o único componente que também decide o `cluster` gravado em `job_score.cluster`.

**Passo 1 — curto-circuito de `avoid_titles`.** Antes de qualquer coisa:

```ts
for (const avoid of profile.targets.avoid_titles) {
  if (containsTerm(t, avoid.toLowerCase())) {
    return { score: 0, cluster: "other", reason: `Title contains avoided term "${avoid}"` };
  }
}
```

Bateu um dos 12 `avoid_titles` (`Junior`, `Intern`, `Trainee`, `Graduate`, `Associate Software Engineer`, `Support Engineer`, `QA Analyst`, `Sales`, `Account Executive`, `Recruiter`, `Customer Success`, `Data Entry`) → **0 no título e cluster `other`**, sem nem olhar os clusters-alvo. Perde-se 35 pontos de teto, mas o resto continua sendo pontuado, então a vaga não some do banco.

**Passo 2 — melhor match entre todos os clusters × todos os títulos.** Para cada `target`, calcula-se um `raw` em faixas:

| Condição | `raw` |
| --- | --- |
| Título normalizado **igual** ao alvo (`t === needle`) | `1` |
| `containsTerm(t, needle)` — alvo aparece inteiro, com borda | `0.9` |
| **Todas** as palavras significativas do alvo (`length > 2`) aparecem no título | `0.75` |
| Falta **no máximo uma** palavra significativa (e o alvo tem > 1 palavra) | `0.45` |
| Nada disso | `0` |

E então:

```ts
const score = raw * cluster.weight * WEIGHTS.title;
```

Vence o **maior score**, não o maior `raw` — o `cluster.weight` participa da disputa. É por isso que `architect` (weight `1.0`) ganha de `senior_ic` (`0.6`) num empate de forma.

Pesos de cluster atuais em `profile.yaml`, e o teto de título que cada um permite:

| Cluster | `weight` | Teto de título (`weight × 30`) | `cv_variant` |
| --- | --- | --- | --- |
| `architect` | 1.0 | 30.0 | `architect` |
| `staff` | 0.95 | 28.5 | `staff` |
| `ai_lead` | 0.95 | 28.5 | `ai` |
| `eng_lead` | 0.85 | 25.5 | `lead` |
| `senior_ic` | 0.6 | 18.0 | `senior` |

Default quando nada casa: `{ score: 0, cluster: "other", reason: "Title does not match any target cluster" }`. No banco atual, `other` são 2491 das 5021 vagas — metade do corpus não é do target, e isso é esperado: os agregadores (`himalayas`, `remoteok`, `arbeitnow`) puxam board inteiro.

Distribuição real por cluster (`data/jobs.db`):

| cluster | vagas | fit médio | fit máx |
| --- | --- | --- | --- |
| `staff` | 143 | 43.3 | 69.6 |
| `ai_lead` | 1114 | 42.0 | **74.2** |
| `architect` | 236 | 40.1 | 66.3 |
| `eng_lead` | 1032 | 33.9 | 67.3 |
| `senior_ic` | 5 | 26.9 | 28.9 |
| `other` | 2491 | 20.0 | 35.3 |

> **Invariante:** `job_score.cluster` é derivado **exclusivamente** de `scoreTitle()`. Nada mais no scorer escreve cluster. Se o cluster de uma vaga parece errado, a correção é em `targets.clusters[*].titles` ou em `avoid_titles`, nunca em outro componente.

---

## Componente: keyword (máx. 27, pode ser reduzido pelos negativos)

`scoreKeywords(text, profile)` roda sobre `${title}\n${descriptionText ?? ""}` — título e corpo juntos.

**Pool positivo:** `keywords.critical` + `keywords.strong` + `keywords.stack`, concatenados sem distinção de grupo. Os grupos são organização humana; o scorer só olha `weight`.

Estado atual do perfil:

| Grupo | Termos | Soma dos pesos |
| --- | --- | --- |
| `critical` | 14 | 114 |
| `strong` | 23 | 106 |
| `stack` | 22 | 67 |
| **`positiveMax`** | **59** | **287** |

**A curva saturante — e por que ela existe.** Verbatim:

```ts
// Saturating curve: hitting 35% of the possible weight already scores well,
// otherwise long job descriptions would dominate purely by being verbose.
const ratio = positiveMax > 0 ? earned / positiveMax : 0;
const saturated = Math.min(1, ratio / 0.35);
const score = Math.max(0, saturated * WEIGHTS.keyword - negativeHit);
```

Sem a curva, o componente seria linear em `earned / positiveMax`, e ninguém jamais chegaria perto de 30: nenhuma vaga real cita 59 termos. Quem chegaria mais perto seria a **descrição mais longa** — a que enumera stack inteira, "nice to haves" e boilerplate jurídico. O sinal medido viraria verbosidade da vaga, não aderência ao perfil.

A curva corrige isso: **35% do peso possível já vale nota cheia**. Com o perfil atual, isso é `0.35 × 287 = 100.45` de peso acumulado — um posting que cite `ai architect`(10) + `agentic`(9) + `multi-agent`(9) + `llm`(8) + `rag`(8) + `distributed systems`(8) + `system design`(7) + `evals`(6) + `guardrails`(6) + `observability`(6) + `typescript`(5) + `python`(5) + `aws`(3) + `langgraph`(3) + `kubernetes`(3) + `docker`(2) = 98 já está praticamente saturado.

Na prática o corpus fica bem abaixo disso: o topo real (Paires) marcou `earned = 36`, ou seja `ratio = 0.125`, `saturated = 0.358`, **10.8 de 30**. O componente hoje separa bem justamente porque quase ninguém satura.

**Negativos.** `keywords.negative` (9 termos, pesos −3 a −6) não entram no `positiveMax`. Cada hit soma `Math.abs(weight)` em `negativeHit`, que é **subtraído do próprio componente**, com piso em 0. E, separadamente, a existência de qualquer negativo adiciona **5 fixos** à `penalty` global (5 fixos, não 5 por termo). Ou seja: um negativo é punido duas vezes, uma no componente e uma no total.

**`missing_keywords`.** Só registra ausências com `weight >= 7`:

```ts
} else if (k.weight >= 7) {
  // Only high-value absences are worth reporting.
  missing.push(k.term);
}
```

Com o perfil atual, `strong` tem peso máximo 6 e `stack` máximo 5 — então **`missing_keywords` é hoje um subconjunto de `critical`**. Se você promover um termo de `strong` para peso 7, ele passa a aparecer nos "Missing" do `jobs show`.

---

## Componente: seniority (máx. 10)

`scoreSeniority()` sobre o mesmo texto completo (título + corpo). É **inferência por regex**, não por campo estruturado — `job.seniority_raw` existe no schema mas não é lido pelo scorer.

```ts
// "8+ years", "5-7 years", "minimum of 10 years"
const match = t.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs)/);
```

Só o **primeiro** número da **primeira** ocorrência conta (`match[1]`). Em `5-7 years`, o valor lido é `5`, não `7` — a faixa inferior. Em `3+ years`, é `3`.

| Situação | Score | `reason` |
| --- | --- | --- |
| Sem match | `12 × 0.6 = 7.2` | `No explicit years requirement` |
| `years < reject_below_years` (3) | `0` | `Asks for only N years — under-levelled` |
| `years >= min_years_expected` (7) | `12` | `Asks for N+ years — matches seniority` |
| Entre os dois | `12 × (years / 7)` | `Asks for N years — below the 7+ target` |

O default de 7.2 para "não disse nada" é deliberadamente generoso: a maioria das vagas de arquitetura não numera anos, e zerá-las esconderia exatamente o alvo. Reflexo disso no corpus: a vaga de melhor fit (Paires, 74.2) não declara anos e leva os 7.2.

`seniority.years_experience: 20` no perfil **não é usado pelo scorer** — é dado para o agente de CV/cover letter.

---

## Componente: geo (máx. 15)

`scoreGeo(input, profile, eligibility)` desce uma escada de decisão sobre
`combined = normalize(locationRaw) + " " + normalize(descriptionText)`.
**A ordem importa e é a fonte da maioria das surpresas.**

Desde a 1.3.0 a escada começa pelo veredito de elegibilidade, que vem de
`evaluateEligibility(policy, signals)` e não de texto solto:

| # | Teste | Score | `reason` |
| --- | --- | ---: | --- |
| 1 | `eligibility.status === "ineligible"` | **0** | `geo.ineligible` |
| 2 | `eligibility.status === "eligible"` | **15,0** | `geo.eligible` |
| 3 | `/\b(us only\|usa only\|united states only\|uk only\|canada only\|eu only\|europe only\|emea only)\b/` | **0** | `geo.restricted` |
| 4 | `/\b(latam\|latin america\|south america\|brazil\|brasil\|americas)\b/` | **15,0** | `geo.latam` |
| 5 | `/\b(worldwide\|globally\|anywhere\|global remote\|any location\|fully remote)\b/` | **13,5** (`×0,9`) | `geo.worldwide` |
| 6 | Presencial declarado **e** `remote_only` | **0** | `geo.physical` |
| 7 | Sem sinal de remoto **e** `remote_only` | **7,5** (`×0,5`) | `geo.unknown` |
| 8 | fallback | **8,25** (`×0,55`) | `geo.remoteUnknown` |

"Sinal de remoto" é `input.remote === true` ou `/\bremote\b/` no `locationRaw`
**ou** no corpo.

**A restrição agora vem antes do "worldwide", e essa inversão foi uma
correção.** Na ordem anterior, um anúncio que dizia `fully remote` no primeiro
parágrafo e `US only` no oitavo ficava com 13,5 — a escada já tinha decidido
antes de chegar na parte que importa. Quem pegava esse caso era a lista de
`blockers`, tarde demais para o componente.

**O passo 4 ainda varre o corpo inteiro**, e isso é limitação conhecida:
qualquer menção a "Brazil" ou "Americas" em qualquer lugar da descrição
— inclusive "our São Paulo office" ou uma lista de escritórios — dá os 15
cheios.

### Elegibilidade tem três estados, não dois

`eligible`, `ineligible` e **`unverifiable`**. O terceiro é o que faltava: antes
existia só "passa" e "não passa", e o anúncio que simplesmente não diz nada
sobre visto caía no mesmo balde de quem diz "US only". São coisas diferentes —
um é impossível, o outro é desconhecido, e desconhecido merece ser visto e
verificado, não descartado em silêncio.

`ineligible` zera `geo` **e** entra em `blockers`, então soma penalidade também.
`unverifiable` devolve a decisão para a escada de heurísticas acima.

A política vem do `profile.yaml` via `MatchPolicy`, e agora usa o perfil
inteiro: `work_authorization`, `needs_visa_sponsorship_for`, `contract_models`,
`remote_only`, `acceptable_regions` e `max_timezone_offset_hours`. Até a 1.2.0
`scoreGeo()` lia apenas `remote_only` e os demais campos existiam sem consumidor.

---

## Componente: comp (máx. 8)

`scoreComp(input, profile, fx)` compara a oferta com as faixas do perfil. O que
este componente evita é uma armadilha específica: **um número sem moeda é
inutilizável**, porque não dá para distinguir 60 000 BRL de 60 000 USD, e
adivinhar é exatamente o defeito que a 1.1.0 removeu.

A escada de comparação, em ordem, e ela nunca inventa taxa:

1. Faixa declarada para a **mesma moeda e mesmo período** do anúncio;
2. Faixa daquela moeda em qualquer período, comparada em base anual;
3. Conversão para a moeda de referência, contra a faixa dela;
4. Sem taxa disponível → tratado como **não divulgado**, nunca como equivalente.

Sempre o **topo** da faixa (`compMax`, caindo para `compMin`), anualizado por
`annualize()` — 2080 h/ano para hora, ×12 para mês.

Notas por faixa, via `gradeAgainst()`:

| Situação | Score |
| --- | ---: |
| `valor >= ideal` | **8,0** |
| `valor >= target` | `8 × (0,85 + 0,15 × bonus)` → **6,8 a 8,0** |
| `valor >= floor` | `8 × (0,40 + 0,45 × fraction)` → **3,2 a 6,8** |
| Abaixo do floor | **0** |
| Não divulgado, sem moeda, ou sem taxa de câmbio | `8 × 0,5` = **4,0** |

`bonus = min(1, (valor − target) / span)`, com `span = (ideal ?? target × 1,4) − target`.
`fraction = (valor − floor) / (target − floor)`.

Os patamares são contínuos de propósito: 3,2 no piso, 6,8 no alvo, 8,0 no ideal.

**O 4,0 de "não divulgou" é intencional.** A maioria dos quadros não publica
faixa, e zerar puniria ausência de informação como se fosse faixa ruim. Nem
crédito nem punição.

**Zero não é um valor.** Vários agregadores emitem `0` em vez de `null` para
"não divulgado". Tratar isso como número real ou o colocaria abaixo do piso ou,
pior, lhe daria os 4,0 de consolação — os dois errados. `amount <= 0` cai
explicitamente no caso "não divulgado".

---

## Componente: freshness (máx. 6)

`scoreFreshness(input, asOf)` — em `src/core/scoring/freshness.ts`. O único
componente que não avalia a vaga: avalia se ainda vale agir sobre ela.

```
factor = 1                              se idade <= 1 dia
factor = 2 ^ (-(idade - 1) / 7)         se idade > 1 dia
factor = 0.5                            se a idade é desconhecida
```

Platô de 1 dia, depois meia-vida de 7. Valores da curva:

| Idade | 0d | 1d | 3d | 7d | 14d | 30d | 60d | *desconhecida* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `factor` | 1,00 | 1,00 | 0,82 | 0,55 | 0,28 | 0,06 | 0,00 | 0,50 |
| pontos | 6,0 | 6,0 | 4,9 | 3,3 | 1,7 | 0,3 | 0,0 | 3,0 |

**Era platô de 3 e meia-vida de 14, e o próprio diagnóstico do sistema derrubou
esses números.** O `jho stats` apontou o componente como peso morto: 92% de
utilização e 13% de variação, ou seja, quase toda vaga recebia quase todo o
ponto e o componente não reordenava nada. A causa é o acervo: metade dele tem de
0 a 3 dias e 99% está abaixo de duas semanas, então uma meia-vida de 14 gastava
toda a sua faixa em vagas que não existem aqui. Um dia também é a janela quente
honesta — candidatar-se hoje ou daqui a uma semana é diferença real na formação
da shortlist.

**Origem da data.** `postedAt` primeiro; na falta dele, `firstSeenAt`, que é um
**teto** da idade e não a idade real — a vaga pode ser mais velha que o dia em
que o sistema a viu. O `reason` diz qual foi usada ("primeiro visto; pode ser
mais antiga"), porque esconder isso transformaria um palpite em fato.

**Três decisões que parecem detalhe e não são:**

1. **Data ausente vale 0,5, não 0.** Vários boards nunca expõem data de
   publicação. Punir isso rebaixaria fontes inteiras por uma propriedade da API
   delas em vez de uma propriedade do emprego — exatamente o viés que o
   invariante de qualidade de fonte no `CLAUDE.md` existe para evitar.
2. **Data futura é clampada em idade 0, nunca premiada.** Data no futuro é bug
   de fuso na fonte. Sem o clamp, um offset errado compraria rank de graça.
3. **Data ilegível cai para `unknown`.** Sem exceção, sem parcial.

No acervo atual: 100% das vagas abertas têm `postedAt`, 3.091 dentro da janela
de 3 dias e 3.059 entre 4 e 14 dias — ou seja, o componente hoje discrimina
principalmente **dentro** das duas primeiras semanas, que é onde a decisão
realmente acontece.

---

## Componente: benefits (máx. 4)

`scoreBenefits(text, prefs)` — em `src/core/scoring/benefits.ts`. Duas funções
deliberadamente separadas:

- `detectBenefits(text)` → o que a vaga **menciona**. Propriedade da vaga, vale
  armazenar (`job_score.detected_benefits`).
- `scoreBenefits(text, prefs)` → o quanto isso **importa para este candidato**.
  Muda toda vez que o `profile.yaml` muda.

Vocabulário canônico de 14 benefícios com aliases, casados por substring sobre o
texto normalizado. As chaves batem com `compensation.benefits.*` do perfil.

```
factor = 0.5                                    texto < 400 chars (ilegível)
factor = 0.25                                   legível, nenhum benefício citado
factor = clamp(0.25, 1, 0.30·preferred + 0.12·nice)
```

### A regra que sustenta o componente: silêncio não é ausência

Uma vaga que não menciona plano de saúde quase certamente tem plano de saúde —
descrições públicas omitem a seção de benefícios o tempo todo. Tratar "não
mencionado" como "não oferecido" rebaixaria vagas boas por serem escritas de
forma enxuta, e castigaria mais forte justamente as fontes que truncam a
descrição.

Consequência direta: **vaga com menos de 400 caracteres pontua neutro e nunca
gera bloqueador**, mesmo que o candidato tenha marcado um benefício como
`required`. Só vaga legível pode ser dita "não oferece X".

### Armadilha de alias

`"office stipend"` é substring de `"home office stipend"` — usá-lo como alias de
`coworking` fazia toda vaga com auxílio home office ser detectada como coworking.
Alias precisa ser distintivo o bastante para não disparar dentro de outro. Há
teste cobrindo esse caso específico.

### O que o acervo mostra

| Benefício mais citado | Vagas |
|---|---:|
| `async_first` | 536 |
| `health_stipend` | 415 |
| `equity` | 391 |
| `paid_time_off` | 327 |

---

## Blockers: limitam, não zeram

```ts
function findBlockers(input: ScoreInput, profile: Profile): string[] {
  const haystack = normalize(`${input.title} ${input.locationRaw ?? ""} ${input.descriptionText ?? ""}`);
  const found: string[] = [];
  for (const b of profile.blockers) {
    try {
      if (new RegExp(b.pattern, "i").test(haystack)) found.push(b.reason);
    } catch {
      // A malformed pattern must not take down the whole scoring run.
      found.push(`(invalid blocker pattern: ${b.pattern})`);
    }
  }
  return [...new Set(found)];
}
```

Os 8 `blockers` do perfil hoje: US-only location, citizenship, security clearance, green card / permanent resident, local work authorization, no sponsorship, presença física (`on[- ]?site` / `in[- ]?office` / `hybrid \(\d`) e W2-only.

Cada blocker encontrado custa **12 pontos**, e o comentário no código explica a escolha:

```ts
// Blockers cap the score rather than zeroing it: a great role that says
// "US preferred" is still worth seeing, just not at the top of the list.
const penalty = blockers.length * 12 + (keywords.negatives.length > 0 ? 5 : 0);
```

Por que limitar em vez de zerar é a decisão certa aqui:

- Os patterns são regex sobre texto livre. Falso positivo é inevitável — "no sponsorship" pode aparecer numa seção de FAQ que não se aplica ao cargo, e `on[- ]?site` casa com qualquer menção a "on-site" no meio da descrição. Zerar transformaria cada falso positivo numa vaga **invisível**, sem sinal de que existiu.
- Blocker frequentemente é negociável. Um posting "US preferred" com contrato B2B é exatamente o tipo de conversa que vale ter.
- Com o cap, a vaga continua no banco, continua no `jobs list` se passar do `--min-fit`, e o `jobs show` imprime `Blockers: <reason>` em vermelho. A informação é apresentada, não descartada.

Efeito real no corpus (5021 vagas):

| `penalty` | vagas | leitura |
| --- | --- | --- |
| 0 | 4790 | limpo |
| 5 | 13 | só keyword negativa |
| 12 | 19 | 1 blocker |
| 17 | 1 | 1 blocker + negativa |
| 24 | 1 | 2 blockers |

Exemplo de cada:

- Job `136`, `Senior Data Engineer` — `penalty = 5`, `blockers = []`. Componentes somam 62.4 → fit **57.4**. Uma keyword negativa custou 5 e mesmo assim a vaga fica acima do `--min-fit 45`.
- Job `73`, `Tech Lead Full-Stack Rails Engineer` — blocker `Requires physical presence`. Componentes somam 55.5 → fit **43.4**. O blocker a empurrou para baixo do corte padrão de 45, mas ela continua no banco e reaparece com `--min-fit 40`.

> **Invariante:** blocker é penalidade, não filtro. Nenhum ponto do pipeline deleta ou esconde vaga por causa de blocker; ela é preservada com `blockers` populado, e o `jobs show` mostra o motivo. Se algum dia um blocker precisar ser eliminatório de verdade, faça isso numa camada de apresentação (uma flag do `jobs list`), nunca dentro do scorer.

> **Invariante:** um `pattern` malformado nunca derruba a run — o `catch` transforma em `(invalid blocker pattern: <pattern>)`, que aparece na lista de blockers e ainda cobra os 12 pontos. Se você vir essa string no `jobs show`, o regex do `profile.yaml` está quebrado; conserte o YAML, não o scorer.

---

## Exemplo completo: Autodesk, fit 85.6

Vaga real do acervo (`job 8613`), pontuada pela 1.3.0. Os números saíram do
banco, não de aritmética à mão — o exemplo anterior deste documento ficou preso
nos pesos da 1.1.0 (title 35, keyword 30, seniority 12) e passou duas versões
descrevendo uma escala que já não existia.

| Campo | Valor |
| --- | --- |
| `title` | Software Architect |
| `company` | Autodesk |
| `cluster` | `architect` |

Decomposição:

| Componente | Score | Máx | Como chegou lá |
| --- | ---: | ---: | --- |
| `title_score` | **30,0** | 30 | `"software architect"` casa exato com um título do cluster `architect` (peso 1,0) |
| `keyword_score` | **21,2** | 27 | 14 matches, entre eles `agentic` `llm` `rag` `langgraph` `observability` `event-driven` |
| `seniority_score` | **10,0** | 10 | Regex achou 10 anos, ≥ `min_years_expected` |
| `geo_score` | **13,5** | 15 | Texto diz remoto global sem citar LATAM → `15 × 0,9` |
| `comp_score` | **4,0** | 8 | Faixa não divulgada → metade do peso, nem crédito nem punição |
| `freshness_score` | **5,7** | 6 | 2 dias de idade → `2^(-1/7) × 6` |
| `benefit_score` | **1,2** | 4 | Só `equity` reconhecido no texto |
| `penalty` | **0** | — | Sem blockers e sem keyword negativa |
| **`fit`** | **85,6** | 100 | |

Soma: `30 + 21,2 + 10 + 13,5 + 4 + 5,7 + 1,2 = 85,6`.

`reasons` persistidos — repare que são **códigos com parâmetros**, não frases:

```json
[{"code":"title.match","params":{"target":"Software Architect","cluster":"architect"}},
 {"code":"keywords.matched","params":{"count":14}},
 {"code":"seniority.match","params":{"years":10}},
 {"code":"geo.worldwide"},
 {"code":"comp.undisclosed"},
 {"code":"freshness.aged","params":{"days":2}},
 {"code":"benefits.offers","params":{"benefits":"equity"}}]
```

A UI e o CLI traduzem no momento de exibir. Antes a frase era gravada pronta em
português, e o efeito é que trocar o idioma da interface não mudava a explicação
do score — o banco guardava a decisão **e** o idioma de quem a escreveu.

## Que algoritmo é este, afinal

**Não é similaridade de cosseno, não há embedding e não há vetor em lugar
nenhum.** Também não há LLM no caminho do score. Quem procurar por
`cosine`, `embedding` ou `tf-idf` no código só encontra entradas do catálogo de
skills — "Embeddings" e "Vector databases" são tecnologias que o sistema
procura *dentro do anúncio*, não como ele pontua.

O que existe é uma **rubrica ponderada com casamento léxico**: sete componentes
independentes, cada um com teto fixo, somados e depois reduzidos por
penalidades. Nenhuma etapa é aprendida; todo peso foi escolhido à mão e está
versionado em `SCORER_VERSION`.

| | Rubrica ponderada (o que usamos) | Cosseno sobre embeddings |
|---|---|---|
| Explicabilidade | Cada ponto tem origem nomeada | "0,83 de similaridade" |
| Reprodutibilidade | Mesmo input → mesmo output, sempre | Depende do modelo e da versão dele |
| Custo por vaga | Microssegundos, offline | Chamada de API ou modelo local |
| Ajuste | Editar um peso no YAML | Reindexar tudo |
| Regra eliminatória | Natural (blocker zera) | Não existe; tudo vira "meio parecido" |

A última linha é a decisiva para este caso de uso. Este candidato **não tem
autorização de trabalho nos EUA**, e isso não é uma preferência a ser
ponderada: é eliminatório. Um cosseno diria que uma vaga "W2, on-site em
Austin" tem 0,91 de similaridade com o currículo — e estaria certo, porque o
texto realmente se parece. Similaridade não sabe a diferença entre "combina" e
"é possível".

Há também uma razão de escala e uma de confiança. São milhares de anúncios
repontuados a cada mudança de perfil, e a pergunta que se faz de um quadro de
vagas não é "qual a nota?" — é **"por que esta ficou acima daquela?"**. Uma
rubrica responde com aritmética conferível; um vetor responde com um número.

Onde um LLM caberia, e está anotado no código: um passe sobre as ~50 do topo,
depois do corte determinístico, para ler nuance que regex não lê. Não sobre as
6.000, e não como substituto do que fecha a porta.

**As técnicas que de fato estão aqui**, todas clássicas e todas deliberadas:

- **Casamento por borda de palavra** (regex com fronteira), para `go` não
  disparar em `google`;
- **Curva saturante** na keyword — 35% do peso possível já pontua quase cheio,
  senão anúncio prolixo ganharia por ser comprido;
- **Decaimento exponencial** no frescor, com platô e meia-vida;
- **Interpolação linear por faixa** na remuneração (piso → alvo → ideal);
- **Portão de elegibilidade** separado da nota, com três estados.

---

## Versão 1.3.0 — contexto explícito e elegibilidade estruturada

Três mudanças, todas sobre a mesma questão: tornar explícito o que estava
implícito.

**`ScoringContext` fixa o tempo.** `scoreJob` recebe `{ profile, fx, asOf }`.
Antes o frescor chamava `Date.now()` lá dentro, e o efeito é que repontuar o
mesmo acervo duas vezes dava resultados diferentes — não por mudança de dado,
mas porque o relógio andou. Com `asOf` fixo por execução, a reprodutibilidade
que o topo deste documento promete passa a ser verdade também para o componente
que depende de tempo.

**`MatchPolicy` e elegibilidade com três estados.** A política sai do
`profile.yaml` (autorização de trabalho, modelos de contrato, regiões aceitas,
fuso máximo) e o veredito é `eligible`, `ineligible` ou `unverifiable`. O
terceiro estado é o que importa: antes só havia "passa" e "não passa", e o
anúncio que simplesmente não diz nada sobre visto caía no mesmo balde de quem
diz "US only". São coisas diferentes — um é impossível, o outro é desconhecido,
e desconhecido merece ser visto e verificado, não descartado.

`ineligible` zera `geo` **e** vira blocker. `unverifiable` deixa a escada de
heurísticas de `scoreGeo` decidir.

**`reasons` e `blockers` viram códigos.** `{ code, params }` em vez de frase
pronta, traduzidos na hora de exibir. Ver o exemplo acima.

## Como ajustar

### Mapa: quero X → edito Y

| Quero… | Edito em `profile.yaml` | Efeito |
| --- | --- | --- |
| Que um tipo de cargo suba no ranking | `targets.clusters.<cluster>.titles` — acrescente a variação exata do título | Move `raw` de 0.45/0.75 para 0.9/1.0. Maior alavanca isolada do scorer (até 35 pts). |
| Rebalancear entre clusters | `targets.clusters.<cluster>.weight` (0–1, validado pelo Zod) | Multiplica o teto de título daquele cluster. Baixar `eng_lead` de 0.85 para 0.7 derruba 1005 vagas em vários pontos cada. |
| Sumir com uma categoria de ruído | `targets.avoid_titles` | Curto-circuito: título vira 0 e cluster vira `other`. Cuidado: casa por `containsTerm`, então `Sales` também zera "Sales Engineer". |
| Que um tema técnico pese mais | `keywords.critical` (7–10) em vez de `strong` (3–6) | Aumenta o `earned` e, se `weight >= 7`, o termo passa a aparecer em `missing_keywords`. |
| Que a saturação de keywords fique mais fácil/difícil | **Não há chave no YAML** — o `0.35` está hardcoded em `scoreKeywords()` | Baixar para 0.25 comprime a distribuição no topo; subir para 0.5 espalha. Mexer aqui exige bump de `SCORER_VERSION`. |
| Punir mais um tipo de vaga off-axis | `keywords.negative` (peso negativo) | Subtrai do componente keyword **e** adiciona os 5 fixos da penalidade global. |
| Ser mais/menos tolerante com vagas juniorizadas | `seniority.reject_below_years` (hoje 3) e `seniority.min_years_expected` (hoje 7) | `reject_below_years` zera o componente; `min_years_expected` é o denominador da fração. |
| Mudar a régua salarial | `compensation.floor` (90000) e `compensation.target` (150000) | São comparados contra o **valor anualizado em número puro, sem conversão de moeda**. |
| Endurecer/afrouxar exigência de remoto | `constraints.remote_only` | Único campo de `constraints` que o scorer lê. `false` faz o passo 3 da escada geo parar de zerar. |
| Descartar mais agressivamente | `blockers[]` — novo `{ pattern, reason }` | −12 pts por blocker. Teste o regex antes: ele roda com flag `"i"` sobre título + location + descrição já normalizados (minúsculos). |

Coisas que **não** são ajustáveis pelo YAML e exigem mudar `score.ts`: os `WEIGHTS`, o `0.35` da saturação, o `2080` do fator hora, o `0.6` do default de senioridade, os `0.9`/`0.55` da escada geo, o `12` por blocker e o `5` fixo dos negativos.

### O ciclo obrigatório depois de qualquer ajuste

> **Invariante:** mexeu em `profile.yaml` ou em `src/core/scoring/score.ts`? **Bump `SCORER_VERSION`** e rode o rescore. (Regra 5 do `CLAUDE.md`.)

```bash
# 1. valida o YAML e mostra os targets resolvidos (não abre o banco)
pnpm jho profile

# 2. edite SCORER_VERSION em src/core/scoring/score.ts
#    export const SCORER_VERSION = "1.0.0";  ->  "1.1.0"

# 3. repontue TODO job aberto
pnpm jho jobs score --all

# 4. confira o efeito
pnpm jho jobs list --min-fit 60
pnpm jho jobs show 42
```

Por que o bump não é opcional — a query de seleção em `apply.ts`:

```ts
opts.all
  ? isNull(job.closedAt)
  : sql`${job.closedAt} is null and (${jobScore.jobId} is null or ${jobScore.scorerVersion} <> ${SCORER_VERSION})`
```

Sem `--all`, `scoreAll()` só toca em jobs **sem score** ou com `scorer_version` **diferente** do atual. Se você editar o `profile.yaml` e não bumpar, o próximo `jobs sync` vai pontuar só as vagas novas com as regras novas e deixar as 5021 antigas com as regras velhas — **duas gerações de score misturadas na mesma coluna `fit`, ordenadas juntas, sem nenhum sinal visível de que isso aconteceu**. O `scorer_version` é justamente o mecanismo que torna essa mistura detectável.

Notas de execução:

- **Nem `--all` toca vaga fechada.** Os dois ramos da query filtram `job.closedAt is null`. Uma vaga fechada mantém o score que tinha quando ainda estava aberta — hoje são 24 linhas nessa condição. Consequência prática: `count(*) from job_score` pode divergir de `count(*) from job` nas duas direções — para menos, quando há vagas novas ainda não pontuadas; e com scores obsoletos, para as já fechadas.
- `scoreAll()` chama `loadProfile(true)` — força releitura do YAML, ignorando o cache de módulo. Não é preciso reiniciar nada entre edições.
- Após um rescore, `job_score` continua com uma linha por job (`onConflictDoUpdate` em `job_id`). Score é derivado e descartável: `job_score` pode ser truncada e reconstruída a qualquer momento a partir de `job` + `profile.yaml`.
- `skipped` no retorno de `scoreAll()` é **sempre 0** hoje; não é métrica útil.
- O cabeçalho de `score.ts` menciona `jobs score --rescore`, mas a flag implementada em `src/cli.ts` é **`--all`**. O comentário está desatualizado; a flag é `--all`.

> **Invariante:** `SCORER_VERSION` é um identificador de compatibilidade de score, não um número de release do projeto. Ele muda quando o **output do scorer** muda para o mesmo input. Refatorar `score.ts` sem alterar resultado não pede bump; mudar um peso no `profile.yaml` pede.

### Use o banco como laboratório antes de commitar

`data/jobs.db` tem 5021 vagas já pontuadas. É barato medir o efeito de uma mudança antes de fechá-la:

```bash
sqlite3 data/jobs.db "select cluster, count(*), round(avg(fit),1), max(fit) from job_score group by 1 order by 3 desc;"
sqlite3 data/jobs.db "select count(*) from job_score where fit >= 45;"
```

Se um ajuste mover a contagem acima de 45 de ~325 para 2000, ele não tornou o scorer melhor — tornou-o inútil como filtro.


## Versão 1.1.0 — remuneração com moeda

A 1.0.0 comparava um número cru contra um piso em USD enquanto `comp_currency`
ficava na linha sem ser lido. O corpus tem vagas em CAD, AUD, MXN e PHP, então
uma vaga de PHP 150.000/ano — cerca de USD 2.400 — era pesada como se passasse
de um piso de USD 90.000.

Havia um segundo defeito no mesmo componente: os períodos não eram normalizados.
Cinco grafias chegam de cinco APIs — `annual`, `1 YEAR`, `year`, `hourly`,
`monthly` — e só `"hour"` e `"month"` eram reconhecidas. Então `hourly` caía no
ramo anual e **USD 100/hora virava USD 100/ano**, descartado por estar abaixo do
piso. Contrato por hora é justamente o modelo B2B que este candidato busca.

E um terceiro, achado ao corrigir os dois: vários agregadores emitem `0` em vez
de `null` para "não divulgado", e o zero estava sendo tratado como valor real.

### Faixas por moeda

```yaml
compensation:
  reference_currency: USD
  ranges:
    - { currency: USD, period: year,  floor: 90000, target: 150000, ideal: 220000 }
    - { currency: USD, period: hour,  floor: 55,    target: 85,     ideal: 120 }
    - { currency: BRL, period: month, floor: 40000, target: 60000,  ideal: 85000 }
```

> **Invariante de domínio:** a faixa em BRL **não é a conversão** da faixa em
> USD. Contrato em BRL carrega risco cambial e tributação diferentes, e o prêmio
> exigido em cada moeda é decisão de negócio, não aritmética. A conversão é o
> *fallback* para moeda sem faixa declarada, nunca a regra.

Ordem de comparação: faixa exata para `(moeda, período)` → mesma moeda em outro
período, anualizada → conversão para a moeda de referência → **recusa a
comparar** em vez de adivinhar quando não há taxa.

### Projeto de preço fechado

`period: project` é estruturalmente diferente: o valor é o negócio inteiro, não
uma taxa. USD 30k em 2 meses é um ritmo de 180k/ano; os mesmos 30k em 12 meses
ficam abaixo do piso.

Por isso `annualize()` de um projeto **sem duração retorna null** em vez de
inventar prazo — um palpite errado inverte o veredito.

### Câmbio

[Frankfurter](https://frankfurter.dev), taxas de referência do BCE, sem chave.
Fallback `open.er-api.com`. Cacheadas em `fx_rate` pela data da cotação, para
que o scorer permaneça puro e um score continue reproduzível a partir da taxa
que o gerou.

Rode `jho fx refresh` antes de pontuar. Sem cotações, vagas em outras moedas não
são comparadas — e o scorer **diz isso** em vez de silenciosamente tratá-las
como dólar.

