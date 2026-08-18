# ADR 0003 — Sourcing via APIs públicas de ATS e agregadores

**Status:** Aceita · 2026-08-18

## Contexto

Com o scraping do LinkedIn descartado (ADR 0001), restava a pergunta prática:
**de onde vêm as vagas?**

A dúvida do usuário era explícita — "não sei se devemos partir direto para o
LINKEDIN ou pesquisar na internet de forma geral".

A investigação mostrou que os cinco maiores ATS publicam APIs JSON de job
board **públicas e sem autenticação**, e que vários agregadores de vagas
remotas fazem o mesmo, sem exigir chave.

Isso não é um plano B. É uma fonte melhor:

- Retorna JSON estruturado, não HTML a ser raspado.
- Traz descrição completa, faixa salarial, tipo de contrato e localização.
- É estável — é a mesma API que alimenta a página de carreiras da empresa.
- É o canal por onde a candidatura acontece de fato.

Reforço decisivo: as vagas do próprio benchmark do usuário
(`Relatorio-Posicionamento-...`, §7.2) já estavam em Ashby e Lever —
TextLayer, Paires, Reflow, G2i, Redcan, Jobgether. E as empresas do
mapeamento de clientes BairesDev (`LinkedIn/vagas_agosto_2026.md`) estavam em
Greenhouse. As fontes certas já eram, na prática, as que ele vinha usando à mão.

## Decisão

Duas camadas de sourcing:

**1. Boards diretos das empresas-alvo** — precisão alta, ruído baixo.
Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee.

**2. Agregadores remotos** — cobertura ampla, ruído alto, filtrado pelo scorer.
Himalayas, Remotive, Arbeitnow, RemoteOK, Adzuna (opcional, com credencial).

Cada fonte é declarada em `config/sources.yaml` com um campo `rationale`
obrigatório na prática — por que essa fonte está na lista. Isso mantém a
configuração autoexplicativa e evita acúmulo de fontes órfãs.

**Todo mapeamento de campos foi verificado contra uma resposta real da API**,
não contra documentação. Isso pegou quirks que a documentação não menciona:
Greenhouse faz HTML-escape do `content`; Lever devolve epoch em milissegundos;
o primeiro elemento do array do RemoteOK é um aviso legal, não uma vaga;
o endpoint de lista do SmartRecruiters não traz o corpo da vaga.

## Consequências

**Positivas**

- Validado na prática: o primeiro sync real trouxe **4.824 vagas** de 12
  fontes, e o topo do ranking bateu com as vagas que o relatório de
  posicionamento já havia identificado como aderentes.
- Nenhum risco de termos de uso, nenhum cookie, nenhum ban.
- Adicionar uma empresa é uma linha de YAML.

**Negativas**

- Vaga publicada só no LinkedIn e em nenhum ATS não é capturada.
- Boards diretos exigem saber o `handle` da empresa de antemão. Mitigado por
  `pnpm jho sources probe`, que testa um handle sem gravar nada.
- Agregadores trazem muito ruído — o Jobgether sozinho devolveu 4.691 vagas.
  É o scorer que filtra, não o fetcher, por decisão de projeto (ADR 0004).

## Alternativas consideradas

**Apify e outros scrapers pagos de LinkedIn Jobs.** Rejeitado: terceiriza o
scraping, mas não muda a natureza do dado nem o problema de termos de uso, e
introduz custo recorrente e dependência de fornecedor.

**Só agregadores, sem boards diretos.** Rejeitado: perde exatamente as
empresas-alvo mapeadas, que são as de maior valor e as que motivaram o projeto.
