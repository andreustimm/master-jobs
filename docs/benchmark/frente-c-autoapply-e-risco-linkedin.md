# Risco real: bots de auto-apply, automação de LinkedIn e submissão autônoma

**Data:** 2026-08-18 · **Autor:** análise de risco (perspectiva de R&S sênior)
**Escopo:** insumo para revisão da ADR 0001 (`docs/adr/0001-nao-fazer-scraping-do-linkedin.md`)
e para a decisão sobre candidaturas submetidas autonomamente por agente.

> **Nota de método.** Este mercado é dominado por conteúdo SEO de fornecedores que
> vendem a ferramenta concorrente. Marquei cada afirmação como **[FATO]** (fonte
> primária: termo de uso, decisão judicial, issue de repositório, declaração do
> próprio envolvido), **[RELATO]** (primeira pessoa verificável, mas anedótico) ou
> **[COMUNIDADE/VENDOR]** (blog de fornecedor, número não auditado). Números de
> conversão citados por vendedores de auto-apply — ou por seus concorrentes —
> não foram auditados por ninguém e devem ser lidos como marketing.

---

## Sumário executivo

Cinco conclusões, em ordem de força da evidência:

1. **A ADR 0001 não só se sustenta como saiu reforçada.** A evidência de 2025–2026
   é mais dura do que a que existia quando a decisão foi tomada: o LinkedIn passou
   de "restringe contas" para **processar fornecedores em juízo até a liquidação da
   empresa** (Proxycurl) e para **remover perfis pessoais de fundadores** de
   empresas de automação (HeyReach).
