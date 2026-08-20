# C4 nível 1 — Contexto do sistema

Quem usa o master-jobs e com que sistemas externos ele fala.

O ponto que o diagrama precisa deixar óbvio: **o LinkedIn aparece três vezes,
com três naturezas diferentes**, e é isso que a [ADR 0001](../../adr/0001-nao-fazer-scraping-do-linkedin.md)
e a [ADR 0008](../../adr/0008-ingestao-de-email-como-fonte-de-sourcing.md)
governam. Nenhuma seta sai do sistema **para** a plataforma do LinkedIn.

```mermaid
C4Context
  title Contexto — master-jobs

  Person(andreus, "Andreus Timm", "Arquiteto de IA sênior. Remoto B2B do Brasil,<br/>sem autorização de trabalho nos EUA.")
  Person_Ext(agente, "Agentes de IA", "Claude Code, Codex, OpenCode.<br/>Usuários de primeira classe: leem CLAUDE.md<br/>e operam a CLI.")

  System(jho, "master-jobs", "Encontra vagas, pontua contra o perfil<br/>de forma auditável, e gerencia o funil.<br/>Roda localmente.")

  System_Ext(ats, "APIs de ATS", "Greenhouse, Lever, Ashby,<br/>SmartRecruiters, Recruitee.<br/>Públicas, sem autenticação.")
  System_Ext(agreg, "Agregadores remotos", "Himalayas, Remotive, Arbeitnow,<br/>RemoteOK, Braintrust, Adzuna.")
  System_Ext(fx, "Frankfurter / BCE", "Taxas de câmbio de referência.<br/>Sem chave, sem cadastro.")
  System_Ext(inbox, "Caixa de entrada", "Job alerts e e-mails de ATS.<br/>Correspondência do próprio usuário.")
  System_Ext(li, "LinkedIn", "A plataforma. NUNCA acessada<br/>por software deste sistema.")
  System_Ext(obsidian, "Vault Obsidian", "Onde o usuário lê e anota.")

  Rel(andreus, jho, "Tria, decide, registra", "CLI e dashboard")
  Rel(agente, jho, "Opera", "CLI, skills, --json")

  Rel(jho, ats, "Busca vagas", "HTTPS GET")
  Rel(jho, agreg, "Busca vagas", "HTTPS GET")
  Rel(jho, fx, "Busca cotações", "HTTPS GET")
  Rel(jho, inbox, "Lê arquivos .eml exportados", "sistema de arquivos")
  Rel(jho, obsidian, "Escreve relatórios e dossiês", "markdown")

  Rel(li, inbox, "Envia job alerts", "push — e-mail")
  Rel(andreus, li, "Publica, comenta, conecta", "manual, no navegador")

  UpdateRelStyle(li, inbox, $offsetY="-20")
  UpdateRelStyle(andreus, li, $offsetX="60")
```

## O que o diagrama afirma

**Não existe seta de `master-jobs` para `LinkedIn`.** O sistema lê o que o
LinkedIn **envia** — o job alert que chega na caixa de entrada — e nunca
consulta a plataforma. Publicar, comentar e conectar são ações do humano, no
navegador dele.

**Agentes de IA são usuários, não infraestrutura.** Eles aparecem como `Person`
porque operam o sistema pela mesma superfície que o humano. Isso tem
consequência de projeto: comandos idempotentes, saída legível por máquina, e
invariantes escritas em prosa nos arquivos que os agentes leem.

**Todas as fontes de vaga são públicas e sem autenticação.** Marketplaces com
área logada — Revelo, BairesDev — entram por importação manual de payload, não
por adapter; ver [sources-autenticadas](../../sources-autenticadas.md).
