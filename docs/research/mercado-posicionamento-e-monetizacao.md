# Mercado de posicionamento, modelo de negócio e sinais de contratação

> Pesquisa comercial para o `job-hunt-os`. Recorte: (A) ferramentas de posicionamento/personal
> branding no LinkedIn, (B) onde está o dinheiro no mercado de carreira, (C) sinais que preveem
> contratação bem-sucedida.
>
> **Data da coleta:** agosto/2026. Preços mudam; sempre revalidar antes de decisão de investimento.
>
> **Aviso de qualidade de fonte:** este mercado é dominado por *SEO afiliado*. Boa parte dos
> "reviews" de ferramenta é publicada por concorrente direto (a AuthoredUp publica review do Taplio,
> a Supergrow publica review do Taplio, a Magicpost publica "alternativas ao Kleo"). Onde a fonte é
> concorrente, isso está marcado com ⚠️ e o dado deve ser tratado como indício, não como fato.
> Preços vindos da própria página de pricing do fornecedor estão marcados com ✅.

---

## 1. Ferramentas de posicionamento no LinkedIn

### 1.1 O contexto que muda tudo: 2025–2026 foi uma temporada de caça

Antes da tabela, o fato que reorganiza a frente inteira: **o LinkedIn fechou o cerco sobre extensões
de navegador entre 2025 e 2026, e a categoria encolheu por força de execução, não por competição.**

Linha do tempo:

