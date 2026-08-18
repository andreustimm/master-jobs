## 3. O que já existe e faz melhor que nós

### 3.1 career-ops: nossa camada de coleta é um subconjunto estrito da dele

Esta é a conclusão desconfortável do benchmark, e ela precisa ser dita sem
rodeios.

O [career-ops](https://github.com/santifer/career-ops) tem **75 providers de
vagas documentados** em [docs/SUPPORTED_JOB_BOARDS.md](https://github.com/santifer/career-ops/blob/main/docs/SUPPORTED_JOB_BOARDS.md).
Entre eles estão **todas as nossas 12 fontes, sem exceção**:

| Nossa fonte | career-ops tem? |
|---|---|
| Greenhouse | Sim |
| Lever | Sim |
| Ashby | Sim |
| SmartRecruiters | Sim |
| Recruitee | Sim |
| Himalayas | Sim |
| Remotive | Sim |
| Arbeitnow | Sim |
| RemoteOK | Sim |
| Adzuna | (não listado) |

**Não existe uma única fonte nossa que ele não tenha** — com a exceção parcial do
Adzuna. E ele ainda cobre ~66 outras que nós não temos: Workday, Oracle
Recruiting Cloud, SAP SuccessFactors, iCIMS, Phenom People, Eightfold, BambooHR,
Personio, Workable, Teamtailor, Rippling, Pinpoint, Gem, Jobvite, Breezy,
Comeet, join.com, Welcome to the Jungle, We Work Remotely, Working Nomads,
NoDesk, Jobspresso, Jobicy, Get on Board, Landing.jobs, getManfred, JustJoin.it,
No Fluff Jobs, EchoJobs, 4 Day Week, a16z speedrun talent network, e o
**Hacker News "Who is hiring?" via API do Algolia**.

Pior: ele adota **exatamente a mesma tese arquitetural que nós** — API pública,
zero-auth, sem scraping quando possível. A descrição de cada provider diz o
protocolo (API / RSS / parser) e o endpoint. Não estamos numa vertente diferente;
estamos na mesma vertente, mais atrás.

Ele também já resolve coisas que estão no nosso backlog:
- **Detecção de ghost job e repost** (`detect-reposts.mjs`, Block G do rubric)
- **Sinal de work-auth** que marca JD com "no sponsorship" como bloqueador
- **Taxa de avanço por canal de ATS** (`analyze-patterns.mjs`) — exatamente a
  métrica que diz onde vale investir esforço

E tem 65.306 estrelas, 12.692 forks, commits diários e cobertura de imprensa
([Business Insider](https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4)).

### 3.2 JobSpy: cobre os boards de volume que nós nunca vamos cobrir

[JobSpy](https://github.com/speedyapply/JobSpy) (4.107 estrelas, MIT, push em
2026-02-18) raspa **LinkedIn, Indeed, Glassdoor, Google Jobs e ZipRecruiter** —
justamente as fontes que não expõem API pública e que nós, por decisão de
arquitetura, não tocamos.

Onde ele é honestamente melhor: se o objetivo é volume bruto de vagas nos EUA,
`scrape_jobs(site_name=["indeed","linkedin","google"], ...)` entrega em uma
chamada mais vagas americanas do que nossos 12 adapters somados.

Onde ele quebra — e isto é operacional, não teórico, está nas issues abertas do
próprio repositório:
- [#302 Google Jobs e ZipRecruiter retornando 0 resultados / 403](https://github.com/speedyapply/JobSpy/issues/302)
- [#283 ZipRecruiter: 429, bloqueado por excesso de requests](https://github.com/speedyapply/JobSpy/issues/283)
- [#270 Glassdoor 403](https://github.com/speedyapply/JobSpy/issues/270)

O próprio README recomenda proxies. Uma [análise independente](https://jobspipe.dev/blog/jobspy-review)
resume: além de volumes de brinquedo, é preciso comprar proxies residenciais
rotativos e gerenciar 429, porque o LinkedIn limita scraping não autenticado
depois de algumas centenas de resultados.

**Veredito honesto:** JobSpy resolve a coleta em boards de consumo melhor do que
nós — e nós não deveríamos tentar competir ali. Deveríamos considerar usá-lo como
mais um adapter, aceitando o custo de proxy, ou aceitar conscientemente que essas
fontes ficam de fora.

### 3.3 Ferramentas comerciais que já fazem o funil

Teal, Huntr e Simplify já entregam tracking + match score prontos, com extensão de
browser e autofill de formulário — coisas que não temos.
[Comparativos de 2026](https://offboard.co/resources/best-job-application-trackers-2026)
colocam Teal a US$ 29/30 dias e Huntr a US$ 40/mês, ambos com camada gratuita
utilizável. O autofill do Simplify preenche formulários na maioria dos ATS
principais — economia real de tempo que nosso CLI não oferece.

### 3.4 O espelho: o que os números da nossa própria base dizem

Antes de reivindicar qualquer vantagem, vale olhar o que temos de fato. Consultas
diretas em `data/jobs.db` (18/08/2026):

**Distribuição real das 5.021 vagas por fonte:**

| Fonte | Vagas | % |
|---|---:|---:|
| Lever | 4.639 | 92,4% |
| Arbeitnow | 173 | 3,4% |
| RemoteOK | 104 | 2,1% |
| Himalayas | 40 | 0,8% |
| Ashby | 37 | 0,7% |
| Remotive | 17 | 0,3% |
| Greenhouse | 11 | 0,2% |

"5.021 vagas de 12 fontes" é tecnicamente verdade e praticamente enganoso: são
**12 instâncias de fonte configuradas**, não 12 provedores com volume. Na prática
é *um* provedor (Lever) mais ruído. SmartRecruiters, Recruitee e Adzuna têm
adapter escrito mas **nenhuma fonte ingerida**.

**Distribuição do fit score:**

| Faixa | Vagas |
|---|---:|
| ≥ 80 | **0** |
| 70–79 | **1** |
| 60–69 | 16 |
| 50–59 | 136 |
| < 50 | 4.868 |

De 5.021 vagas coletadas, **uma única** passa de 70. Isso não é um sistema de
sourcing funcionando — é um funil que gasta coleta para produzir quase nada. Ou o
scorer está calibrado com rigor irreal, ou o corpus (92% Lever, genérico) é a
piscina errada para o perfil-alvo. As duas leituras levam à mesma conclusão: **o
problema não é falta de vagas coletadas.**

**Fontes subutilizadas (verificado ao vivo em 18/08/2026):**

| API | Status | Volume disponível | Nós ingerimos |
|---|---|---:|---:|
| Himalayas | HTTP 200 | **101.022** vagas (paginação por offset funciona até 5.000+) | 40 |
| Get on Board (LATAM) | HTTP 200 | 150 páginas | 0 |
| Jobicy | HTTP 200 | feed aberto | 0 |
| We Work Remotely (RSS) | HTTP 200 | feed aberto | 0 |
| HN "Who is hiring" (Algolia) | HTTP 200 | ~60k anúncios históricos | 0 |
| Remotive | HTTP 200 | **`total-job-count: 17`** — praticamente esgotada | 17 |

O Himalayas sozinho expõe **101.022 vagas** e nós puxamos 40. O gargalo de
coleta não é falta de fonte; é paginação não implementada.

---

## 4. A lacuna que sobra

Depois de tirar da mesa tudo que já existe, sobram três lacunas reais. Só a
primeira é defensável a longo prazo.

### 4.1 Scoring determinístico em escala — a única vantagem técnica real

O career-ops pontua com **LLM guiado por rubrica** ("rubric-guided LLM evaluation
across five dimensions", conforme o [site oficial](https://career-ops.org/)). Isso
tem três consequências que ele não consegue evitar:

1. **Custo marginal por vaga.** O próprio README celebra "740+ job listings
   evaluated" ao longo de uma busca inteira. Nós pontuamos **5.021 em um único
   run, com custo marginal zero**. Em 101 mil vagas do Himalayas, a diferença
   deixa de ser de grau e vira de categoria.
2. **Não é reprodutível.** Rodar a mesma vaga duas vezes pode dar notas
   diferentes. Nosso scorer tem `SCORER_VERSION` versionado — quando os pesos
   mudam, sabemos quais notas ficaram velhas e por quê. Nota de LLM não é
   auditável nem diffável.
3. **Não dá para explicar a nota como função dos pesos.** Nossa nota decompõe em
   `title_score`, `keyword_score`, `seniority_score`, `geo_score`, `comp_score`
   e `penalty`, com pesos que somam 100. É uma explicação, não uma justificativa
   gerada depois do fato.

O uso correto dos dois não é escolher: é **determinístico para triagem de massa,
LLM para os 20 finalistas**. Essa é a arquitetura certa, e nenhum dos dois
projetos a implementa hoje.

### 4.2 Compensação com consciência de moeda — ninguém mais faz direito

Nosso `scoreComp` trata moeda, período (hora/mês/ano/**projeto**), duração de
contrato e conversão FX, e **se recusa a comparar um número sem moeda declarada**.
O comentário no código registra o bug que isso corrigiu: antes da v1.1.0, uma vaga
cotada em MXN ou PHP era pesada como se fosse dólar, e "USD 100/hour" virava
"USD 100/ano".

Nenhuma ferramenta pesquisada modela isso. Para quem compara uma proposta em BRL
com uma em USD/hora e uma terceira por projeto fechado, essa é a diferença entre
uma decisão informada e um chute.

### 4.3 O contractor B2B internacional não é cidadão de primeira classe em lugar nenhum

Todas as ferramentas — open source e comerciais — são construídas em torno de
**emprego** (CLT, W2, FTE). Nenhuma modela:

- rate horário versus salário anual como grandezas comparáveis;
- duração de contrato e risco de renovação;
- PJ/invoice, moeda de recebimento, quem é o EOR;
- a diferença entre "remoto" e "remoto e podemos pagar um PJ no Brasil".

O career-ops tem um sinal de work-auth, mas ele é **binário e defensivo** (marca
JD que diz "no sponsorship"). Não é a mesma coisa que modelar positivamente um
contractor que *não quer* visto, quer contrato B2B, e para quem "US only" é
eliminatório enquanto "LATAM friendly" é o sinal mais valioso da vaga.

Essa é a lacuna genuína. Mas é preciso ser honesto sobre o tamanho dela: é uma
**diferença de configuração e de modelo de dados, não de tecnologia**. O
career-ops diz explicitamente que o sistema foi feito para ser customizado pelo
próprio CLI do usuário — "modes, archetypes, scoring weights, just ask it to
change them". Alguém suficientemente motivado replica nosso modelo geográfico lá
dentro num fim de semana. O que não se replica num fim de semana é o scorer
determinístico com FX e o modelo relacional do funil.

### 4.4 O que NÃO é lacuna (e que talvez a gente ache que é)

- **Rodar local e privado.** career-ops, job-ops, jobsync e JobNavigator já rodam
  local. Não é diferencial.
- **Ser CLI, sem UI.** career-ops roda dentro do Claude Code/Codex/OpenCode. Não
  é diferencial.
- **Usar API pública em vez de scraping.** Mesma tese, ele com 75 providers.
- **Cobertura de ATS.** Somos subconjunto estrito.

---

## 5. Avaliação como profissional de R&S: quais canais realmente geram entrevista

Tiro o chapéu de engenheiro e coloco o de quem passou 20 anos colocando gente
sênior em vaga. A pergunta não é "onde tem mais vaga", é "onde a minha
candidatura vira conversa".

### 5.1 A matemática que decide tudo

Os números de mercado são consistentes e desfavoráveis ao caminho que estamos
otimizando:

- Job boards produzem **61% das candidaturas e apenas 42% das contratações**;
  referrals são **7% dos candidatos e 40% das contratações**
  ([StaffingHub, 2026](https://staffinghub.com/hiring/company-pages-referrals-result-in-more-hires-recruiting-metrics-report/)).
- Candidatos indicados são contratados a uma taxa de **30%, contra ~7%** dos
  demais canais — vantagem de 4,3x
  ([Pin, 2026](https://www.pin.com/blog/employee-referral-programs/)).
- **75% dos devs sêniores não estão procurando emprego ativamente**, razão pela
  qual sourcing de sênior em 2026 exige sair do job board
  ([daily.dev Recruiter](https://recruiter.daily.dev/resources/where-to-source-senior-software-engineers/)).
- Entre **18% e 27%** dos anúncios online são ghost jobs — a Greenhouse mediu
  18–22%; a ResumeUp.AI achou 27,4% no LinkedIn; uma pesquisa da ResumeBuilder com
  recrutadores chegou a 40%
  ([Entrepreneur](https://www.entrepreneur.com/business-news/one-quarter-of-jobs-posted-online-are-fake-ghost-jobs-study/496683)).

Traduzindo para a nossa base: das 5.021 vagas, algo entre 900 e 1.350 provavelmente
não existem. E o funil já entregava **uma** vaga acima de 70.

### 5.2 O fator que ninguém no benchmark modela: o problema do candidato fantasma

Este é o ponto que mais afeta um contractor brasileiro e que não aparece em
nenhuma ferramenta. Um relato de quem contrata, no Hacker News:

> "Para vagas remotas de engenharia, as empresas recebem centenas de candidatos
> excelentes que são todos falsos (claramente não estão nos EUA) assim que você
> os coloca numa call de triagem."
> — [Hacker News](https://news.ycombinator.com/item?id=36863280)

O efeito prático é cruel: a fraude de localização em massa fez as empresas
americanas endurecerem a exigência de work authorization **como filtro
anti-fraude**, não como preferência. Um arquiteto brasileiro legítimo,
candidatando-se por formulário de ATS, é indistinguível do ruído — e é eliminado
pelo mesmo filtro.

**Consequência estratégica:** para este perfil, candidatura fria em ATS tem taxa
de conversão estruturalmente próxima de zero, por mais bem ranqueada que a vaga
esteja. Nenhuma melhoria no scorer conserta isso. É um problema de **canal**, não
de **ranqueamento**.

### 5.3 Ranking dos canais para este perfil específico

Arquiteto de IA sênior, 20+ anos, no Brasil, B2B, sem autorização de trabalho nos
EUA, mirando Architect/Staff/AI-Lead:

**Camada 1 — os que realmente geram entrevista**

1. **Rede pessoal e referral direto.** 4,3x de vantagem de conversão, e é o único
   canal onde "está no Brasil" vira contexto em vez de flag. Para Staff+, é como a
   maioria dessas vagas é preenchida — elas frequentemente nem chegam a ser
   publicadas.
2. **Inbound de recruiter via reputação pública.** Palestra, artigo técnico, OSS,
   presença no nicho de IA. Inverte a assimetria: quem procura você já sabe onde
   você mora e decidiu que tudo bem.
3. **Hacker News "Who is hiring?" e comunidades de nicho.** Anúncio escrito pelo
   próprio time de engenharia, com contato direto, frequentemente explícito sobre
   remoto global. Elimina o ATS e o filtro anti-fraude. **É a fonte com melhor
   razão sinal/ruído para este perfil — e é exatamente a que não temos.**

**Camada 2 — vale manter, com expectativa calibrada**

4. **Empresas remote-first que publicam política de contratação global.** Não é o
   board que importa, é a empresa. Um punhado de empresas que contratam PJ na
   América Latina vale mais que 5.000 vagas genéricas.
5. **Boards LATAM-first** (Get on Board, LatoJobs, Remote LATAM, Torre): volume
   menor, mas a restrição geográfica já vem resolvida na origem.
6. **Marketplaces de contractor** — cobertos na Frente A. Servem como fluxo de
   caixa e ponte, raramente como caminho para Architect/Staff.

**Camada 3 — baixo retorno para este perfil**

7. **Candidatura fria em massa via ATS.** É o que nosso produto otimiza hoje.
   Combinação de ghost jobs, filtro de work-auth e ausência de referral coloca a
   conversão perto de zero.

### 5.4 Recomendação de R&S sobre o produto

Se o objetivo é **entrevista**, e não **vagas coletadas**, três mudanças valem
mais que qualquer expansão de adapter:

1. **Adicionar Hacker News "Who is hiring?" (API do Algolia, gratuita, verificada
   funcionando).** Maior ganho de sinal por hora de implementação de toda a lista.
2. **Inverter o modelo de empresa-primeiro em vez de vaga-primeiro.** Manter uma
   lista curada de empresas que comprovadamente contratam PJ no Brasil e vigiar os
   boards *delas*. É o que o career-ops faz com 150+ career pages, e é a
   abordagem certa. `target_account` já existe no nosso schema — está subutilizada.
3. **Instrumentar o funil de conversão, não o de coleta.** Já temos
   `application_event` e `engagement`. A métrica que importa é
   **candidaturas → resposta → entrevista, por canal**. Sem isso, estamos
   otimizando o topo de um funil cujo gargalo está embaixo.

E a recomendação incômoda: **considerar seriamente adotar o career-ops como
camada de coleta** e manter nosso scorer determinístico e o modelo de funil por
cima. Reimplementar 75 providers para chegar onde alguém já chegou, com 12k forks
mantendo, é custo de oportunidade puro contra a única coisa que temos de
genuinamente diferente.
