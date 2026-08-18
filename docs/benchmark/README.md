# Benchmark competitivo — 2026-08-18

Pesquisa conduzida por agentes paralelos, cada um com uma frente e a instrução
de operar como profissional de R&S sênior — e de reportar honestamente onde o
concorrente é melhor.

| Documento | Frente | O que responde |
|---|---|---|
| [frente-a-b-agregadores-e-open-source.md](frente-a-b-agregadores-e-open-source.md) | Agregadores, marketplaces e open source | O que já existe e faz melhor que nós |
| [frente-c-autoapply-e-risco-linkedin.md](frente-c-autoapply-e-risco-linkedin.md) | Auto-apply e risco de conta | Bans reais, estado jurídico pós-hiQ, e-mail como fonte |
| [frente-d-mercado-e-monetizacao.md](frente-d-mercado-e-monetizacao.md) | Posicionamento e modelo de negócio | Onde está o dinheiro, e se há negócio aqui |

Frente A (rastreadores e matching com IA — Teal, Huntr, Simplify, Jobscan)
ficou **incompleta**: o agente não entregou.

---

## As conclusões que mudaram decisões

**1. O hiQ perdeu.** Julgamento sumário para o LinkedIn em quebra de contrato
(04/11/2022), acordo de US$ 500 mil com injunção permanente e destruição de
código e dado (06/12/2022). A CFAA saiu do caminho para dado público deslogado;
o **contrato** não. Fortalece a [ADR 0001](../adr/0001-nao-fazer-scraping-do-linkedin.md).

**2. E-mail de job alert é caminho legítimo.** Virou a
[ADR 0008](../adr/0008-ingestao-de-email-como-fonte-de-sourcing.md), com três
travas e a ressalva honesta sobre o item 4 da §8.2.

**3. Braintrust era a fonte que faltava.** Único marketplace com API aberta *e*
elegibilidade por país em campo estruturado. Já implementado — duas vagas dele
entraram no top 5 na primeira coleta.

**4. career-ops nos domina na coleta.** 65 mil estrelas, 75 providers, todas as
nossas fontes, mesma tese arquitetural. Nossa vantagem restante é estreita mas
real: ele pontua com LLM por vaga (não reprodutível, custo por vaga); nós
pontuamos o acervo inteiro a custo zero, com nota decomponível.

**5. O modelo de negócio candidate-side é estruturalmente ruim.** O sucesso do
produto causa o cancelamento. Churn ~100% em 3–6 meses, LTV de US$ 40–120, CAC
precisa ficar abaixo de ~US$ 30 — o que elimina aquisição paga. E "matching
explicável" já é vendido, mas como *paywall*, não como proposta de valor:
Huntr, Jobscan, Resume Worded e LinkedIn Premium dão o número e cobram o porquê.

**6. Canal decide mais que ranqueamento.** Referrals são 7% dos candidatos e 40%
das contratações. 18–27% dos anúncios são ghost jobs. E a fraude de localização
em massa transformou o filtro de work authorization em defesa anti-fraude — que
elimina um arquiteto brasileiro legítimo junto com o ruído.
