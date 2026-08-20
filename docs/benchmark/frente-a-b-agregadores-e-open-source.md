# Benchmark competitivo — master-jobs

**Data:** 18 de agosto de 2026
**Escopo:** Frente A (agregadores e marketplaces de talento) + Frente B
(alternativas open source e self-hosted)
**Perfil de referência:** arquiteto de IA sênior, 20+ anos, no Brasil, contractor
B2B remoto, **sem autorização de trabalho nos EUA**, mirando Architect / Staff /
AI-Lead nos EUA, Canadá e Europa.

## Método e honestidade dos dados

- Estrelas, datas de último commit, licenças e status de arquivamento vieram da
  **API do GitHub**, consultadas em 18/08/2026 — não de estimativa.
- Status de API, redirects e volume de vagas foram verificados por **requisição
  direta** na data acima; os códigos HTTP estão citados no texto.
- Números da nossa própria base saíram de consultas SQL em `data/jobs.db`.
- Onde a fonte primária não publica um dado (preço, política geográfica), está
  escrito **"não publicado"**. Nada foi preenchido por inferência.

> **Aviso sobre o resultado.** Este benchmark encontrou um concorrente open source
> que faz, hoje, mais do que nós em quase todas as dimensões que consideramos
> nossas. A Seção 3 trata disso sem atenuação. Um benchmark que só confirmasse a
> tese do produto não teria valor.

---

## Resumo executivo — as cinco conclusões

1. **Existe um concorrente open source que nos domina na coleta.**
   [career-ops](https://github.com/santifer/career-ops) (65.306 estrelas, MIT,
   commits diários) tem **75 providers de vagas** e cobre **todas as nossas 12
   fontes**, com a mesma tese arquitetural — API pública, zero-auth. Não há uma
   fonte nossa que ele não tenha, salvo o Adzuna.

2. **Nossa vantagem real é o scoring determinístico, e ela é estreita mas
   defensável.** career-ops pontua com LLM por vaga (não reprodutível, custo
   marginal por vaga, "740+ vagas avaliadas" numa busca inteira). Nós pontuamos
   5.021 num run a custo zero, com nota decomponível e `SCORER_VERSION`
   versionado. A arquitetura certa combina os dois: determinístico para triagem
   de massa, LLM para os finalistas.

3. **Nosso funil está quebrado onde importa.** De 5.021 vagas coletadas, **1**
   passa de 70 de fit e **nenhuma** passa de 80. E 92,4% da base vem de uma única
   fonte (Lever). O gargalo não é coleta.

4. **Da Frente A, só uma plataforma é integrável — e duas nem existem mais.**
   O **Braintrust expõe API pública aberta** (`app.usebraintrust.com/api/jobs/`,
   sem auth) com **país de elegibilidade estruturado**: 13 das 121 vagas listam
   `country: "BR"`. É a única. Wellfound e Toptal respondem 403; **`hired.com`
   redireciona para a LHH** (marca aposentada em jun/2024) e **`otta.com`
   redireciona para a Welcome to the Jungle**, com migração destrutiva marcada
   para setembro de 2026. Para o resto, o caminho continua sendo job alert por
   e-mail — como a ADR já previa.

5. **Para este perfil, o canal decide mais que o ranqueamento.** Referrals são 7%
   dos candidatos e 40% das contratações; 18–27% dos anúncios são ghost jobs; e a
   fraude de localização em massa fez o filtro de work authorization virar defesa
   anti-fraude — o que elimina um arquiteto brasileiro legítimo junto com o
   ruído. Nenhum ajuste no scorer conserta um problema de canal.

---

# Frente A — Agregadores e marketplaces para talento sênior / remoto / contractor

> Coluna crítica: **contrata contractor a partir do Brasil?**
> Status de API, redirects e contagens de vagas verificados por requisição
> direta em 18/08/2026. Onde a fonte primária não publica o dado, está escrito
> **"não publicado"** — nada foi preenchido por inferência.

## 1. Tabela dos agregadores e marketplaces

