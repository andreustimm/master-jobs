# C4 nível 3 — Componentes de `src/core`

Os módulos dentro do core e como se compõem. Os agrupamentos abaixo antecipam
os bounded contexts da [ADR 0007](../../adr/0007-arquitetura-hexagonal-monolito-modular.md) —
hoje eles são pastas, e a migração os torna fronteiras.

```mermaid
C4Component
  title Componentes — src/core

  Container_Boundary(core, "src/core") {
    Component(sources, "sources/", "10 adapters + registry", "Um por board público.<br/>Burros: fetch, mapear, retornar.")
    Component(http, "sources/http.ts", "fetch + firstNonEmpty", "User-Agent, timeouts,<br/>retry só em erro transitório.")
    Component(ingest, "ingest/", "normalize, run, manual, import, detect, verify", "Fingerprint, dedupe,<br/>upsert idempotente.")
    Component(scoring, "scoring/", "score.ts + apply.ts", "Determinístico. 5 componentes,<br/>SCORER_VERSION versionado.")
    Component(money, "money.ts", "value object", "amount + currency + period.<br/>Puro, sem rede.")
    Component(fx, "fx.ts", "cotações", "Frankfurter → open.er-api.<br/>Cache em fx_rate.")
    Component(profile, "profile/", "Zod", "Carrega e valida profile.yaml.<br/>Falha alto na carga.")
    Component(candidate, "candidate.ts", "CV + gap", "Documentos versionados e<br/>análise de vocabulário.")
    Component(mail, "mail/", "eml, classify, job-alert, run", "Parser MIME próprio.<br/>Produz sugestões, nunca muta.")
    Component(contacts, "contacts.ts", "rede", "Referrals por slug de empresa.")
    Component(positioning, "positioning/", "plan, seed, engage", "Plano da auditoria,<br/>fila assistida, métricas.")
    Component(report, "report/markdown.ts", "export", "Relatório e dossiês pro vault.")
    ComponentDb(db, "db/", "Drizzle + libSQL", "schema, client, repo, migrate.")
  }

  System_Ext(apis, "APIs públicas")

  Rel(sources, http, "usa")
  Rel(http, apis, "GET", "HTTPS")
  Rel(ingest, sources, "invoca via registry")
  Rel(ingest, db, "upsert job")
  Rel(scoring, profile, "lê pesos e blockers")
  Rel(scoring, money, "compara remuneração")
  Rel(scoring, db, "grava job_score")
  Rel(fx, db, "cacheia taxas")
  Rel(scoring, fx, "lê tabela — nunca faz rede")
  Rel(mail, ingest, "alertas viram vagas")
  Rel(mail, db, "grava sugestões")
  Rel(candidate, profile, "identidade")
  Rel(candidate, db, "CV e análise")
  Rel(contacts, db, "rede e referrals")
  Rel(positioning, db, "plano e métricas")
  Rel(report, db, "lê board")

  UpdateRelStyle(scoring, fx, $offsetY="-15")
```

## As dependências que **não** existem, e por quê

Um diagrama de componentes vale tanto pelas setas ausentes quanto pelas
presentes.

**`scoring` não fala com a rede.** Ele lê `fx_rate`, uma tabela que alguém
populou antes. Isso mantém a pontuação pura, executável offline e — o que mais
importa — reproduzível: a taxa que gerou um score continua em disco.

**`sources` não conhece `scoring` nem `db`.** Um adapter recebe config e devolve
`RawJob[]`. Normalizar, deduplicar e pontuar são responsabilidade das camadas
seguintes. É o que faz adicionar um board custar um arquivo.

**`mail` não escreve em `application`.** Ele grava em `mail_suggestion` e o
humano decide. A seta de `mail` para o funil simplesmente não existe.

**Nada aponta para a UI.** As interfaces dependem do core; o core não sabe que
elas existem.

## Agrupamento futuro (ADR 0007)

| Contexto | Módulos hoje |
|---|---|
| Sourcing | `sources/`, `ingest/` |
| Matching | `scoring/` |
| Candidate | `profile/`, `candidate.ts` |
| Pursuit | a parte de `db/repo.ts` que trata `application` |
| Correspondence | `mail/` |
| Positioning | `positioning/`, `contacts.ts` |
| Shared kernel | `money.ts`, `fx.ts` (como porta), `db/` |
