# Frente A — Agregadores e marketplaces para talento sênior / remoto / contractor

> Coluna crítica: **contrata contractor a partir do Brasil?**
> Status de API e redirects verificados por requisição direta em 18/08/2026.
> Onde a fonte primária não publica a informação, está escrito
> "não publicado" — não foi preenchido por inferência.

## Tabela comparativa

| Plataforma | Público | API pública? | Contrata do Brasil? | Quem paga |
|---|---|---|---|---|
| [Welcome to the Jungle (ex-Otta)](https://uk.welcometothejungle.com/) | Tech/startups, UK/EU/US | **Parcial** — `api.welcometothejungle.com/api/v1/organizations` responde 200 sem auth | Vagas majoritariamente EU/UK com direito a trabalho local | Empresa |
| [Wellfound (ex-AngelList Talent)](https://wellfound.com/) | Startups, early-stage | **Não** — `/api/jobs` responde **403**; site bloqueia automação | Maioria exige US work auth; filtro de remoto existe mas é fraco | Empresa |
| [Hired](https://www.lhh.com/us/en/hired/) | Marketplace reverso | **Não** | **Marca absorvida** — `hired.com` redireciona (301) para LHH/Adecco | Empresa |
| [Toptal](https://www.toptal.com/freelance-jobs) | Freelance "top 3%" | **Não** | Sim — "freelancers de todo o mundo"; sem restrição geográfica publicada | **Empresa** (Toptal fatura o cliente; sem taxa publicada ao freelancer) |
| [Braintrust](https://www.usebraintrust.com/) | Marketplace de talento | **Não** | **Sim** — "global talent pool across 100+ countries" | **Empresa** — "zero platform fees for talent"; talento fica com 100% |
| [A.Team](https://www.a.team/join) | Times sob demanda, sênior | **Não** | Não publicado (escritórios NY/Tel Aviv) | **Empresa** — "you set your rate, we don't skim it"; aceitação <2% |
| [Lemon.io](https://lemon.io/for-developers/) | Freelance dev p/ startups | **Não** | **Sim, na prática** — depoimento oficial cita dev trabalhando do Brasil; paga via Wise/Payoneer | Empresa (Lemon.io paga o dev direto) |
| [Gun.io](https://gun.io) | Freelance sênior | **Não** (403 a automação) | Não publicado | Empresa |
| [Arc.dev](https://arc.dev/remote-jobs) | Remoto global | **Não** | **Sim — explícito**, tem trilha "Remote jobs in Brazil" e demais países LATAM | Empresa |
| [Turing](https://www.turing.com/jobs) | Devs p/ empresas US | **Não** | Não publicado; posiciona-se como "globally distributed", contrata como contractor | Empresa (gratuito p/ dev) |
| [Andela](https://www.andela.com/) | Talento AI-native | **Não** | **Sim** — cita time "de Europa, Quênia, **Brasil**, Índia e América do Norte" | Empresa |
| [X-Team](https://x-team.com) | Staff augmentation | **Não** | Não publicado | Empresa |

### Observações verificadas de primeira mão

- **Otta não existe mais como marca independente.** `otta.com` responde **301**
  para `uk.welcometothejungle.com`. A aquisição pela Welcome to the Jungle foi
  [anunciada em janeiro de 2024](https://press.welcometothejungle.com/en/news/uk-recruitment-platform-otta-acquired-by-welcome-to-the-jungle).
- **Hired foi absorvida.** `hired.com` responde **301** para
  `lhh.com/us/en/hired/` (LHH, grupo Adecco). Não é mais o marketplace reverso
  independente que era.
- **Wellfound bloqueia acesso programático** — `403` em `/api/jobs`. Integração só
  por scraping com browser, com o risco de ToS correspondente.
- **Braintrust é o modelo economicamente mais favorável ao talento** entre os
  verificados: [a página de preços](https://www.usebraintrust.com/pricing) afirma
  "zero platform fees for talent" — o talento fica com 100% da tarifa e a margem
  vem do lado do cliente. A.Team faz afirmação equivalente ("we don't skim it").
- **Toptal não publica a taxa cobrada do freelancer.** A página oficial diz apenas
  que o freelancer define a própria tarifa e que a Toptal fatura o cliente. O
  markup sobre o cliente **não é publicado**.

### Leitura de R&S sobre a Frente A

Nenhuma dessas plataformas expõe API pública utilizável — a única exceção parcial
é a Welcome to the Jungle. **Do ponto de vista de integração no job-hunt-os, a
Frente A inteira é irrelevante como fonte de dados.** O valor dela é outro: são
canais de *colocação*, não de *listagem*.

E como canal de colocação para este perfil, o ranking é curto:

1. **Braintrust e A.Team** — economicamente os melhores (talento fica com 100%),
   explicitamente globais, posicionados em sênior. Braintrust confirma 100+ países.
2. **Arc.dev** — o único que assume publicamente trilha para o Brasil.
3. **Lemon.io** — aceita LATAM e paga via Wise/Payoneer, mas a faixa divulgada
   ("senior a partir de US$ 55/h") fica abaixo do que um arquiteto com 20+ anos
   deveria cobrar. Serve como fluxo de caixa, não como destino.
4. **Toptal** — alcance global e tarifas melhores, mas o processo de triagem é
   longo e a taxa cobrada do cliente não é transparente.
5. **Turing / Andela / X-Team** — modelo de staff augmentation. Andela pivotou
   para "AI-native engineers" com trilhas Builders/Integrators/Scalers. Tendem a
   posicionar o profissional como capacidade alocada, não como arquiteto — o que
   é o oposto do posicionamento-alvo.
6. **Wellfound e Welcome to the Jungle** — bons boards, mas o inventário é
   majoritariamente preso a direito de trabalho local (US/UK/EU).
