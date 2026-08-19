# C4 nível 2 — Containers

As unidades executáveis e onde o estado vive.

```mermaid
C4Container
  title Containers — job-hunt-os

  Person(andreus, "Andreus Timm")
  Person_Ext(agente, "Agentes de IA")

  Container_Boundary(sys, "job-hunt-os") {
    Container(cli, "CLI", "Node 24 + Commander", "33 comandos. Toda operação<br/>é acessível aqui.")
    Container(web, "Dashboard", "Next.js 16 + shadcn/ui", "Server Components.<br/>Nenhum JavaScript de cliente.")
    Container(core, "src/core", "TypeScript", "Toda a lógica. Compartilhada<br/>pelas duas interfaces.")
    ContainerDb(db, "data/jobs.db", "libSQL / SQLite", "14 tabelas. 127 MB —<br/>as descrições ficam offline.")
    Container(config, "Configuração", "YAML + Zod", "profile.yaml e sources.yaml.<br/>Editados à mão, validados na carga.")
  }

  System_Ext(fontes, "APIs públicas", "ATS, agregadores, câmbio")
  System_Ext(vault, "Vault Obsidian", "markdown")

  Rel(andreus, cli, "Opera", "terminal")
  Rel(andreus, web, "Tria e decide", "localhost:3000")
  Rel(agente, cli, "Opera", "shell")

  Rel(cli, core, "Chama")
  Rel(web, core, "Chama", "Server Components")
  Rel(core, db, "Lê e escreve", "Drizzle ORM")
  Rel(core, config, "Carrega e valida", "Zod")
  Rel(core, fontes, "Busca", "HTTPS")
  Rel(core, vault, "Escreve", "markdown")

  UpdateRelStyle(web, core, $offsetY="-10")
```

## A invariante que este nível existe para mostrar

> **A UI é adaptador, não implementação paralela.** As duas interfaces chamam
> as mesmas funções de `src/core`. A única mutação do funil passa por
> `setApplicationStatus`, então uma mudança de status feita no navegador cai em
> `application_event` exatamente como uma feita no terminal.

Quando uma query é necessária às duas, ela vai para `src/core/db/repo.ts`.
Nunca é duplicada — foi por isso que `getJobDetail`, `corpusStats`,
`clusterBreakdown` e `pipelineRows` nasceram lá quando o dashboard precisou.

## Por que libSQL, e não um servidor

O mesmo driver serve arquivo local hoje e Turso amanhã, com o mesmo SQL e as
mesmas migrations — muda a URL de conexão. Ver
[ADR 0002](../../adr/0002-libsql-em-vez-de-better-sqlite3.md).

## Por que sem build step

Node 24 executa TypeScript diretamente. O custo é uma restrição real: só
sintaxe apagável — sem `enum`, sem parameter properties, sem decorators.
Ver [ADR 0006](../../adr/0006-typescript-apagavel-sem-build-step.md).
