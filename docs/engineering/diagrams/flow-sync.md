# Fluxo — sincronização de vagas

O que acontece em `pnpm jho jobs sync`.

```mermaid
flowchart TD
  start([jobs sync]) --> mig[runMigrations]
  mig --> cfg[loadSources<br/>config/sources.yaml + Zod]
  cfg --> ensure[ensureSources<br/>upsert na tabela source]
  ensure --> pool{{pool de 4 workers}}

  pool --> fetch[adapter.fetchJobs]
  fetch --> ok{sucesso?}

  ok -->|não| err[grava source.lastError<br/>segue para a próxima fonte]
  err --> next

  ok -->|sim| loop[para cada RawJob]
  loop --> fp[fingerprint<br/>empresa + título + local]
  fp --> ch[contentHash<br/>título, local, salário, descrição]
  ch --> exists{fingerprint<br/>já existe?}

  exists -->|não| ins[(INSERT job)]
  exists -->|sim| moved{contentHash<br/>mudou?}

  moved -->|não| touch[(UPDATE lastSeenAt<br/>reabre se estava fechada)]
  moved -->|sim| upd[(UPDATE job)]
  upd --> inval[(DELETE job_score<br/>o score virou mentira)]

  ins --> next
  touch --> next
  inval --> next

  next[próximo] --> done{fonte<br/>terminou?}
  done -->|não| loop
  done -->|sim| sweep[fingerprints ausentes desta fonte<br/>→ closedAt]
  sweep --> pool

  pool --> allDone{todas as<br/>fontes?}
  allDone -->|não| pool
  allDone -->|sim| score[scoreAll<br/>salvo com --no-score]
  score --> fim([totais: fetched, new, updated,<br/>closed, rescore, failed])

  style err fill:#fee,stroke:#b3262b
  style inval fill:#eef,stroke:#024ad8
  style sweep fill:#ffe,stroke:#9a6b12
```

## Três decisões visíveis no fluxo

**Erro de fonte não interrompe nada.** Ele vira `source.lastError` e o pool
segue. Um handle errado não pode custar as outras doze fontes.

**Conteúdo alterado invalida o score.** O `job_score` foi calculado sobre o
texto antigo, então ele passou a ser mentira. Sem isso, uma vaga editada
mantinha nota obsoleta indefinidamente — foi assim que 4.538 vagas do Lever
ficaram com keyword zero depois que as descrições foram finalmente parseadas.

**O que some é fechado, não deletado.** `closedAt` preserva o histórico de
candidatura, que a foreign key levaria junto.