| Quando | O quê | Consequência |
|---|---|---|
| jul/2025 | LinkedIn lança a **Member Post Analytics API** (parte da Community Management API), dando acesso oficial a impressões, crescimento de seguidores e views de vídeo para parceiros aprovados ([ppc.land](https://ppc.land/linkedin-enables-third-party-analytics-access-with-new-member-post-api/), [Digiday](https://digiday.com/media/linkedin-makes-it-easier-for-creators-to-track-performance-across-platforms/)) | Cria uma via legítima — e, ao criá-la, remove a desculpa de "não havia API". Parceiros aprovados: Hootsuite, Buffer, Sprinklr, Metricool, Oktopost, Zoho, mLabs, SocialPilot, Later, Publer, Vista Social |
| jul/2025 | **Proxycurl** (maior API de scraping de LinkedIn) encerra operações após processo do LinkedIn ([Scrapfly](https://scrapfly.io/blog/posts/guide-to-linkedin-api-and-alternatives)) | Sinal de que o LinkedIn litiga, não só bloqueia |
| 2025 | Apollo.io e Seamless.ai sofrem a mesma execução ([getsocialkit](https://www.getsocialkit.com/post/shield-analytics-shutdown)) | Padrão, não caso isolado |
| início/2026 | **Kleo** recebe cease-and-desist do jurídico do LinkedIn e desliga a extensão — depois de 2 anos e 70 mil+ usuários ⚠️ ([Magicpost](https://magicpost.in/blog/kleo-review), [AuthoredUp](https://authoredup.com/blog/kleo-review)) | Reconstruído como web app sem injeção de browser |
| mai/2026 | **Shield Analytics encerra as operações.** O próprio site é hoje um aviso de encerramento assinado pelos cofundadores Andreas e Alex ✅ ([shieldapp.ai](https://www.shieldapp.ai/pricing)) | Referência da categoria desde 2018, morta |

A causa declarada do fim do Shield: a arquitetura de extensão Chrome que puxava dados do LinkedIn
em background conflitava simultaneamente com os requisitos de API do LinkedIn **e** com as políticas
da Chrome Web Store ([getsocialkit](https://www.getsocialkit.com/post/shield-analytics-shutdown)).

**Leitura de R&S:** quem construiu em cima da sessão autenticada do usuário construiu sobre terreno
alugado, e o proprietário retomou o terreno. Isso não é um risco teórico de ToS — é um obituário.

### 1.2 Tabela comparativa

| Ferramenta | O que faz | Preço | Como acessa o LinkedIn | Risco de ToS |
|---|---|---|---|---|
| **Taplio** (lempire) | Agendamento, biblioteca de posts virais, IA de redação, engajamento, outreach | Starter US$ 39/mês · Growth US$ 69/mês · Pro US$ 199/mês; anual US$ 32/49/149 (-25%). Trial 7 dias com acesso Pro ⚠️ ([taplio.com/blog](https://taplio.com/blog/taplio-pricing), [ColdIQ](https://coldiq.com/blog/taplio-pricing)). Página `/pricing` confirma "a partir de US$ 39/mês" e trial de 7 dias ✅ | **Cookie da sessão do usuário**, não API oficial de parceiro ⚠️ ([Kondo](https://www.trykondo.com/blog/is-taplio-safe-understanding-the-risks-to-your-linkedin-account)). Também expõe extensão Chrome, API própria (`api.taplio.com`) e servidor MCP | **Alto.** Em abr/2025 o LinkedIn bloqueou o Taplio temporariamente. Auto-DM e auto-conexão do plano Pro agem fora da API oficial e a ferramenta não impõe o limite de ~100 ações/dia ⚠️. Fontes concorrentes afirmam que o Taplio foi banido de vez ⚠️ — **não confirmado**: o site segue operando e vendendo |
| **Shield Analytics** | Analytics pessoal de posts no LinkedIn (desde 2018) | **N/A — encerrado** ✅ | Extensão Chrome coletando em background | **Materializado.** Morreu por isso em mai/2026 |
| **AuthoredUp** | Editor, pré-visualização, rascunhos, agendamento, 300+ hooks/CTAs, analytics | Individual US$ 19,95/mês ou US$ 199,50/ano (US$ 16,63/mês). Business US$ 14,95/perfil/mês (mín. 3) ou US$ 149,50/perfil/ano. Custom Growth: mín. 10 perfis, sob consulta. Trial sem cartão ✅ ([authoredup.com/pricing](https://www.authoredup.com/pricing)) | **Extensão Chrome** que injeta na própria timeline do LinkedIn, + plataforma web para editor e rascunhos ✅ | **Alto e estrutural.** Mesma arquitetura que matou o Shield e o Kleo. Não encontrei nenhuma evidência de que a AuthoredUp esteja na lista de parceiros aprovados da Member Post Analytics API. Sem esse selo, está exposta à mesma execução |
| **Supergrow** | Content DNA, entrevistas de IA, repurposing, carrossel, infográfico, agendamento, analytics | Starter US$ 19/mês · Pro US$ 39/mês · Teams US$ 139/mês (4 contas); anual -20% (US$ 16/31/133). Trial 7 dias ✅ ([supergrow.ai/pricing](https://www.supergrow.ai/pricing)) | Declara publicar **via conexão de API oficial** ✅ | **Menor** — se a declaração de API oficial se sustentar. É o único da lista que reivindica explicitamente a via legítima. Ainda assim, a lista pública de parceiros da Member Post Analytics API não inclui a Supergrow |
| **Kleo** | Descoberta de posts virais, redação com IA, gráficos | Fontes conflitam: US$ 99/mês (ou US$ 999/ano) sem trial ⚠️ ([Magicpost](https://magicpost.in/blog/kleo-review), [AuthoredUp](https://authoredup.com/blog/kleo-review)) vs. Kleo 2.0 em beta a ~US$ 19/mês ⚠️ ([Postiv](https://postiv.ai/blog/kleo-alternatives)). O site próprio **não publica preço** ✅ | Era extensão Chrome com scraping de DOM. Após o cease-and-desist, virou **web app** — escreve lá, publica no LinkedIn manualmente | **Materializado e depois mitigado.** A extensão morreu; o web app foi feito para não depender de injeção de browser |
| **Resume Worded** (LinkedIn Review) | Score de currículo e de perfil de LinkedIn contra ~30 checagens de recrutador; AutoFix, Smart Target, gerador de carta | Free: Score My Resume e LinkedIn Review básicos ✅. Pro: US$ 49/mês · US$ 99/trimestre (US$ 33/mês) · US$ 229/ano (US$ 19/mês) ⚠️ ([PitchMeAI](https://pitchmeai.com/blog/resume-worded-pricing-premium-worth-it), [aihungry](https://aihungry.com/tools/resume-worded/pricing)) | **Não acessa o LinkedIn.** O usuário exporta o PDF do próprio perfil e faz upload | **Nenhum.** É o modelo arquitetonicamente seguro da lista |
| **LinkedIn Premium Career** | Ver quem viu o perfil, InMails, Job Match com nota, badge "Top Applicant", LinkedIn Learning | US$ 39,99/mês (novos assinantes) — antigos mantêm US$ 29,99. Anual reduz bem (~US$ 20/mês) ⚠️ ([Cleanlist](https://www.cleanlist.ai/blog/2026-06-30-linkedin-premium-cost), [ConnectSafely](https://connectsafely.ai/articles/linkedin-premium-pricing-cost-guide-2026)) | É o LinkedIn | Nenhum |
| **LinkedIn Premium Business** | Acima + busca ilimitada, insights de empresa | US$ 69,99/mês (antigos US$ 59,99); anual ~US$ 47,99/mês ⚠️ | É o LinkedIn | Nenhum |
| **Sales Navigator Core / Advanced** | Busca avançada de leads, alertas, listas | Core US$ 119,99/mês (anual US$ 89,99/mês). Advanced US$ 159,99/mês ou US$ 1.799,88/ano ⚠️ ([business.linkedin.com](https://business.linkedin.com/sell/sales-navigator/compare-plans)) | É o LinkedIn | Nenhum |
| **SSI (Social Selling Index)** | Nota 0–100 em 4 pilares de 25 pontos: marca profissional, encontrar pessoas certas, engajar com insights, construir relacionamentos | **Grátis**, inclusive em conta free ✅ ([business.linkedin.com](https://business.linkedin.com/sales-solutions/social-selling/the-social-selling-index-ssi)) | É o LinkedIn | Nenhum |

### 1.3 O que essa frente ensina ao job-hunt-os

Três conclusões duras:

1. **A decisão de não fazer scraping do LinkedIn não é conservadorismo — é a única arquitetura que
   sobrevive.** Shield morreu, Kleo levou cease-and-desist, Proxycurl fechou, Taplio foi bloqueado.
   Todos os que dependiam da sessão do usuário pagaram. O único ativo defensável da lista, do ponto
   de vista de continuidade, é o Resume Worded — que **não toca no LinkedIn**.

2. **Preço de referência da categoria de posicionamento: US$ 19–49/mês para indivíduo.** O teto de
   US$ 99–199/mês existe (Kleo, Taplio Pro), mas é para criador profissional e agência, não para
   candidato. Isso ancora a expectativa de preço de qualquer produto de carreira para pessoa física.

3. **Posicionamento e busca de vaga são mercados diferentes com compradores diferentes.** Taplio,
   AuthoredUp, Supergrow e Kleo vendem para quem quer *audiência* — fundador, consultor, vendedor,
   ghostwriter. O comprador desses produtos tem ROI comercial mensurável (leads). O candidato
   desempregado não tem. Não é o mesmo bolso, e é um erro de posicionamento tratar como se fosse.

---

## 2. Mapa de preços do mercado de carreira

### 2.1 Lado candidato — por categoria e tier

| Categoria | Produto | Free | Pago | Observação |
|---|---|---|---|---|
| **Tracking + tailoring** | **Huntr** | US$ 0 — currículos base ilimitados, **2** currículos sob medida, **matching e scoring básicos**, até 100 vagas rastreadas ✅ | Pro **US$ 40/mês** · US$ 30/mês trimestral (US$ 90) · US$ 26,67/mês semestral (US$ 160) ✅ ([huntr.co/pricing](https://huntr.co/pricing)) | O paywall relevante: **"advanced job matching with full keyword visibility"** está no Pro. Ou seja: a *explicação* é o produto pago |
| **Tracking + tailoring** | **Teal** | Tracking de vagas **ilimitado**, extensão Chrome, resume builder básico, 10 templates, créditos de IA limitados | Teal+ **US$ 13/semana**, **US$ 29/mês**, **US$ 79/trimestre**. Sem plano anual ⚠️ ([Jobsolv](https://jobsolv.com/directory/teal), [ApplyArc](https://applyarc.com/compare/teal-pricing)) | Cobra por semana — precificação desenhada para um evento curto, não para relacionamento longo. Levantou US$ 20,7 M em 4 rodadas ([Tracxn](https://tracxn.com/d/companies/teal/__2DKqrP7V66-l9-_sa9s2S0-7EBbtBWPDi1lVoI8b7Os)) |
| **Otimização ATS** | **Jobscan** | **5 scans/mês**, permanente, sem cartão | Premium **US$ 49,95/mês** · **US$ 89,95/trimestre** (≈US$ 30/mês) · ~US$ 299,95/ano ⚠️ ([PitchMeAI](https://pitchmeai.com/blog/jobscan-pricing-plans), [ITQlick](https://www.itqlick.com/jobscan/pricing)) | Referência de sobrevivência da categoria (ver §6) |
| **Reescrita de currículo** | **Resume Worded** | Score + LinkedIn Review básicos | Pro US$ 49/mês · US$ 99/tri · US$ 229/ano ⚠️ | |
| **Auto-apply** | **Simplify** | Autofill de formulário **grátis** | Plus **US$ 30/mês** (fila de aplicação assistida) ⚠️ ([FastApply](https://blog.fastapply.co/best-ai-job-application-automation-tools-2026)) | |
| **Auto-apply** | **LazyApply** | — | **US$ 99 a US$ 249 vitalício**; tier Ultimate US$ 999/ano ⚠️ | Preço vitalício = admissão de que não há retenção |
| **Auto-apply** | **AIApply** | — | ~US$ 29/mês anunciado; custo all-in reportado ~US$ 68/mês ⚠️ | |
| **Auto-apply** | **Sonara** | — | Trial pago US$ 2,95/14 dias → **US$ 23,95 a cada 4 semanas** (~US$ 311/ano) ⚠️ | Padrão *dark pattern* de trial pago com auto-renovação |
| **Entrevista** | **Final Round AI** | — | **US$ 149/mês** · US$ 299/tri (≈US$ 99,67/mês) · US$ 500/ano (≈US$ 41,67/mês) ⚠️ | Preço mensal mais alto do lado candidato que encontrei |
| **Entrevista** | **Big Interview** | — | US$ 39/mês · US$ 99/3 meses · **US$ 299 vitalício** ⚠️ ([biginterview.com](https://www.biginterview.com/pricing/personal)) | Também vende para universidades |
| **Entrevista** | **Google Interview Warmup** | Era grátis | **Descontinuado** | O grátis do gigante saiu de campo |
| **Plataforma** | **LinkedIn Premium Career** | Perfil, candidatura, SSI, Job Match básico | **US$ 39,99/mês** (novos) / US$ 29,99 (antigos); anual ≈US$ 19,99/mês | Job Match com nota **High/Medium/Low** e badge "Top Applicant" são o gate Premium |
| **Agregação** | **hiring.cafe** | **Grátis**, 2,8 M+ vagas de 46–75 ATS | — | Concorrente direto da tese de agregação, a custo zero para o usuário |
| **Dados salariais** | **Levels.fyi** | Dados de comp **grátis** | Premium + **venda de dados agregados para empresas** ([Fast Company](https://www.fastcompany.com/90604436/levels-fyi-leveling-tech-salaries-leveling-negotiation)) | Modelo: dá o dado de graça ao candidato, cobra da empresa |

**Faixa consolidada do lado candidato: US$ 0 grátis / US$ 19–49 por mês no tier padrão / US$ 149 no
extremo (copiloto de entrevista ao vivo).** O ponto modal é **US$ 29–40/mês**.

### 2.2 Lado recrutador — os mesmos problemas, 45x o preço

Preços de tabela publicados existem só no tier de entrada; o valor real de contrato vem de dados
transacionais do [Vendr Marketplace](https://www.vendr.com/marketplace) (compras efetivamente
fechadas via plataforma de procurement).

| Ferramenta | Preço de entrada publicado | **ACV real (mediana)** | Faixa |
|---|---|---|---|
| **hireEZ** | não publicado | **US$ 13.000/ano** | US$ 7.000 – 25.000 ([Vendr](https://www.vendr.com/marketplace/hireez)) |
| **Lever** (ATS) | não publicado | **US$ 15.400/ano** | US$ 6.714 – 51.864 ([Vendr](https://www.vendr.com/marketplace/lever)) |
| **SeekOut** | US$ 149/mês (3 seats) ✅ ([seekout.com](https://www.seekout.com/pricing/)) | **US$ 20.000/ano** | US$ 5.820 – 54.920 ([Vendr](https://www.vendr.com/marketplace/seekout)) |
| **Gem** | US$ 130/mês (startup) ✅ ([gem.com](https://www.gem.com/pricing)) | **US$ 25.700/ano** | US$ 7.000 – 73.184 ([Vendr](https://www.vendr.com/marketplace/gem)) |
| **Greenhouse** (ATS) | não publicado | **US$ 26.611/ano** | US$ 10.222 – 75.001 ([Vendr](https://www.vendr.com/marketplace/greenhouse)) |
| **Findem** | não publicado | **US$ 58.000/ano** | US$ 7.225 – 94.840 ([Vendr](https://www.vendr.com/marketplace/findem)) |
| **Eightfold AI** | não publicado | não disponível | Estimativas de analista: US$ 7–10 PEPM, contratos US$ 150k–500k+/ano ([ITQlick](https://www.itqlick.com/eightfold-ai/pricing)) |
| **LinkedIn Recruiter Lite** | **US$ 170/mês** ou US$ 1.680/ano ✅ | — | Licenças 2–5 a ~US$ 270/mês cada |
| **LinkedIn Recruiter Corporate** | não publicado | **US$ 10.800 – 12.960/seat/ano** | Reajuste ~+15% em 2026 ([Leonar](https://www.leonar.app/blog/linkedin-recruiter-price-increase-2026/)) |
| **LinkedIn Talent Insights** | não publicado | US$ 6.000 – 20.000+/ano | Produto separado, não vem no bundle |

Três padrões:

1. **O preço público é isca.** O ACV real é 10–20x o tier de entrada anunciado em todos os casos.
2. **Desconto é estrutural:** 13–20% de economia média negociada na categoria (Vendr); um caso
   registrado de 51% na Findem.
3. **Ferramenta de sourcing custa o mesmo que o ATS** (US$ 13–26k medianos). Findem e Eightfold
   jogam num tier acima porque vendem para o RH corporativo, não para o time de recrutamento.

### 2.3 Pelo que o candidato realmente paga, e o que fica grátis

Padrão consistente em toda a amostra:

**Fica grátis** (é commodity, serve de aquisição):
- Busca e agregação de vagas — hiring.cafe entrega 2,8 M vagas de 75 ATS a custo zero
- Tracking de candidaturas — Teal dá **ilimitado** no free; Huntr dá 100
- Diagnóstico inicial: um score, um "seu currículo tem 62/100"
- Dados salariais (Levels.fyi)
- SSI do LinkedIn

**É pago** (dor aguda, urgência datada):
- **Volume de produção de artefato**: currículo sob medida ilimitado, carta de apresentação, reescrita
- **Remoção de limite de crédito**: o free dá 2 ou 5, o pago dá "ilimitado"
- **A explicação detalhada**: o Huntr cobra por *"full keyword visibility"*, o Jobscan cobra pelo
  *"full Match Report"*, o Resume Worded cobra pela *"Line-by-Line Analysis"*
- **Assistência no momento de máxima ansiedade**: copiloto de entrevista ao vivo a US$ 149/mês
- **Terceirização do esforço**: auto-apply

A regra: **o candidato paga por produção e por alívio de ansiedade, não por informação.** O produto
de informação vira grátis em 18 meses porque alguém sempre entrega de graça para captar audiência.

---

## 3. Candidato paga vs. empresa paga — os números

| Dimensão | Lado candidato | Lado empresa |
|---|---|---|
| Ticket típico anual | **US$ 240 – 600** (US$ 20–50/mês) | **US$ 13.000 – 58.000** (mediana por ferramenta) |
| Ticket LinkedIn | Premium Career **US$ 240/ano** | Recruiter Corporate **US$ 10.800 – 12.960/seat/ano** |
| **Razão** | — | **≈ 45x por usuário** |
| Receita LinkedIn (proxy do mercado) | Premium (todos os tiers, inclui Business/Sales): **US$ 2 bi** ([TechCrunch](https://techcrunch.com/2025/01/29/linkedin-passes-2b-in-premium-revenues-in-12-months-with-overall-revenues-up-9-on-the-year)) | Talent Solutions: **≈ US$ 8,4 bi** estimados ([FourWeekMBA](https://fourweekmba.com/linkedin-revenue-breakdown/)) |
| Razão de receita | — | **≈ 4:1** — e Premium *Career* puro é só uma fração dos US$ 2 bi |
| Horizonte de compra | Semanas a meses (dura o desemprego) | Plurianual, renovação contratual |
| Quem decide | O próprio usuário, sob estresse financeiro | Comitê com orçamento aprovado |
| Elasticidade a preço | Altíssima — o comprador está sem renda | Baixa — é custo operacional dedutível |
| Motor de churn | **Sucesso do produto** | **Fracasso** do produto |

Contexto de receita do LinkedIn: **US$ 19,8 bi no FY2026, +11% a/a** — já ultrapassou Windows &
Devices dentro da Microsoft ([10-K FY2026 via GeekWire](https://www.geekwire.com/2026/which-microsoft-businesses-are-growing-and-shrinking-according-to-obscure-table-in-regulatory-filing/)).
Só os produtos *agênticos* de Talent Solutions (Hiring Assistant e afins) já rodam a **mais de
US$ 450 milhões de run rate anualizado** ([Microsoft IR Q3 FY2026](https://www.microsoft.com/en-us/investor/earnings/fy-2026-q3/press-release-webcast)) —
isto é, um único recurso do lado empregador vale mais que a categoria inteira de ferramentas de
candidato somada.

### 3.1 O paradoxo de churn que define a categoria

**Este é o fato central do modelo de negócio candidate-side, e não tem contorno elegante.**

O produto de carreira é a rara categoria de assinatura em que **o sucesso do produto causa o
cancelamento**. Quem consegue o emprego cancela. Quem não consegue cancela por falta de dinheiro e
por associação com o fracasso. O churn é estruturalmente ~100% dentro de 3–6 meses, e nenhuma
"estratégia de retenção" resolve, porque a intenção de compra evaporou junto com a necessidade.

A precificação do mercado já *confessa* isso:

- **Teal cobra por semana** (US$ 13/semana) — precificação de evento, não de relacionamento
- **LazyApply e Big Interview vendem "vitalício"** por US$ 99–299 — quem vende vitalício está
  admitindo que não haveria segunda renovação de qualquer jeito, então antecipa o LTV inteiro
- **Sonara usa trial pago de US$ 2,95 que renova em US$ 23,95/4 semanas** — extração antes da fuga
- **Jobscan e Huntr vendem trimestre e semestre com desconto agressivo** (Huntr: 33% off no
  trimestral) — empurrar prazo é a única alavanca de LTV disponível

Compare com job boards B2B: churn mensal de 5–8%, vida média de 12–20 meses, LTV de ~US$ 4.983 num
plano de US$ 299/mês ([Cavuno](https://cavuno.com/blog/job-board-monetization)). O lado candidato
não chega perto disso.

**Consequência de CAC:** com LTV de US$ 40–120 (1 a 3 meses a US$ 40), o CAC precisa ficar abaixo de
~US$ 30 para haver negócio. Isso elimina venda paga em praticamente qualquer canal e obriga a
aquisição orgânica/viral — que é exatamente por que este mercado é um pântano de SEO afiliado. Não é
falta de criatividade dos concorrentes: é a única aritmética que fecha.

---

## 4. "Matching explicável é vendável?" — avaliação honesta

### 4.1 A resposta curta

**Sim, alguém já cobra por isso — e não, não é uma categoria de produto.** Explicabilidade é hoje
uma *técnica de paywall*, não uma proposta de valor pela qual o candidato sai procurando.

### 4.2 A evidência de que já é monetizado

Três produtos já cobram exatamente pela explicação, e nenhum deles a chama assim:

| Produto | O que é grátis | O que é pago | Nome do paywall |
|---|---|---|---|
| **Huntr** | "Basic resume job matching and **scoring**" | "**Advanced job matching with full keyword visibility**" | Visibilidade dos termos |
| **Jobscan** | 5 scans com "basic keyword gap analysis" | "**Full Match Reports**", Power Edit | Relatório completo |
| **Resume Worded** | Score out of 100 | "**Line-by-Line Analysis Engine**" | Análise linha a linha |
| **LinkedIn Premium** | Quais qualificações você atende / não atende | **Rating categórico High/Medium/Low** + badge "Top Applicant" (top 50% dos candidatos em vagas com 10+ aplicações) | Nota comparativa |

O padrão é idêntico nos quatro: **dá-se o número, cobra-se o porquê.** Isso é uma confirmação forte
de que a explicação tem valor percebido — as empresas já testaram e colocaram atrás do paywall.

Mas note o que isso implica: a explicação vale como **incremento sobre um score que o usuário já
recebeu de graça**. Ela é o upsell, não a isca. Um produto cujo *core* é a explicação está tentando
vender o upsell sem ter a isca.

### 4.3 Por que "explicável" não sustenta uma categoria no lado candidato

Quatro razões, em ordem de gravidade:

**1. O candidato não quer entender — quer entrar.** Ninguém acorda com o problema "não sei por que
esta vaga é a minha #1". O problema é "estou há 5 meses sem trabalho". Explicabilidade responde a
uma pergunta que o usuário não estava fazendo. Em venda, isso é fatal: você está educando o mercado
sobre um problema antes de vender a solução, e educação de mercado é o item de custo mais caro que
existe para um produto de US$ 40/mês.

**2. Explicação de um ranking *seu* não muda o resultado.** Este é o ponto que mais dói. Se o
job-hunt-os me diz "esta vaga é #1 porque casa 8 das 10 competências e paga na sua faixa", eu ainda
vou me candidatar por um formulário onde **o ranking que decide é o do outro lado** — o do ATS, o do
recrutador, o do Recruiter da LinkedIn. O score explicável do candidato tem poder **de alocação de
esforço** (onde gastar minhas próximas 3 horas), não poder de resultado. É valioso, mas é um valor
de segunda ordem, e segunda ordem é difícil de precificar.

**3. Onde a explicabilidade tem valor regulatório e financeiro, o comprador é a empresa — não o
candidato.** A NYC Local Law 144 exige auditoria anual independente de viés em AEDTs e divulgação
pública dos resultados. O EU AI Act classifica recrutamento e seleção como **alto risco**, exigindo
que o candidato seja informado, que a empresa **explique como o sistema funciona** ("sem decisões de
caixa-preta") e que haja trilha de auditoria de cada decisão
([Candidate Experience Institute](https://www.candidate-experience-institute.com/your-new-hiring-ai-compliance-stack-what-eu-ai-act-and-nyc-local-law-144-actually-require-of-your-ats-roadmap),
[HireHub](https://www.thehirehub.ai/blog/ai-hiring-compliance-in-2026-the-recruiter-s-guide-to-nyc-local-law-144-and-the-eu-ai-act)).
Ou seja: **existe uma obrigação legal de explicabilidade em matching de talento, com orçamento
associado, e ela recai sobre o empregador.** É o mesmo motor técnico, vendido para o lado que tem
dinheiro e é obrigado por lei a comprar. Se há um negócio na explicabilidade, ele está desse lado.

**4. Explicabilidade é copiável em um sprint.** Não é defensável. No dia em que o LinkedIn decidir
mostrar o breakdown completo do Job Match no tier grátis — e ele já mostra quais qualificações você
atende e não atende —, o diferencial evapora. Já são 1,3 milhão de usuários diários no Job Match.

### 4.4 Onde a explicabilidade *realmente* vale, no caso específico deste produto

Um caso, e é forte: **explicabilidade como prova de auditabilidade para operação por agente de IA.**

O job-hunt-os é operável por agentes. Um score determinístico e explicável não é, aqui, uma feature
de UX — é o que torna a saída **verificável**. Um agente que devolve "esta é a #1" sem rastro é
inauditável; um que devolve a decomposição da nota pode ser conferido, versionado e testado em
regressão. Isso importa para um comprador técnico, não para o candidato médio.

E vale registrar o segundo caso, que é o mais concreto de todos: **os bloqueios duros por restrição
legal.** "O dono não tem autorização de trabalho nos EUA, portanto estas 400 vagas estão fora" é uma
explicação que **muda o comportamento imediatamente** e economiza semanas. Existe demanda comprovada
por esse filtro — h1bvisajobs.com opera sobre 1,7 M+ registros de LCA do DOL, e MigrateMate agrega
por tipo de visto (H-1B, E-3, TN, OPT). Note a assimetria: essas empresas construíram um negócio
inteiro em cima do filtro de autorização de trabalho, **e nenhuma delas se vende como "matching
explicável"**. Elas se vendem como "vagas que te patrocinam".

**Lição comercial:** ninguém compra "explicável". Compra-se "não perca tempo com vaga que não pode
te contratar". A explicabilidade é o mecanismo; a promessa vendável é a economia de tempo e a
ausência de rejeição previsível.