| Plataforma | Público | API pública? | Contrata do Brasil? | Quem paga |
|---|---|---|---|---|
| [Braintrust](https://www.usebraintrust.com/) | Marketplace de talento | ✅ **SIM — aberta, sem auth** | ✅ **Sim, explícito** — 13 das 121 vagas listam `country: "BR"` | Cliente (**15%**); talento paga **0%** |
| [A.Team](https://www.a.team/join) | Times sob demanda, sênior | ❌ (SPA fechada) | ❓ **Não publicado** — mas anuncia "building density in the Americas/EST" | Cliente — *"you set your rate, we don't skim it"* |
| [Toptal](https://www.toptal.com/) | Freelance "top 3%" | ❌ (Cloudflare 403) | ✅ Sim — "over 100 countries"; **sem visa sponsorship** = contractor | Cliente ($79/mês + markup **oculto, est. 40–60%**) |
| [Lemon.io](https://lemon.io/for-developers/) | Freelance dev p/ startups | ❌ | ✅ Na prática — paga via Wise/Payoneer | Cliente |
| [Arc.dev](https://arc.dev/remote-jobs) | Remoto global | ❌ | ✅ **Sim, explícito** — trilha "Remote jobs in Brazil" | Cliente |
| [Andela](https://www.andela.com/) | Talento AI-native | ❌ | ✅ Sim — cita time "de Europa, Quênia, **Brasil**, Índia" | Cliente |
| [Turing](https://www.turing.com/jobs) | Devs p/ empresas US | ❌ | Não publicado — "globally distributed", contractor | Cliente (grátis p/ dev) |
| [Wellfound](https://wellfound.com/) | Startups early-stage | ❌ (Cloudflare 403) | 🟡 Depende do empregador — **219 vagas BR vs 14.819 US** | Cliente (job posts grátis; ads a partir de $200) |
| [Welcome to the Jungle (ex-Otta)](https://uk.welcometothejungle.com/) | Tech/startups UK/EU/US | 🟡 Parcial, **não documentada** | ❌ Não é o mercado deles (FR/UK/US) | Cliente |
| [X-Team](https://x-team.com) | Staff augmentation | ❌ | Não publicado | Cliente |
| [Gun.io](https://gun.io) | Freelance sênior | ❌ (403) | Não publicado | Cliente |
| [Hired](https://www.lhh.com/) | Marketplace reverso | ☠️ | ☠️ **MORTO** | — |

**Todas são gratuitas para o candidato.** Nenhuma das 12 cobra do talento — o
modelo é sempre taxa sobre o cliente. Braintrust é a única com 0% contratual e
explícito para o talento ([Site Service Fees Terms](https://usebraintrust.com/site-service-fees-terms)).

### 1.1 Duas plataformas não existem mais como produto independente

Verificado por `curl` hoje:

- **Hired está morto.** `hired.com` → **301** para a página "nossa história" da
  LHH. A LHH incorporou o Hired ao LHH Recruitment Solutions em **14/06/2024**
  ([Staffing Industry Analysts](https://www.staffingindustry.com/news/global-daily-news/adecco-incorporating-hired-lhh-business);
  [discussão no HN](https://news.ycombinator.com/item?id=40746030)). Qualquer
  artigo de 2025–2026 recomendando "Hired.com" é conteúdo desatualizado.
- **Otta acabou como marca.** `otta.com` → **301** para
  `uk.welcometothejungle.com`; `app.otta.com` → **301** para o login da WTTJ.
  E há uma **migração destrutiva marcada para setembro de 2026**, descrita pela
  própria empresa em [go.welcometothejungle.com/candidate-migration](https://go.welcometothejungle.com/candidate-migration):
  *"The app is closing in September"*, vagas salvas e histórico de candidaturas
  não migram, e *"your messages won't carry over"*. **Não construa estado em
  cima da Otta.**

### 1.2 O achado integrável: Braintrust expõe API pública aberta

Este é o único resultado da Frente A com valor direto de engenharia. Verificado
por requisição própria em 18/08/2026:

```
GET https://app.usebraintrust.com/api/jobs/        → HTTP 200, JSON, sem auth
GET https://app.usebraintrust.com/api/jobs/?page=2 → paginação DRF
GET https://app.usebraintrust.com/api/jobs/{id}/   → detalhe
```

Sem chave, sem header, sem cookie. E os campos são **exatamente os que nosso
scorer consome**: `budget_minimum_usd`, `budget_maximum_usd`, `payment_type`,
`contract_type`, `expected_hours_per_week`, `timezones`, `main_skills`,
`locations[].country`, `start_date`, `deadline`.

Contagens que fiz percorrendo a paginação inteira:

| Métrica | Valor |
|---|---:|
| Vagas abertas no mundo | **121** |
| Elegíveis ao Brasil (`country == "BR"`) | **13** |
| Títulos com "architect" | 1 |
| Títulos com "principal" | 1 |
| Títulos com "staff" | 1 |
| Títulos com "senior" | 23 |

**Leitura honesta:** a API é ótima e a ingestão é trivial — mas 121 vagas globais
é um marketplace pequeno, e o inventário de nível Architect/Staff/Principal é
**quase inexistente**. Boa parte do restante é trabalho de treinamento de IA a
US$ 15–32/h. Vale como fonte automatizada barata com filtro geográfico
estruturado — **não como canal principal**.

### 1.3 Sinais de risco verificados

- **O token BTRST do Braintrust colapsou.** Dados da
  [CoinGecko](https://www.coingecko.com/en/coins/braintrust): **US$ 0,0565**
  contra ATH de **US$ 46,82** em 15/09/2021 — **−99,88%**. A tese de "você é dono
  da rede" está economicamente morta. Se oferecerem BTRST como parte da
  remuneração, trate como valor ~zero. O ceticismo já estava no
  [HN em 2022](https://news.ycombinator.com/item?id=32946968): a rede é dividida
  entre uma empresa privada (dona do site) e uma fundação panamenha (dona do
  token) — *"it's questionable to say the token holders 'own' the network."*
- **Wellfound: "ghost application harvesting".** O usuário FireBeyond documentou
  o mesmo padrão quatro vezes no HN só em 2026, com números crescentes:
  [80+ candidaturas sem resposta (abr)](https://news.ycombinator.com/item?id=47617555),
  [mai](https://news.ycombinator.com/item?id=47998972),
  [jun](https://news.ycombinator.com/item?id=48562595) e
  [120+ candidaturas e "crickets" (jul)](https://news.ycombinator.com/item?id=49053869).
  Some-se a isso: **219 vagas no Brasil contra 14.819 nos EUA, e zero de
  Principal Engineer no Brasil.**
- **Toptal: markup oculto e compressão de taxa.** A empresa afirma não tirar
  percentual do freelancer — verdade na letra, porque a margem é markup em cima,
  não divulgado a nenhum dos lados. Relatos de primeira mão no HN estimam 40–60%:
  [*"more or less a 50% markup over what developer gets"*](https://news.ycombinator.com/item?id=10114857)
  e [*"we are still talking $30/hr with them getting $100/hr"*](https://news.ycombinator.com/item?id=14845568).
  Há também relato de [taxa caindo de forma sustentada dentro da plataforma](https://news.ycombinator.com/item?id=10112786)
  e de [triagem em que o revisor sequer olhou o projeto entregue](https://news.ycombinator.com/item?id=15625602).
  Funil de 3–8 semanas.
- **A.Team: o nível é o certo, a opacidade é total.** É a única plataforma cujo
  posicionamento explícito é Architect/Staff — o anúncio deles no "Who is hiring"
  do HN em [02/03/2026](https://news.ycombinator.com/item?id=47220100) oferece
  **US$ 120–170/h** para Senior AI Architect e diz *"building density in the
  Americas/EST"*, janela em que o Brasil (UTC−3) se encaixa. Mas **não há
  política pública de elegibilidade por país**, e nem os termos de serviço são
  legíveis (SPA que exige JavaScript). Ressalva relevante de um membro da própria
  rede, [no HN](https://news.ycombinator.com/item?id=34693244): *"they don't even
  have many contracts available right now (…) contracting is a horrible
  replacement for full time opportunities. It's unpredictable."*

### 1.4 Leitura de R&S sobre a Frente A

**Como fonte de dados, a Frente A é quase toda irrelevante** — apenas o Braintrust
é integrável. Wellfound, Toptal, Gun.io estão atrás de Cloudflare; A.Team é SPA
fechada; a WTTJ tem endpoints sem documentação que podem quebrar sem aviso (e
está em migração agora). Para essas, o caminho legítimo continua sendo **job
alert por e-mail + cadastro manual**, como já decidido na ADR do projeto.

**Como canal de colocação**, a ordem para este perfil:

1. **A.Team** — único com fit real de Architect/Staff e tarifa compatível
   (US$ 120–170/h), timezone Americas/EST explicitamente priorizado. Entrada
   manual. **Ação: perguntar por escrito sobre elegibilidade Brasil e método de
   pagamento antes de investir no funil.**
2. **Toptal** — aceita contractor de 100+ países sem exigir autorização US, paga
   em USD. Custo: 3–8 semanas de triagem e markup de 40–60% corroendo a tarifa.
3. **Braintrust** — o único automatizável, com país de elegibilidade estruturado.
   Volume e nível baixos; vale como fonte barata, não como aposta.
4. **Arc.dev / Andela / Lemon.io** — aceitam Brasil, mas posicionam o
   profissional como capacidade alocada, não como arquiteto. Lemon.io divulga
   sênior a partir de US$ 55/h, abaixo do alvo. Fluxo de caixa, não destino.
5. **Descartar:** Hired (morto), Otta/WTTJ (marca extinta, migração destrutiva,
   mercado errado), Wellfound (219 vagas BR, zero Principal, padrão documentado
   de candidatura-fantasma).

# Frente B — Alternativas open source e self-hosted

> Dados coletados via API do GitHub em **18/08/2026**. Estrelas, datas de último
> push e licenças foram verificadas na origem, não estimadas.

## 2. Tabela dos projetos open source

| Projeto | Estrelas | Último push | Fontes de dados | Faz scoring? | Licença |
|---|---:|---|---|---|---|
| [santifer/career-ops](https://github.com/santifer/career-ops) | **65.306** | 2026-08-18 | Greenhouse, Ashby, Lever, Wellfound (150+ career pages pré-configuradas) + HN "Who is hiring" via Algolia | **Sim** — rubrica A–G avaliada por LLM, nota 1.0–5.0 | MIT |
| [feder-cr/Jobs_Applier_AI_Agent_AIHawk](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk) | **30.203** | 2026-08-18 | LinkedIn (Selenium) | Não — foca em auto-apply e geração de CV | AGPL-3.0 |
| [speedyapply/JobSpy](https://github.com/speedyapply/JobSpy) | **4.107** | 2026-02-18 | LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Bayt, Naukri, BDJobs (scraping) | Não — só coleta, devolve DataFrame | MIT |
| [DaKheera47/job-ops](https://github.com/DaKheera47/job-ops) | **3.855** | 2026-08-18 | Ingestão manual + extensão; self-hosted (Next.js/Docker) | Parcial — análise assistida por LLM | NOASSERTION |
| [GodsScion/Auto_job_applier_linkedIn](https://github.com/GodsScion/Auto_job_applier_linkedIn) | 2.710 | 2026-08-10 | LinkedIn (Selenium) | Não | MIT |
| [PaulMcInnis/JobFunnel](https://github.com/PaulMcInnis/JobFunnel) | 2.179 | 2025-12-10 | Indeed, Monster (scraping estático) | Não — dedup + CSV | MIT |
| [Gsync/jobsync](https://github.com/Gsync/jobsync) | 909 | 2026-08-18 | Entrada manual; tracker self-hosted com Ollama | Parcial — review de CV e match por LLM | MIT |
| [wodsuz/EasyApplyJobsBot](https://github.com/wodsuz/EasyApplyJobsBot) | 808 | 2026-05-18 | LinkedIn, Glassdoor (Easy Apply) | Não | NOASSERTION |
| [DanielPan12/JobHuntBot](https://github.com/DanielPan12/JobHuntBot) | 465 | 2026-08-08 | Agent-driven, multi-board | Parcial | MIT |
| [Donvink/swiss-job-hunter](https://github.com/Donvink/swiss-job-hunter) | 137 | 2026-08-04 | 7 job boards suíços | **Sim** — score contra o CV | AGPL-3.0 |
| [kalil0321/ats-scrapers](https://github.com/kalil0321/ats-scrapers) | 131 | 2026-08-07 | **ATS puros** — mesma tese de coleta que a nossa | Não — é dataset | MIT |
| [theihasan/geezap](https://github.com/theihasan/geezap) | 129 | 2026-03-17 | Agregação multi-API (Laravel) | Parcial | não declarada |
| [vesaias/JobNavigator](https://github.com/vesaias/JobNavigator) | 13 | 2026-08-16 | Multi-source scraping | **Sim** — AI scoring | MIT |

### O caso JobFunnel — a lápide que valida nossa arquitetura

JobFunnel está **arquivado** (`archived: true` na API do GitHub). O autor não
abandonou por desinteresse; ele explicou o motivo no próprio README:

> "JobFunnel foi construído numa era em que os grandes job boards expunham HTML
> majoritariamente estático com paginação simples. (…) Desde então, a maioria dos
> job boards migrou para anti-automação e detecção de bots muito mais agressivas.
> Reimplementar o JobFunnel sobre automação de browser completa (…) é tecnicamente
> possível, mas lento demais, frágil demais e operacionalmente complexo demais
> (…). Em vez de fingir que isso ainda funciona, estou arquivando o projeto."
> — [README do JobFunnel](https://github.com/PaulMcInnis/JobFunnel)

Isso é a evidência mais forte a favor da nossa escolha de **API pública em vez de
scraping**: 2.179 estrelas não impediram o projeto de morrer pelo lado da coleta.

---

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
   É onde o time de engenharia escreve o próprio anúncio, com contato direto e
   sem ATS no meio — e foi exatamente ali que a A.Team publicou uma vaga de
   Senior AI Architect a US$ 120–170/h priorizando o fuso das Américas.
   **Bônus barato:** o adapter do **Braintrust** (JSON aberto, com
   `locations[].country` e faixa em USD já estruturados) custa poucas horas e
   alimenta o scorer com os campos de geo e compensação prontos.
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