2. **O risco não é hipotético e não é lento.** Existe relato de primeira mão,
   datado e público, de conta restringida **em 12 horas** de uso do maior bot open
   source do setor (AIHawk, issue #160).
3. **Parsear os próprios e-mails de job alert é caminho legítimo** sob leitura
   estrita da seção 8.2 — mas por um motivo mais forte que "não pega": **nenhuma
   das cláusulas que efetivamente mordem é acionada**, porque não há acesso à
   plataforma. Com três travas arquiteturais (§4).
4. **"LinkedIn" e "ATS" são classes de risco completamente diferentes** e o pedido
   do dono mistura as duas. Submissão autônoma em Greenhouse/Lever/Ashby não tem a
   mesma proibição contratual nem o mesmo ativo em jogo. Submissão autônoma no
   LinkedIn Easy Apply é a violação explícita.
5. **O argumento decisivo contra submissão autônoma em massa não é o ban — é o
   resultado.** Para um perfil sênior, volume é anti-estratégia. Os dados
   disponíveis apontam consistentemente que aplicação sem customização converte a
   uma fração da customizada, e o canal já está saturado (~11 mil candidaturas por
   minuto no LinkedIn, +45% em um ano).

---

## 1. Tabela dos produtos de auto-apply

| Produto | O que faz | Preço publicado | Como acessa a plataforma | Consequência de conta reportada |
|---|---|---|---|---|
| **LazyApply** | Aplica em massa; até 1.500/dia no tier caro | **$99 / $149 / $999 por ano** — [publicado no site](https://lazyapply.com/) **[FATO]** | Extensão Chrome que dirige **sua sessão logada** **[FATO — site cita "Auto Fill Job Applications Chrome Extension"]** | Restrição de LinkedIn amplamente reportada; Trustpilot 2,3–2,4/5 com ~56% de 1 estrela **[COMUNIDADE/VENDOR]**. O próprio site promete que "seus perfis nunca serão bloqueados pelas plataformas" — promessa que nenhum fornecedor pode cumprir **[FATO — texto do site]**. Home hoje destaca Greenhouse, Dice, Indeed e ZipRecruiter |
| **AIHawk / Jobs_Applier_AI_Agent** | Open source Python; aplica em massa com CV/carta gerados por LLM; ~30,2k estrelas | **Gratuito** (open source) **[FATO]** | **Browser automation (Selenium/Playwright) sobre sessão logada** no LinkedIn e Indeed **[FATO]** | **Restrição documentada em 12h** ([issue #160](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/160)) **[RELATO — primeira pessoa, datado]**. Mantenedor respondeu: *"The bot was created for educational purposes, we take no responsibility for how it is used!"* **[FATO]** |
| **Massive** (usemassive.com) | Agente + recrutadores humanos aplicam por você | **Sem página pública**; ~**$59/mês** (~$50 no trimestral) via terceiros **[COMUNIDADE/VENDOR]** | Agente **server-side**; usa domínio de e-mail proxy | Nenhum ban de plataforma documentado. Risco reportado: entregabilidade do e-mail proxy; falha em ATS enterprise (Workday) **[COMUNIDADE/VENDOR]** |
| **Sonara** | Aplica autonomamente 24/7 em páginas de carreira | Trial **$2,95** que renova para **$23,95/4 semanas**; ~$71,40/ano no upfront **[COMUNIDADE/VENDOR]** | Agente **cloud, IP de datacenter** | Nenhum ban de plataforma documentado. Reclamação dominante é armadilha de renovação, não conta **[COMUNIDADE/VENDOR]** |
| **JobCopilot** | 20–50 aplicações/dia, modo revisão opcional | **$19,90/mês** (Premium) / **$24,90/mês** (Elite) **[COMUNIDADE/VENDOR — sem página pública consistente]** | Agente **server-side + extensão Chrome** | Sem ban documentado. Reclamação recorrente no Trustpilot: aplicar automaticamente em **vagas fraudulentas** **[COMUNIDADE/VENDOR]** |
| **AI Apply (aiapply.co)** | Toolkit + créditos de auto-apply | ~**$29/mês** citado por terceiros; **sem valores na página pública** **[COMUNIDADE/VENDOR]** | Agente **cloud** | Sem ban documentado. **Rating F no Better Business Bureau** e alerta de integridade no perfil Trustpilot **[COMUNIDADE/VENDOR]** |
| **Simplify (Copilot)** | **Autofill** — preenche, você clica em enviar | Free; **Simplify+ $39,99/mês** (ou $19,99/semana / $29,99/mês trimestral) **[COMUNIDADE/VENDOR]** | Extensão Chrome, **IP residencial, velocidade humana**; **não submete sozinho** **[FATO — comportamento do produto]** | **Nenhum ban documentado.** Precisão do autofill cai para 40–50% em iCIMS/Taleo |
| **Jobright AI** | Agente com modo supervisionado ou autopilot | **$39,99/mês** (Turbo), mostrado só in-app **[COMUNIDADE/VENDOR]** | Agente **server-side** | Sem ban documentado. Risco reportado é pior que ban: **inserir no CV skills e métricas que o candidato não tem** **[COMUNIDADE/VENDOR]** |
| **LoopCV** | Aplica via formulário de ATS **e e-mail direto ao recrutador** | Free (10/mês); a partir de **€9,99/mês** | Agente **server-side**, dois canais | Sem ban. Mas há **relato de primeira pessoa do lado do recrutador**: *"I'm receiving 10 applications a week from LoopCV… sending applications for a job at a completely different company"* — [HN 41756371](https://news.ycombinator.com/item?id=41756371) **[RELATO]** |

### Leitura da tabela

Três padrões que importam mais que os preços:

- **Quem dirige sua sessão logada é quem te queima.** LazyApply e AIHawk operam
  dentro do navegador autenticado — exatamente a superfície que a §8.2 proíbe e
  que a detecção do LinkedIn observa. Massive, Sonara, JobCopilot e Jobright são
  server-side e, por isso mesmo, **evitam o LinkedIn** e miram páginas de carreira
  e ATS. Não é coincidência: é a fronteira de risco desenhada pelo mercado.
- **Simplify é o único que não tem ban documentado — e é o único que não submete
  sozinho.** O produto que exige o clique humano é o produto sem histórico de
  restrição. Esse é precisamente o modelo da fila `engagement` da ADR 0001.
- **Preço não publicado é o padrão do setor.** Massive, AIApply, Simplify+,
  Jobright e JobCopilot não mantêm página de preço estável. Em due diligence de
  fornecedor isso é sinal amarelo, não detalhe.

---

## 2. Evidência concreta de bans e restrições

### 2.1 Relato de primeira mão, datado, com o texto do aviso — AIHawk issue #160

A evidência mais direta que existe. Usuário `slippyswag`, 30/08/2024,
[issue #160](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/160) **[RELATO]**:

> "I'm using a burner LinkedIn for testing, and got this warning within 12 hours:
>
> **Access to your account has been temporarily restricted**
> Why did this happen?
> We take proactive actions to protect you when we detect potential unauthorized
> access or other activity that doesn't comply with our policies.
>
> **What can I do next?**
> We first need to verify your identity to ensure your account safety. To regain
> access to your account, please submit a government-issued ID.
>
> I can verify my account with my ID but **I don't want to risk my actual account
> getting banned**."

Três coisas a extrair:

1. **12 horas.** Não é risco de cauda longa acumulado em meses.
2. **O gatilho declarado pelo LinkedIn é "activity that doesn't comply with our
   policies"** — a redação que o LinkedIn usa para automação.
3. **O próprio usuário testou em conta descartável justamente porque não queria
   arriscar a conta real.** Ou seja: a comunidade que usa a ferramenta já opera
   com a premissa da ADR 0001.

A resposta do mantenedor, no mesmo dia **[FATO]**:

> "The bot was created for educational purposes, we take no responsibility for how it is used!"

### 2.2 O padrão de negação do mantenedor — e a contradição

Nas issues [#16](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/16)
e [#81](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/81), o
mantenedor `feder-cr` respondeu duas vezes **[FATO]**:

> "the bot simulates human activity, the risk is very low, **I don't know anyone
> who has ever been banned**, obviously the risk exists" (12/08/2024)

> "I don't know anyone who has ever been banned!" (26/08/2024)

**Quatro dias depois** vem a issue #160 com o aviso de restrição colado. E a
contradição real é estrutural, não retórica: em **13 de maio de 2026** o mesmo
autor publicou [`invisible_playwright`](https://github.com/feder-cr/invisible_playwright)
— 1.902 estrelas, atualizado hoje — descrito por ele mesmo como **[FATO — descrição
do repositório]**:

> "Free antidetect browser stealth for Playwright: undetected headless Firefox
> fingerprint. Python scraping, recaptcha and **bot detection bypass**."

Quem constrói um antidetect browser está declarando que a detecção existe, funciona
e é o problema principal. E — juridicamente relevante — **"bypass" é o verbo da
§8.2, item 3**: *"Override any security feature or bypass or circumvent any access
controls or use limits of the Services"*. Usar antidetect não reduz o risco: move
a conduta de "quebra de contrato" para o território que o LinkedIn litigou como
CFAA e fraude no caso Proxycurl (§3.3).

### 2.3 O lado do recrutador — Hacker News, primeira pessoa

Da [thread do AIHawk no HN](https://news.ycombinator.com/item?id=41756371) **[RELATO]**:

- **`malux85`** (contratando): *"the last batch of applications from the HN who's
  hiring thread had about **50% LLM generated cover letters. Instant rejection.**"*
- **`MantisShrimp90`** (entrevistador): ferramentas assim *"are clogging job inboxes
  with hundreds of submissions per day"*; os CVs gerados *"all read the same and
  say a whole lot of nothing."*
- **`015a`**: startup recebeu **800 candidaturas em 24 horas** para uma vaga de
  nível médio, ~30% "ghosts" e muitas com *"straight-up lies"* sobre skills técnicas.
- **`RileyJames`**: *"I'm receiving 10 applications a week from LoopCV… sending
  applications for a job at a completely different company."*
- **`maxehmookau`**: *"I've met a handful of folks who claim to have applied for
  thousands of jobs, and **none of them are actually successful**."*

Note o que `malux85` disse: **rejeição instantânea**, não triagem. O custo não é
"não converter" — é ser classificado.

### 2.4 Perspectiva profissional de R&S — Forbes

Suzanne Crettrol, HR Recruiter e Head of Talent Acquisition, à
[Forbes / Robin Ryan](https://www.forbes.com/sites/robinryan/article/recruiters-warn-that-this-ai-tool-could-kill-your-job-search/) **[FATO — citação atribuída]**:

> "From the HR perspective, **these auto-apply tools do not work.** AI is a
> productivity enhancer and not a replacement for personalization."

> "Most of the resumes we get for an opening are unqualified. This is especially
> true of the resumes that AI creates, which are very generic and **can embellish
> on things that aren't true**."

*(A mesma matéria cita "0,01% de sucesso por candidatura" para auto-apply. Não
localizei o estudo de origem — **trate como não verificado**. Os números com
metodologia rastreável estão em §5.2.)*

### 2.5 Detecção do lado do ATS — o outro flanco

O problema não é só o LinkedIn. Provedores de ATS adicionaram detecção **[COMUNIDADE/VENDOR,
mas convergente entre fontes independentes]**:

- **Greenhouse** integra **IPQualityScore**, que sinaliza candidaturas vindas de
  **IPs de datacenter, VPNs e redes proxy**.
- Greenhouse, Lever e Workday adicionaram **filtros de velocidade**, marcando
  candidaturas submetidas rápido demais, uniformes demais ou do mesmo padrão de IP.
- **Indeed** usa CAPTCHA que bloqueia boa parte das extensões.

**Implicação direta para o master-jobs:** um agente rodando em Vercel/cron submete
de **IP de datacenter**. Esse é o sinal exato que o IPQualityScore do Greenhouse
procura. Se houver submissão autônoma, ela precisa sair de IP residencial.

### 2.6 Ação contra fornecedores — e contra os perfis pessoais dos fundadores

| Evento | Data | O que aconteceu | Status da evidência |
|---|---|---|---|
| **Apollo.io e Seamless.ai** | 07/03/2025 | LinkedIn bloqueou o acesso das duas plataformas a dados de perfil por violação de ToS; workflows de SDR quebrados em massa | **[COMUNIDADE/VENDOR]** — reportado de forma convergente por múltiplos blogs do setor; **não localizei declaração primária do LinkedIn** |
| **Proxycurl / Nubela** | 24/01/2025 → jul/2025 | Processo federal, acordo, injunção permanente, **empresa fechada** | **[FATO]** — ver §3.3 |
| **HeyReach** | mar/2026 | LinkedIn **removeu a página da empresa (~16,4 mil seguidores) e os perfis pessoais dos fundadores e executivos**. Sem motivo publicado. Software seguiu funcionando; sem impacto documentado em contas de usuários | **[COMUNIDADE/VENDOR]** — [wonda.sh](https://www.wonda.sh/blog/linkedin-automation-safety-heyreach-ban), com citação nominal do cofundador Nick Velkovski |

O caso HeyReach é o mais desconfortável para quem trata o LinkedIn como
infraestrutura neutra: **a enforcement alcançou os perfis pessoais das pessoas
associadas à ferramenta**, não só a empresa. Para um projeto cujo ativo declarado é
o perfil pessoal do dono, isso não é um detalhe — é o cenário exato que a ADR 0001
tenta evitar, materializado num terceiro.

### 2.7 O que o LinkedIn publica — e o que ele não publica

**[FATO]** [Community Report](https://about.linkedin.com/transparency/community-report):
80,6 milhões de contas falsas bloqueadas no registro no 2S2024, ~83,4 milhões no
1S2025; defesas automatizadas bloqueiam ~97,8%, e 99,7% antes de qualquer denúncia.

**Ressalva honesta e importante:** esses números são de **contas falsas**, não de
contas legítimas restringidas por automação. **O LinkedIn não publica a taxa de
restrição de contas reais por uso de automação.** Qualquer número desse tipo
circulando na internet — inclusive o "83% das contas com automação bem feita não
sofrem restrição" que aparece em blog de fornecedor de automação — **não tem fonte
verificável e tem conflito de interesse óbvio**. Deve ser descartado como base de
decisão.

O que se pode afirmar com segurança: o LinkedIn opera **defesa automatizada em
escala industrial, com detecção proativa como padrão**. A ausência de estatística
pública sobre restrição por automação não é evidência de que ela seja rara — é
ausência de dado.

### 2.8 A norma primária, verbatim

Do [User Agreement](https://www.linkedin.com/legal/user-agreement), vigente desde
**3 de novembro de 2025**, seção 8.2 (*Don'ts*) **[FATO — texto literal]**:

> **item 2.** "Develop, support or use software, devices, scripts, robots or any
> other means or processes (such as crawlers, browser plugins and add-ons or any
> other technology) to scrape or copy **the Services**, including profiles and
> other data from the Services"
>
> **item 3.** "Override any security feature or bypass or circumvent any access
> controls or use limits of **the Services** (such as search results, profiles, or
> videos)"
>
> **item 4.** "Copy, use, display or distribute any information (including content)
> obtained from **the Services**, whether directly or through third parties (such
> as search tools or data aggregators or brokers), without the consent of the
> content owner (such as LinkedIn for content it owns)"
>
> **item 13.** "Use bots or other unauthorized automated methods to **access the
> Services**, add or download contacts, send or redirect messages, create, comment
> on, like, share, or re-share posts, or otherwise drive inauthentic engagement"

E da [página de software proibido](https://www.linkedin.com/help/linkedin/answer/a1341387) **[FATO]**:

> "we don't permit the use of any third party software, including 'crawlers', bots,
> browser plug-ins, or browser extensions that scrape, modify the appearance of, or
> **automate activity on** LinkedIn's website."
>
> Consequência: contas podem ser "restricted or shut down", e "any prohibited tools
> they're using may become non-operational without notice."

**Duas observações que a ADR 0001 já acertou e que o texto confirma:**

- O verbo é **"automate activity on"**. Uma fila em que o agente **redige** e o
  humano **executa** não automatiza atividade na plataforma. A fila `engagement` é
  compatível com a redação literal — não por interpretação generosa, mas porque não
  há ação automatizada na plataforma.
- As proibições que mordem são todas ancoradas em **"the Services"** — a plataforma.
  Isso é o eixo de toda a §4 deste documento.

**[FATO]** As [Jobs Terms and Conditions](https://www.linkedin.com/legal/jobs-terms-conditions)
tratam de obrigações da empresa contratante; **não impõem restrição específica ao
candidato** sobre modo de submissão. A restrição relevante ao candidato está toda
na §8.2 do User Agreement.

---

## 3. Estado jurídico em 2026 — o que sobrou do hiQ

### 3.1 hiQ terminou perdendo, e isso é o que quase todo mundo esquece

A memória popular parou em 2019/2022, quando o Ninth Circuit manteve a liminar a
favor do hiQ sob a **CFAA**. O fim da história é o oposto:

- **04/11/2022** — a district court concedeu **julgamento sumário ao LinkedIn na
  pretensão de quebra de contrato**: o hiQ violou o User Agreement ao scrapear
  perfis e ao contratar trabalhadores para criar perfis falsos
  ([Morgan Lewis](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators),
  [Proskauer](https://www.proskauer.com/blog/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case)) **[FATO]**
- **06/12/2022** — acordo e consent judgment: **US$ 500 mil contra o hiQ**,
  responsabilidade reconhecida por *trespass to chattels* e *misappropriation*, e
  **injunção permanente** obrigando a cessar o scraping e **destruir todo código,
  dado e algoritmo** derivados do LinkedIn ([Privacy World](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/),
  [Zwillgen](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/)) **[FATO]**

**A regra que sobrou:** o hiQ tirou a **CFAA** (o estatuto criminal/quase-criminal)
do caminho para dado **público e deslogado**. Ele **não** tocou em **contrato**. E
contrato é a arma que o LinkedIn efetivamente usa.

### 3.2 Onde o pêndulo foi depois — o eixo logado/deslogado

- **Meta Platforms v. Bright Data** (N.D. Cal., 23/01/2024, Juiz Edward Chen):
  julgamento sumário **a favor do scraper**. O juiz consignou que os termos do
  Facebook/Instagram **"do not bar logged-off scraping of public data"**, porque os
  termos se aplicam a **usuário logado**
  ([Farella Braun + Martel](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/),
  [Quinn Emanuel](https://www.quinnemanuel.com/the-firm/news-events/client-alert-meta-v-bright-data-significant-decision-for-web-scraping-industry/)) **[FATO]**
- **X Corp. v. Bright Data** (N.D. Cal.): pretensão contratual **rejeitada por
  preempção pelo Copyright Act**
  ([Skadden](https://www.skadden.com/insights/publications/2024/05/district-court-adopts-broad-view)) **[FATO]**

**Consequência exata para este projeto:** a defesa de scraping que sobreviveu em
2024–2026 é **"eu estava deslogado"**. Ela é estruturalmente indisponível para
qualquer automação de LinkedIn que sirva ao master-jobs, porque **tudo que
interessa (vagas, perfis, comentários, Easy Apply) exige sessão autenticada**. A
Camada 3 da `docs/linkedin-policy.md` está exatamente do lado errado da única
linha que os tribunais reconheceram.

### 3.3 LinkedIn v. Nubela/Proxycurl — o caso que redefine o cálculo

O evento mais importante desde o hiQ, e posterior à redação da ADR 0001.

**[FATO]** *LinkedIn Corporation v. Nubela Pte. Ltd., Proxycurl LLC, Steven Goh e
Bach Le* — **Caso nº 3:25-cv-00828, N.D. Cal., ajuizado em 24/01/2025**
([Social Media Today](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/)).

Seis pretensões **empilhadas de propósito**: quebra de contrato, fraude e dolo,
CFAA, Unfair Competition Law da Califórnia, Lanham Act (diluição de marca) e
*misappropriation*. Pediu-se a destruição não só do dado scrapeado mas também do
dado **"inferred, aggregated, or synthesized"** dele derivado.

**Desfecho:** acordo em meados de 2025, **injunção permanente**, deleção de todo o
dado, e a Proxycurl **encerrou as operações em julho de 2025 — com cerca de US$ 10
milhões de receita anual**, porque não tinha como financiar a briga.

O fundador, Steven Goh, escreveu depois
([nubela.co](https://nubela.co/blog/is-scraping-linkedin-legal-in-2026/)) **[FATO —
declaração do próprio réu]**:

> Scraping público pós-*hiQ* evita a exposição automática à CFAA, mas **"that does
> not make your company safe from LinkedIn"**. A decisão ajudou de forma estreita
> nas pretensões estatutárias, mas **"did not erase contract claims"**.
>
> **"Legal does not mean safe."**
>
> Recomendação atual dele: construir negócio com **zero dado de LinkedIn** em
> qualquer parte do sistema, dos datasets de treino ou da cadeia de fornecedores.

Essa é a fala de quem perdeu a empresa. É o depoimento mais caro disponível, e ele
chega **exatamente na mesma conclusão da ADR 0001**.

### 3.4 Estado jurídico consolidado — 2026

| Conduta | Exposição CFAA | Exposição contratual | Risco de conta |
|---|---|---|---|
| Scraping de HTML público **deslogado** | Baixa (hiQ) | **Contestada** — Meta v. Bright Data favorece o scraper | Baixo, mas a §8.2 não abre a exceção |
| Scraping/automação **em sessão logada** | Não resolvida; agravada por antidetect | **Alta** — hiQ e Proxycurl decididos contra o scraper | **Alto** |
| Uso de **antidetect / bypass de detecção** | **Elevada** — vira §8.2 item 3 e alimenta fraude/CFAA | Alta | **Alto** |
| API oficial `w_member_social` | Nenhuma | Nenhuma | **Nenhum** |
| Fila assistida (agente redige, humano executa) | Nenhuma | Nenhuma | **Nenhum** |

O item 8 da §5 da `docs/linkedin-policy.md` — *"o hiQ v. LinkedIn não é um
salvo-conduto operacional"* — está **correto e agora tem jurisprudência posterior
sustentando**.

---

## 4. Veredito: e-mail de job alert como fonte legítima

**Veredito: sustenta a ADR 0001, e a fortalece.** Não é uma exceção aberta na
política — é a aplicação consistente do princípio que ela já estabelece.

### 4.1 Por que passa no teste literal da §8.2

Aplicando cláusula por cláusula ao ato de parsear, na própria caixa de entrada, um
e-mail que o LinkedIn escolheu enviar:

| Cláusula | Texto-chave | Acionada? | Por quê |
|---|---|---|---|
| §8.2 item 2 | scrape or copy **the Services** | **Não** | O e-mail entregue não é "the Services". Nenhum endpoint é tocado |
| §8.2 item 3 | bypass **access controls or use limits** | **Não** | Nenhum controle é contornado; o conteúdo foi enviado voluntariamente |
| §8.2 item 13 | bots to **access the Services** | **Não** | **Não há acesso.** O modelo é push, não pull. O software nunca fala com o LinkedIn |
| §8.2 item 1 | false identity / conta de terceiro | **Não** — *desde que* o alerta venha da conta real do próprio usuário | Ver trava #1 |
| §8.2 item 4 | copy, use, display or **distribute** information obtained from the Services | **Zona cinzenta — a única** | Ver abaixo |

**O item 4 é a única cláusula com alcance textual**, e merece honestidade em vez de
racionalização:

- Ele **não** contém carve-out de uso pessoal. Uma leitura literal e maximalista
  alcança qualquer conteúdo de origem LinkedIn.
- Contra essa leitura pesam três coisas: (a) o LinkedIn **transmitiu
  deliberadamente** o alerta ao membro, como serviço a esse membro, e usá-lo para
  achar vaga é **o propósito para o qual foi enviado**; (b) o vetor de dano da
  cláusula é **"distribute"** — revenda, agregação, brokerage, que é o que o
  LinkedIn litigou em hiQ e Proxycurl; (c) o *content owner* do texto de uma vaga é
  a **empresa contratante**, não o LinkedIn.
- **Conclusão calibrada:** parsear para consumo próprio e privado não é o que o
  item 4 mira, mas isso é *"não proibido pelas cláusulas que mordem"* — **não** é
  *"expressamente autorizado"*. Não escreva na ADR que o LinkedIn permite. Escreva
  que a conduta não aciona a proibição.

### 4.2 Por que passa no teste de enforcement

Aqui o argumento é mais forte que o jurídico, e é o que realmente decide:

- **Não existe superfície de detecção.** Toda a detecção do LinkedIn — velocidade,
  fingerprint de navegador, artefatos de extensão no DOM, IP mismatch, cadência de
  sessão — opera **sobre a sessão**. Uma caixa de entrada é invisível para ele.
  Não há sinal a emitir porque não há interação.
- **Não localizei nenhum caso, ação, restrição ou discussão de enforcement** contra
  alguém por parsear os próprios e-mails de alerta do LinkedIn. Busquei
  explicitamente por isso. **Ausência de caso não é prova de permissão** — mas
  aqui ela é coerente com a análise de superfície: não há como o LinkedIn saber.
- **É prática reconhecida e comercialmente normal.** Parsio, Mailparser e Parseur
  vendem exatamente isso como produto, publicamente, há anos, com o LinkedIn
  nomeado nos materiais **[COMUNIDADE/VENDOR]**. A prática é aberta, não
  clandestina — o que é, por si, um dado sobre risco percebido pelo mercado.

### 4.3 As três travas que tornam o caminho defensável

Sem elas, "e-mail" vira o cavalo de Troia que reintroduz a Camada 3 pela porta dos
fundos.

> **Trava 1 — Uma conta, real, do próprio usuário.** O alerta tem que chegar da
> conta legítima do Andreus, com preferências configuradas **à mão** na UI. Zero
> contas extras, zero conta "de coleta", zero alerta criado por script. O item 1 da
> §8.2 (identidade falsa) é a linha mais dura que o LinkedIn tem — 97%+ das contas
> falsas são bloqueadas no registro. Criar conta secundária para gerar alerta é
> trocar um risco inexistente por o pior risco do catálogo.
>
> **Trava 2 — O e-mail é fonte de *sourcing*, nunca gatilho de ação na plataforma.**
> O pipeline pode extrair título, empresa, local, URL e data. **Não pode** seguir a
> URL com automação, não pode abrir o Easy Apply, não pode enriquecer buscando o
> perfil da empresa no LinkedIn. No instante em que o software segue o link, você
> voltou para a §8.2 item 13 e perdeu toda a proteção. O e-mail entrega o **sinal**;
> a resolução da vaga tem que ir para o ATS público (ADR 0003) ou para o humano.
>
> **Trava 3 — Nada é redistribuído.** Sem publicação, sem dataset compartilhado,
> sem repasse a terceiros, sem commit do conteúdo bruto no git. O item 4 só vira
> risco real quando há distribuição. Mantenha o dado em `data/jobs.db`, local.

Com essas três travas, a arquitetura fica: **push do LinkedIn → parse local →
correspondência com fonte de ATS → scorer determinístico**. O LinkedIn nunca é
consultado. Isso é coerente com o invariante da `linkedin-policy.md` §5 item 5,
não uma exceção a ele.

### 4.4 Recomendação formal

Não deixe isso implícito. **Escreva uma ADR 0007 — "Ingestão de e-mail de job alert
como fonte de sourcing"** que:

1. Declare explicitamente que ingestão de e-mail **não revoga nem flexibiliza a ADR
   0001** — a complementa, sob o mesmo princípio ("nada toca a plataforma").
2. Registre as três travas como **invariantes**, com a mesma linguagem normativa das
   demais.
3. Registre a ressalva honesta do item 4 da §8.2, para que ninguém daqui a seis
   meses ache que existe autorização expressa e escale a partir dessa premissa falsa.
4. Trate o acesso à caixa de entrada como o que ele é: um problema de termos do
   **Google** (Gmail API / OAuth sobre a própria conta), não do LinkedIn. Aí é um
   caminho oficial, com escopo somente-leitura.

---

## 5. Recomendação de R&S sobre submissão autônoma

### 5.1 Primeiro, separe duas perguntas que o pedido está fundindo

O dono pediu "agentes preenchendo e submetendo candidaturas autonomamente". Isso são
**dois produtos com perfis de risco incomparáveis**:

| | **A. Auto-apply no LinkedIn (Easy Apply)** | **B. Auto-apply em ATS (Greenhouse/Lever/Ashby)** |
|---|---|---|
| Proibição contratual | **Explícita** — §8.2 itens 2, 3, 13 | **Nenhuma explícita** para candidatos; Greenhouse apenas reserva direito de restringir uso |
| Detecção | Madura, proativa, industrial | Filtro de velocidade e IPQualityScore (IP de datacenter) |
| Ativo em risco | **A conta — SSI 59, top 2%, 97 recrutadores/ano** | Nenhuma identidade persistente a perder |
| Pior desfecho | **Perda permanente do ativo central do projeto** | Candidatura filtrada; má impressão naquela empresa |
| Evidência de dano | Restrição documentada em 12h | Nenhum ban documentado |
| **Veredito** | **Não. Nunca. Sem exceção.** | **Condicionalmente sim** |

**A resposta para (A) é não, e não é uma questão de calibragem de risco.** É a
definição de derrota por meio próprio: automatizar o LinkedIn para conseguir emprego
e perder no processo o canal por onde chegam 97 recrutadores por ano. A ADR 0001 já
diz isso; a evidência de 2025–2026 só encareceu o erro.

**A resposta para (B) é "sim, sob condições" — e o gargalo aí não é jurídico, é de
qualidade.**

### 5.2 O argumento que realmente decide não é o ban

Como profissional de R&S, é aqui que eu insistiria mesmo se o risco de conta fosse
zero.

**O canal já está saturado.** ~11 mil candidaturas por minuto no LinkedIn, **+45% em
um ano**. Uma vaga corporativa recebe 2.000 candidaturas em 48h. Um hiring manager
que recebia ~75 por vaga agora recebe 250+, **sem aumento no número de qualificados**
**[COMUNIDADE/VENDOR, convergente entre fontes]**. Do lado do recrutador, a carga de
trabalho subiu ~26% no fim de 2024, quase toda por candidatura automatizada de baixa
qualidade.

**Volume tem retorno decrescente e customização tem retorno crescente.** Os números
variam por fonte e nenhum é auditado, mas a **direção é unânime em todas as fontes,
inclusive nas que vendem automação**:

| Modalidade | Taxa de retorno reportada |
|---|---|
| Sem customização / bulk | **0,4% – 3%** |
| LinkedIn Easy Apply | ~1% – 3% |
| Auto-apply totalmente automatizado | 1% – 6% |
| Copiloto de IA com revisão humana | **5% – 15%** |
| Candidatura manual customizada | ~15% |

A aritmética que importa: **1.000 candidaturas a 1% ≈ 10 retornos. 150 candidaturas
a 8% ≈ 12 retornos.** Mesmo resultado, **1/7 do esforço** — e sem exposição, sem
CV genérico circulando no seu nome, sem risco de conta.

**E existe o custo assimétrico que ninguém precifica.** `malux85` não escreveu
"converteu menos". Escreveu **"instant rejection"**. Uma candidatura automatizada
malfeita não é neutra: ela **classifica você** naquela empresa. Para um perfil sênior
com marca construída — SSI top 2% — o dano de ser categorizado como spam pelo mesmo
recrutador que veria seu conteúdo é **maior que o valor esperado de toda a campanha
de volume**.

**A regra de R&S, dita sem rodeios:** em nível sênior, contratação é
relacionamento e referral, não funil. Volume é a estratégia de quem não tem
posicionamento. **O Andreus tem posicionamento — e ele é o único ativo que a
automação de volume consegue destruir.**

### 5.3 Se for construir mesmo assim — as condições

Submissão autônoma faz sentido em **exatamente um lugar**: a **cauda longa**, onde a
candidatura marginal vale perto de zero e o custo de oportunidade humano é o real
gargalo. Nunca no topo do funil-alvo.

**Desenho recomendado — funil de duas velocidades:**

> **Faixa 1 — Alvos prioritários (as 30 target accounts).** Zero automação de
> submissão. O agente pesquisa, redige, prepara; **o humano revisa e envia**.
> Referral e engajamento assistido primeiro, candidatura formal depois. É o modelo
> que a ADR 0001 já estabeleceu — ele é o **certo em termos de resultado**, não só
> o seguro.
>
> **Faixa 2 — Cauda longa (ATS público, score acima do corte).** Submissão autônoma
> permitida, sob **todas** as condições abaixo. Falhou uma, não submete.

**Condições inegociáveis (todas, não a maioria):**

1. **Somente ATS. Nunca LinkedIn.** Nenhuma submissão via Easy Apply, em nenhuma
   circunstância, nem "só para testar".
2. **O scorer determinístico é o portão.** Já existe (`src/core/scoring/score.ts`).
   Só submete acima de um corte alto e explícito. **Sem limiar, isso vira LazyApply
   com passos extras.**
3. **Teto diário defensável como humano.** Ordem de 5–10/dia, não 50. O teto não é
   por medo de ban no ATS — é porque acima disso a qualidade por candidatura
   colapsa, e é isso que produz o dano.
4. **IP residencial.** Nada de submeter de cron em Vercel/datacenter — é exatamente
   o sinal que o IPQualityScore do Greenhouse procura. Se a arquitetura não permite,
   **não construa a feature.**
5. **Proibição absoluta de fabricação.** O conteúdo gerado não pode inserir skill,
   métrica, ferramenta ou período que não esteja no perfil-fonte. Este é o risco
   mais grave de todos e é **reputacional e permanente**, não técnico: Jobright tem
   registro de inserir skills que o candidato não tem, e a citação da Suzanne
   Crettrol ("can embellish on things that aren't true") é a razão nº 1 pela qual
   R&S despreza esses CVs. Implemente como **validação determinística contra o
   perfil, não como instrução em prompt.**
6. **Trilha de auditoria completa.** Cada submissão gravada com vaga, score, texto
   exato enviado e timestamp. Se você não consegue mostrar o que foi enviado em seu
   nome, você perdeu o controle da sua própria marca.
7. **Gate humano nos primeiros N (sugestão: 20) e kill switch.** Revisão manual do
   que o agente produziu antes de soltar a rédea, e um comando que para tudo.
8. **Métrica de sucesso é taxa de resposta, não contagem de envios.** Se a taxa da
   Faixa 2 ficar abaixo da manual da Faixa 1 depois de ~50 envios, **desligue**. O
   experimento falhou; não é para calibrar, é para encerrar.

**E uma condição sobre governança, no espírito das ADRs existentes:** submissão
autônoma **não deve ser habilitada por default nem introduzida por um agente por
conta própria**. Merece a mesma proteção que a ADR 0001 tem — decisão explícita do
usuário, registrada em ADR, com invariante escrito. A regra "nenhum agente introduz
isso sozinho, nem só para testar" deve valer aqui do mesmo jeito.

### 5.4 Onde eu colocaria o esforço de engenharia, se fosse meu

Ordenado por retorno esperado, do maior para o menor:

1. **Customização por vaga (não volume).** Casar o título do CV ao título exato da
   vaga é o ganho isolado mais citado nas fontes. Isso é geração de conteúdo
   determinística sobre dado que você já tem no scorer — **e o master-jobs já está
   a meio caminho.**
2. **A fila `engagement` — que ainda não foi implementada.** Nenhuma linha do repo
   escreve em `engagement` hoje. Ela é o motor de referral, e referral é o canal com
   a maior conversão de todos em nível sênior. **É a maior lacuna do projeto, e é
   zero risco.** Construir auto-apply antes disso seria inverter a prioridade.
3. **Publicação via `w_member_social`.** Também não implementada, também zero risco,
   e alimenta diretamente o SSI 59 e as 97 visualizações/ano. O ativo que a ADR 0001
   protege ainda não está sendo *usado*, só preservado.
4. **Ingestão de e-mail de job alert** (§4), com as três travas.
5. **Submissão autônoma na cauda longa**, por último, com as oito condições — se
   ainda parecer valer a pena depois de 1 a 4 estarem no ar.

**A observação final, na minha função:** as três primeiras não têm risco nenhum e
têm retorno maior que a quinta. O pedido de submissão autônoma é compreensível — é o
gargalo que mais dói. Mas é o item de **menor retorno e maior risco** da lista, e
está sendo considerado antes de as alavancas gratuitas terem sido puxadas.

---

## Fontes

**Primárias — normativas e judiciais**
- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) (vigente 03/11/2025) — §8.1 e §8.2
- [LinkedIn — Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387)
- [LinkedIn Jobs Terms and Conditions](https://www.linkedin.com/legal/jobs-terms-conditions)
- [LinkedIn Community Report (transparência)](https://about.linkedin.com/transparency/community-report)
- [HiQ Labs v. LinkedIn — Wikipedia](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn) · [9th Cir. 2022, Justia](https://law.justia.com/cases/federal/appellate-courts/ca9/17-16783/17-16783-2022-04-18.html)
- [Morgan Lewis — LinkedIn v. hiQ: guidance to data scrapers](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators)
- [Proskauer — hiQ/LinkedIn proposed settlement](https://www.proskauer.com/blog/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case)
- [Privacy World — consent judgment](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/) · [Zwillgen — lessons learned](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/)
- [Farella Braun + Martel — Meta v. Bright Data](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/) · [Quinn Emanuel](https://www.quinnemanuel.com/the-firm/news-events/client-alert-meta-v-bright-data-significant-decision-for-web-scraping-industry/)
- [Skadden — X Corp. v. Bright Data, preempção](https://www.skadden.com/insights/publications/2024/05/district-court-adopts-broad-view)
- [Social Media Today — LinkedIn v. Proxycurl](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/)
- [Steven Goh (réu, Proxycurl) — "Is Scraping LinkedIn Legal in 2026? (I Was Sued by LinkedIn)"](https://nubela.co/blog/is-scraping-linkedin-legal-in-2026/)

**Primárias — relatos de primeira mão**
- [AIHawk issue #160 — restrição em 12h, texto do aviso](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/160)
- [AIHawk issue #16 — "risco muito baixo, não conheço ninguém banido"](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/16) · [issue #81](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/81) · [issue #122](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk/issues/122)
- [feder-cr/invisible_playwright — antidetect browser, mai/2026](https://github.com/feder-cr/invisible_playwright)
- [Hacker News 41756371 — recrutadores sobre AIHawk](https://news.ycombinator.com/item?id=41756371)
- [LazyApply — página de preços](https://lazyapply.com/)
- [Forbes / Robin Ryan — Suzanne Crettrol, Head of TA](https://www.forbes.com/sites/robinryan/article/recruiters-warn-that-this-ai-tool-could-kill-your-job-search/)

**Secundárias — setoriais e de fornecedor (ler com desconto)**
- [Jobscan — Auto-apply job tools: are they worth it in 2026?](https://www.jobscan.co/blog/auto-apply-job-tools/)
- [Resumly — Best AI auto-apply tools](https://www.resumly.ai/best/best-ai-auto-apply-tools) · [Is auto-apply worth it](https://www.resumly.ai/answers/is-auto-apply-worth-it)
- [Reworked — AIHawk / candidatos automatizando spam](https://www.reworked.co/employee-experience/job-candidates-can-now-spam-employers-more-efficiently/)
- [Pettauer — LinkedIn ToS enforcement, gatilhos e tiers](https://pettauer.net/en/linkedin-tos-breaches-risk-enforcement-comparison/)
- [Wonda — o caso HeyReach](https://www.wonda.sh/blog/linkedin-automation-safety-heyreach-ban)
- [Scale.jobs — LazyApply e risco de perfil](https://scale.jobs/blog/lazyapply-risk-profile-banned-linkedin)
- [ConnectSafely — LinkedIn automation ToS 2026](https://connectsafely.ai/articles/is-linkedin-automation-safe-tos-scraping-guide-2026)
